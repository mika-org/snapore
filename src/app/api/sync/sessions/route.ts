import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { remainingPaperAfterPrint } from "@/domain/paper-counter";
import { publicUploadUrl } from "@/domain/upload-destination";
import { createGalleryLink } from "@/lib/gallery-link";
import { optimizeServerImage } from "@/lib/server-image-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSegment(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error("Identifier tidak valid");
  return value;
}

function hash(input: Uint8Array | string) {
  return createHash("sha256").update(input).digest("hex");
}

function allowedUploadOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === new URL(request.url).origin) return true;
  const configured = (process.env.SNAPORE_UPLOAD_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes("*") || configured.includes(origin);
}

function uploadCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedUploadOrigin(request)) return {};
  const wildcard = (process.env.SNAPORE_UPLOAD_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).includes("*");
  return {
    "access-control-allow-origin": wildcard ? "*" : origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-snapore-device-token",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function jsonResponse(request: Request, body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  Object.entries(uploadCorsHeaders(request)).forEach(([name, value]) => headers.set(name, value));
  return NextResponse.json(body, { ...init, headers });
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: allowedUploadOrigin(request) ? 204 : 403, headers: uploadCorsHeaders(request) });
}

async function atomicWrite(destination: string, bytes: Uint8Array) {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
}

