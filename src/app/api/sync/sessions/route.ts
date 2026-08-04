import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSegment(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error("Identifier tidak valid");
  return value;
}

function hash(input: Uint8Array | string) {
  return createHash("sha256").update(input).digest("hex");
}

async function createGalleryUrl(galleryId: string, expiresAt: Date) {
  const publicToken = randomBytes(24).toString("base64url");
  await prisma.galleryToken.create({
    data: { galleryId, tokenHash: hash(publicToken), expiresAt },
  });
  return `/g/${publicToken}`;
}

async function atomicWrite(destination: string, bytes: Uint8Array) {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, destination);
}

export async function POST(request: Request) {
  const expectedToken = process.env.SNAPORE_DEVICE_TOKEN;

  try {
    const form = await request.formData();
    const sessionId = safeSegment(String(form.get("sessionId") ?? ""));
    const boothCode = safeSegment(String(form.get("boothCode") ?? ""));
    const kioskBoothId = String(form.get("boothId") ?? "");
    const uploadJobId = safeSegment(String(form.get("uploadJobId") ?? ""));
    const manifestRaw = String(form.get("manifest") ?? "{}");
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    const files = form.getAll("assets").filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) throw new Error("Tidak ada asset untuk disinkronkan");

    const booth = await prisma.booth.findUnique({
      where: { code: boothCode },
      include: { tenant: { select: { status: true } } },
    });
    if (!booth) throw new Error("Booth agent belum terdaftar pada tenant.");

    const validDeviceToken = expectedToken
      ? request.headers.get("x-snapore-device-token") === expectedToken
      : !kioskBoothId;
    const validKioskLink = z.uuid().safeParse(kioskBoothId).success
      && z.uuid().safeParse(sessionId).success
      && kioskBoothId === booth.id
      && booth.kioskEnabled
      && booth.tenant.status === "ACTIVE";
    if (!validDeviceToken && !validKioskLink) {
      return NextResponse.json({ error: "Otorisasi sinkronisasi tidak valid" }, { status: 401 });
    }

    const uploadRoot = resolve(/* turbopackIgnore: true */ process.env.SNAPORE_SERVER_UPLOAD_DIR ?? "./server-uploads");
    const directory = join(/* turbopackIgnore: true */ uploadRoot, boothCode, sessionId);
    const assetRecords: Array<{ kind: "ORIGINAL" | "COMPOSITE"; mimeType: string; byteSize: number; checksum: string; objectKey: string; localPath: string }> = [];

    for (const file of files) {
      const fileName = safeSegment(file.name.replace(/\.[^.]+$/, ""));
      const extension = file.type === "image/png" ? ".png" : file.type === "image/webp" ? ".webp" : ".jpg";
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 30 * 1024 * 1024) throw new Error("Ukuran asset tidak valid");
      const destination = join(/* turbopackIgnore: true */ directory, `${fileName}${extension}`);
      await atomicWrite(destination, bytes);
      assetRecords.push({
        kind: fileName.startsWith("composite-") ? "COMPOSITE" : "ORIGINAL",
        mimeType: file.type || "image/jpeg",
        byteSize: bytes.length,
        checksum: hash(bytes),
        objectKey: `${boothCode}/${sessionId}/${fileName}${extension}`,
        localPath: destination,
      });
    }

    if (validDeviceToken) {
      await prisma.booth.update({ where: { id: booth.id }, data: { lastHeartbeatAt: new Date(), status: "ONLINE" } });
    }

    const session = await prisma.photoSession.upsert({
      where: { id: sessionId },
      update: { status: "COMPLETED", completedAt: new Date(), metadata: manifest as Prisma.InputJsonValue },
      create: {
        id: sessionId,
        publicCode: sessionId.slice(0, 8).toUpperCase(),
        boothId: booth.id,
        status: "COMPLETED",
        completedAt: new Date(),
        metadata: manifest as Prisma.InputJsonValue,
      },
    });

    for (const asset of assetRecords) {
      await prisma.asset.upsert({
        where: { sessionId_checksum_kind: { sessionId, checksum: asset.checksum, kind: asset.kind } },
        update: { objectKey: asset.objectKey, syncedAt: new Date() },
        create: { ...asset, sessionId, syncedAt: new Date() },
      });
    }

    const composite = assetRecords.find((asset) => asset.kind === "COMPOSITE");
    const order = await prisma.order.findUnique({ where: { sessionId } });
    if (composite && order && session.layoutVersionId) {
      const composition = await prisma.composition.findFirst({ where: { sessionId, checksum: composite.checksum } })
        ?? await prisma.composition.create({ data: { sessionId, layoutVersionId: session.layoutVersionId, frameVersionId: session.frameVersionId, width: 1200, height: 1800, checksum: composite.checksum, localPath: composite.localPath } });
      const manifestPrintJob = manifest.printJob as { id?: string; copies?: number; status?: string } | undefined;
      if (manifestPrintJob?.id) {
        const device = await prisma.device.findFirst({ where: { boothId: booth.id, type: "PRINTER", preferred: true }, orderBy: { createdAt: "asc" } });
        await prisma.printJob.upsert({
          where: { idempotencyKey: manifestPrintJob.id },
          update: { status: manifestPrintJob.status === "FAILED" ? "FAILED" : "PRINTED", printedAt: new Date(), deviceId: device?.id },
          create: { id: manifestPrintJob.id, orderId: order.id, compositionId: composition.id, deviceId: device?.id, idempotencyKey: manifestPrintJob.id, copies: Math.max(1, manifestPrintJob.copies ?? order.copies), status: manifestPrintJob.status === "FAILED" ? "FAILED" : "PRINTED", printedAt: new Date() },
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
    const galleryUrl = await createGalleryUrl(gallery.id, gallery.expiresAt);

    return NextResponse.json({
      sessionId: session.id,
      status: "SYNCED",
      galleryUrl,
      assetCount: assetRecords.length,
    });
  } catch (error) {
    return NextResponse.json({ error: "Sinkronisasi gagal", detail: error instanceof Error ? error.message : undefined }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId") ?? "";
  const boothId = searchParams.get("boothId") ?? "";
  if (!z.uuid().safeParse(sessionId).success || !z.uuid().safeParse(boothId).success) {
    return NextResponse.json({ error: "Identitas sinkronisasi tidak valid" }, { status: 400 });
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
  if (!session) return NextResponse.json({ status: "WAITING_FOR_SYNC" });

  if (session.gallery?.active && session.gallery.expiresAt > new Date()) {
    const galleryUrl = await createGalleryUrl(session.gallery.id, session.gallery.expiresAt);
    return NextResponse.json({ status: "SYNCED", galleryUrl });
  }

  return NextResponse.json({
    status: session.uploadJobs[0]?.status ?? "WAITING_FOR_SYNC",
    lastError: session.uploadJobs[0]?.lastError ?? null,
  });
}