export async function POST(request: Request) {
  const expectedToken = process.env.SNAPORE_DEVICE_TOKEN;

  if (!allowedUploadOrigin(request)) return jsonResponse(request, { error: "Origin kiosk tidak diizinkan" }, { status: 403 });

  try {
    const form = await request.formData();
    const sessionId = safeSegment(String(form.get("sessionId") ?? ""));
    const submittedBoothCode = safeSegment(String(form.get("boothCode") ?? ""));
    const kioskBoothId = String(form.get("boothId") ?? "");
    const uploadJobId = safeSegment(String(form.get("uploadJobId") ?? ""));
    const manifestRaw = String(form.get("manifest") ?? "{}");
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    const files = form.getAll("assets").filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) throw new Error("Tidak ada asset untuk disinkronkan");

    const validDeviceToken = expectedToken
      ? request.headers.get("x-snapore-device-token") === expectedToken
      : !kioskBoothId;
    const validKioskBoothId = z.uuid().safeParse(kioskBoothId).success;
    const booth = await prisma.booth.findUnique({
      where: validDeviceToken || !validKioskBoothId ? { code: submittedBoothCode } : { id: kioskBoothId },
      include: { tenant: { select: { status: true } } },
    });
    if (!booth) throw new Error("Booth agent belum terdaftar pada tenant.");
    const boothCode = booth.code;

    const validKioskLink = validKioskBoothId
      && z.uuid().safeParse(sessionId).success
      && kioskBoothId === booth.id
      && booth.kioskEnabled
      && booth.tenant.status === "ACTIVE";
    if (!validDeviceToken && !validKioskLink) {
      return jsonResponse(request, { error: "Otorisasi sinkronisasi tidak valid" }, { status: 401 });
    }

    const uploadRoot = resolve(/* turbopackIgnore: true */ process.env.SNAPORE_SERVER_UPLOAD_DIR ?? "./server-uploads");
    const directory = join(/* turbopackIgnore: true */ uploadRoot, boothCode, sessionId);
    const manifestCaptures = Array.isArray(manifest.captures)
      ? manifest.captures.filter((capture): capture is { id?: string; slotIndex?: number; revision?: number } => Boolean(capture) && typeof capture === "object")
      : [];
    const assetRecords: Array<{ fileName: string; kind: "ORIGINAL" | "COMPOSITE"; mimeType: string; sourceByteSize: number; byteSize: number; checksum: string; objectKey: string; publicUrl: string | null; localPath: string; width: number; height: number; slotIndex: number | null; revision: number | null }> = [];

    for (const file of files) {
      const fileName = safeSegment(file.name.replace(/\.[^.]+$/, ""));
      const kind = fileName.startsWith("composite-") ? "COMPOSITE" as const : "ORIGINAL" as const;
      const sourceBytes = new Uint8Array(await file.arrayBuffer());
      if (sourceBytes.length === 0 || sourceBytes.length > 30 * 1024 * 1024) throw new Error("Ukuran asset tidak valid");
      const optimized = await optimizeServerImage(sourceBytes, kind);
      const destination = join(/* turbopackIgnore: true */ directory, `${fileName}${optimized.extension}`);
      await atomicWrite(destination, optimized.bytes);
      const captureMetadata = manifestCaptures.find((capture) => capture.id === fileName);
      const originalIndex = assetRecords.filter((asset) => asset.kind === "ORIGINAL").length;
      const objectKey = `${boothCode}/${sessionId}/${fileName}${optimized.extension}`;
      assetRecords.push({
        fileName,
        kind,
        mimeType: optimized.mimeType,
        sourceByteSize: optimized.sourceByteSize,
        byteSize: optimized.byteSize,
        checksum: hash(optimized.bytes),
        objectKey,
        publicUrl: publicUploadUrl(process.env.SNAPORE_PUBLIC_UPLOAD_BASE_URL, objectKey),
        localPath: destination,
        width: optimized.width,
        height: optimized.height,
        slotIndex: kind === "COMPOSITE" ? null : captureMetadata?.slotIndex ?? originalIndex,
        revision: kind === "COMPOSITE" ? null : captureMetadata?.revision ?? 1,
      });
    }

    const storageSummary = {
      profile: "bounded-jpeg-v1",
      sourceBytes: assetRecords.reduce((total, asset) => total + asset.sourceByteSize, 0),
      storedBytes: assetRecords.reduce((total, asset) => total + asset.byteSize, 0),
    };
    const storedManifest = { ...manifest, serverStorage: storageSummary };

    if (validDeviceToken) {
      await prisma.booth.update({ where: { id: booth.id }, data: { lastHeartbeatAt: new Date(), status: "ONLINE" } });
    }

    const session = await prisma.photoSession.upsert({
      where: { id: sessionId },
      update: { status: "COMPLETED", completedAt: new Date(), metadata: storedManifest as Prisma.InputJsonValue },
      create: {
        id: sessionId,
        publicCode: sessionId.slice(0, 8).toUpperCase(),
        boothId: booth.id,
        status: "COMPLETED",
        completedAt: new Date(),
        metadata: storedManifest as Prisma.InputJsonValue,
      },
    });

    for (const asset of assetRecords) {
      const capturedPhoto = asset.kind === "ORIGINAL"
        ? await prisma.capturedPhoto.upsert({
          where: { sessionId_checksum: { sessionId, checksum: asset.checksum } },
          update: {
            slotIndex: asset.slotIndex,
            selected: true,
            width: asset.width,
            height: asset.height,
            localPath: asset.localPath,
            metadata: { revision: asset.revision, objectKey: asset.objectKey, publicUrl: asset.publicUrl, sourceByteSize: asset.sourceByteSize, storedByteSize: asset.byteSize, optimized: true },
          },
          create: {
            id: z.uuid().safeParse(asset.fileName).success ? asset.fileName : randomUUID(),
            sessionId,
            slotIndex: asset.slotIndex,
            selected: true,
            width: asset.width,
            height: asset.height,
            checksum: asset.checksum,
            localPath: asset.localPath,
            source: "MEDIA_DEVICE",
            metadata: { revision: asset.revision, objectKey: asset.objectKey, publicUrl: asset.publicUrl, sourceByteSize: asset.sourceByteSize, storedByteSize: asset.byteSize, optimized: true },
          },
        })
        : null;
      await prisma.asset.upsert({
        where: { sessionId_checksum_kind: { sessionId, checksum: asset.checksum, kind: asset.kind } },
        update: { mimeType: asset.mimeType, byteSize: asset.byteSize, objectKey: asset.objectKey, localPath: asset.localPath, capturedPhotoId: capturedPhoto?.id, syncedAt: new Date() },
        create: {
          sessionId,
          capturedPhotoId: capturedPhoto?.id,
          kind: asset.kind,
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          checksum: asset.checksum,
          objectKey: asset.objectKey,
          localPath: asset.localPath,
          syncedAt: new Date(),
        },
      });
    }

    const composite = assetRecords.find((asset) => asset.kind === "COMPOSITE");
    const order = await prisma.order.findUnique({ where: { sessionId } });
    if (composite && order && session.layoutVersionId) {
      const composition = await prisma.composition.findFirst({ where: { sessionId, checksum: composite.checksum } })
        ?? await prisma.composition.create({ data: { sessionId, layoutVersionId: session.layoutVersionId, frameVersionId: session.frameVersionId, width: composite.width, height: composite.height, checksum: composite.checksum, localPath: composite.localPath } });
      const manifestPrintJob = manifest.printJob as { id?: string; copies?: number; status?: string } | undefined;
      if (manifestPrintJob?.id) {
        const device = await prisma.device.findFirst({ where: { boothId: booth.id, type: "PRINTER", preferred: true }, orderBy: { createdAt: "asc" } });
        const copies = Math.max(1, manifestPrintJob.copies ?? order.copies);
        const printStatus = manifestPrintJob.status === "FAILED" ? "FAILED" : manifestPrintJob.status === "PRINTED" ? "PRINTED" : "QUEUED";
        await prisma.$transaction(async (tx) => {
          const existingJob = await tx.printJob.findUnique({ where: { idempotencyKey: manifestPrintJob.id! }, select: { status: true } });
          await tx.printJob.upsert({
            where: { idempotencyKey: manifestPrintJob.id! },
            update: { status: printStatus, printedAt: printStatus === "PRINTED" ? new Date() : null, deviceId: device?.id },
            create: { id: manifestPrintJob.id!, orderId: order.id, compositionId: composition.id, deviceId: device?.id, idempotencyKey: manifestPrintJob.id!, copies, status: printStatus, printedAt: printStatus === "PRINTED" ? new Date() : null },
          });
          if (printStatus === "PRINTED" && existingJob?.status !== "PRINTED" && device) {
            const paper = await tx.paperCounter.findUnique({ where: { deviceId: device.id }, select: { currentSheets: true } });
            if (paper) {
              await tx.paperCounter.update({ where: { deviceId: device.id }, data: { currentSheets: remainingPaperAfterPrint(paper.currentSheets, copies) } });
            }
          }
        });
      }
    }

    await prisma.uploadJob.upsert({
      where: { idempotencyKey: uploadJobId },
      update: { status: "SYNCED", syncedAt: new Date(), lastError: null },
      create: { id: uploadJobId, sessionId, idempotencyKey: uploadJobId, status: "SYNCED", queuedAt: new Date(), syncedAt: new Date() },
    });

    const gallery = await prisma.gallery.upsert({
      where: { sessionId },
      update: { active: true, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      create: { sessionId, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });
    const galleryUrl = await createGalleryLink(gallery.id, gallery.expiresAt, new URL(request.url).origin);

    return jsonResponse(request, {
      sessionId: session.id,
      status: "SYNCED",
      galleryUrl,
      assetCount: assetRecords.length,
      storage: { ...storageSummary, savedBytes: Math.max(0, storageSummary.sourceBytes - storageSummary.storedBytes) },
      uploads: assetRecords.map((asset) => ({ kind: asset.kind, objectKey: asset.objectKey, url: asset.publicUrl, sourceByteSize: asset.sourceByteSize, byteSize: asset.byteSize })),
    });
  } catch (error) {
    return jsonResponse(request, { error: "Sinkronisasi gagal", detail: error instanceof Error ? error.message : undefined }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId") ?? "";
  const boothId = searchParams.get("boothId") ?? "";
  if (!z.uuid().safeParse(sessionId).success || !z.uuid().safeParse(boothId).success) {
    return jsonResponse(request, { error: "Identitas sinkronisasi tidak valid" }, { status: 400 });
  }

  const session = await prisma.photoSession.findFirst({
    where: {
      id: sessionId,
      boothId,
      booth: { kioskEnabled: true, tenant: { status: "ACTIVE" } },
    },
    include: {
      gallery: true,
      uploadJobs: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });
  if (!session) return jsonResponse(request, { status: "WAITING_FOR_SYNC" });

  if (session.gallery?.active && session.gallery.expiresAt > new Date()) {
    const galleryUrl = await createGalleryLink(session.gallery.id, session.gallery.expiresAt, new URL(request.url).origin);
    return jsonResponse(request, { status: "SYNCED", galleryUrl });
  }

  return jsonResponse(request, {
    status: session.uploadJobs[0]?.status ?? "WAITING_FOR_SYNC",
    lastError: session.uploadJobs[0]?.lastError ?? null,
  });
}
