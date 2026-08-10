import { LayoutKind, UserRole, type Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { FrameCatalogItem, FrameCatalogResponse } from "@/domain/frame-catalog";
import { getLayoutSlots, type FrameAssetGeometry, type LayoutCount } from "@/domain/layout-geometry";
import { getAuthorizedUser } from "@/lib/auth";
import { reconcileBoothReadiness } from "@/lib/booth-readiness";
import { normalizeFramePng, removeSavedFrame, resolveFrameAssetPath, saveFramePng, slugifyFrameName } from "@/lib/frame-storage";
import { detectTransparentFrameSlots } from "@/lib/frame-slot-detection";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const frameFields = z.object({
  name: z.string().trim().min(2, "Nama frame minimal 2 karakter.").max(80, "Nama frame maksimal 80 karakter."),
  description: z.string().trim().max(240, "Deskripsi maksimal 240 karakter.").optional(),
});
const removedLayoutsSchema = z.array(z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8)])).max(4);

const layoutEntries = [
  { count: 2 as const, kind: LayoutKind.GRID_2, field: "grid2" },
  { count: 4 as const, kind: LayoutKind.GRID_4, field: "grid4" },
  { count: 6 as const, kind: LayoutKind.GRID_6, field: "grid6" },
  { count: 8 as const, kind: LayoutKind.GRID_8, field: "grid8" },
] as const;

type FrameWithVersions = Awaited<ReturnType<typeof queryFrames>>[number];

function queryFrames(where: Prisma.FrameWhereInput) {
  const now = new Date();
  return prisma.frame.findMany({
    where: {
      ...where,
      active: true,
      AND: [
        { OR: [{ activeFrom: null }, { activeFrom: { lte: now } }] },
        { OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] },
      ],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: {
      versions: {
        where: { published: true, layoutKind: { in: layoutEntries.map((entry) => entry.kind) } },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      },
    },
  });
}

async function getVersionGeometry(version: FrameWithVersions["versions"][number], count: LayoutCount): Promise<FrameAssetGeometry> {
  const orientation = version.widthPx > version.heightPx ? "landscape" : "portrait";
  try {
    const bytes = await readFile(resolveFrameAssetPath(version.assetPath));
    return {
      width: version.widthPx,
      height: version.heightPx,
      orientation,
      slots: await detectTransparentFrameSlots(bytes, count, version.widthPx, version.heightPx),
    };
  } catch {
    return {
      width: version.widthPx,
      height: version.heightPx,
      orientation,
      slots: getLayoutSlots(count, orientation),
    };
  }
}

async function toCatalogItem(frame: FrameWithVersions): Promise<FrameCatalogItem> {
  const rawAssets: FrameCatalogItem["assets"] = {};
  const assetMeta: NonNullable<FrameCatalogItem["assetMeta"]> = {};
  for (const version of frame.versions) {
    const count = Number(version.layoutKind.split("_")[1]) as LayoutCount;
    if (!rawAssets[count]) {
      rawAssets[count] = version.assetPath;
      assetMeta[count] = await getVersionGeometry(version, count);
    }
  }
  const variants = layoutEntries.map((entry) => entry.count).filter((count) => Boolean(rawAssets[count]));
  if (variants.length === 0) {
    return {
      id: frame.id,
      slug: frame.slug,
      name: frame.name,
      description: frame.description,
      active: frame.active,
      dnpTwoInchCut: frame.dnpTwoInchCut,
      assets: {},
      assetMeta: {},
      variants: [],
      createdAt: frame.createdAt.toISOString(),
    };
  }
  return {
    id: frame.id,
    slug: frame.slug,
    name: frame.name,
    description: frame.description,
    active: frame.active,
    dnpTwoInchCut: frame.dnpTwoInchCut,
    assets: rawAssets,
    assetMeta,
    variants,
    createdAt: frame.createdAt.toISOString(),
  };
}

async function createUniqueSlug(name: string, tenantId: string, boothId: string) {
  const base = slugifyFrameName(name);
  let slug = base;
  let suffix = 2;
  while (await prisma.frame.findFirst({ where: { slug, tenantId, boothId }, select: { id: true } })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

export async function GET(request: Request) {
  try {
    const boothId = new URL(request.url).searchParams.get("boothId");
    if (!boothId || !z.uuid().safeParse(boothId).success) {
      return NextResponse.json({ error: "boothId UUID wajib diberikan." }, { status: 400 });
    }
    const booth = await prisma.booth.findFirst({ where: { id: boothId, tenant: { status: "ACTIVE" } }, select: { id: true, tenantId: true } });
    if (!booth) return NextResponse.json({ error: "Booth tidak ditemukan." }, { status: 404 });
    const readiness = await reconcileBoothReadiness(booth.id);
    const frames = await queryFrames({ tenantId: booth.tenantId, OR: [{ boothId: booth.id }, { boothId: null }] });
    const catalogFrames = (await Promise.all(frames.map((frame) => toCatalogItem(frame)))).filter((frame) => frame.variants.length > 0);
    const availableCountsFromFrames = Array.from(new Set(catalogFrames.flatMap((f) => f.variants))).sort((a, b) => a - b) as LayoutCount[];
    const layoutCounts: LayoutCount[] = readiness ? readiness.layoutCounts : availableCountsFromFrames;
    return NextResponse.json({
      frames: catalogFrames,
      layoutCounts,
      operational: readiness?.operational ?? false,
      maintenanceReason: readiness?.reason ?? "Konfigurasi booth belum lengkap.",
    } satisfies FrameCatalogResponse);
  } catch (error) {
    return NextResponse.json(
      { error: "Frame library belum dapat dimuat.", detail: error instanceof Error ? error.message : undefined },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const savedPaths: string[] = [];
  try {
    const actor = await getAuthorizedUser([UserRole.SUPER_ADMIN, UserRole.ADMIN]);
    if (!actor) return NextResponse.json({ error: "Login admin diperlukan." }, { status: 403 });
    const formData = await request.formData();
    const boothId = String(formData.get("boothId") ?? "");
    if (!z.uuid().safeParse(boothId).success) return NextResponse.json({ error: "Booth UUID tidak valid." }, { status: 400 });
    const booth = await prisma.booth.findUnique({ where: { id: boothId }, select: { id: true, tenantId: true } });
    if (!booth || (actor.role !== UserRole.SUPER_ADMIN && actor.tenantId !== booth.tenantId)) {
      return NextResponse.json({ error: "Booth tidak berada dalam akses akun ini." }, { status: 403 });
    }
    const parsed = frameFields.safeParse({
      name: formData.get("name"),
      description: formData.get("description") || undefined,
    });
    const dnpTwoInchCut = String(formData.get("dnpTwoInchCut") ?? "false") === "true";
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data frame tidak valid." }, { status: 400 });
    }

    const validEntries = layoutEntries.filter((layout) => {
      const file = formData.get(layout.field);
      return file instanceof File && file.size > 0;
    });

    if (validEntries.length === 0) {
      return NextResponse.json({ error: "Minimal satu PNG frame (Grid 2, 4, 6, atau 8) wajib di-upload." }, { status: 400 });
    }

    const uploads = await Promise.all(validEntries.map(async (layout) => {
      const file = formData.get(layout.field) as File;
      const normalized = await normalizeFramePng(file, layout.count);
      return { ...layout, ...normalized };
    }));

    const slug = await createUniqueSlug(parsed.data.name, booth.tenantId, booth.id);
    const storedUploads: Array<(typeof uploads)[number] & { assetPath: string }> = [];
    for (const upload of uploads) {
      const stored = await saveFramePng(booth.tenantId, booth.id, slug, upload.count, upload.bytes, upload.checksum);
      savedPaths.push(stored.absolutePath);
      storedUploads.push({ ...upload, assetPath: stored.assetPath });
    }

    const frame = await prisma.$transaction(async (tx) => {
      const highestSortOrder = await tx.frame.aggregate({ _max: { sortOrder: true } });
      const created = await tx.frame.create({
        data: {
          tenantId: booth.tenantId,
          boothId: booth.id,
          slug,
          name: parsed.data.name,
          description: parsed.data.description || null,
          dnpTwoInchCut,
          active: true,
          sortOrder: (highestSortOrder._max.sortOrder ?? 0) + 1,
          versions: {
            create: storedUploads.map((upload) => ({
              version: 1,
              layoutKind: upload.kind,
              widthPx: upload.widthPx,
              heightPx: upload.heightPx,
              assetPath: upload.assetPath,
              checksum: upload.checksum,
              published: true,
              publishedAt: new Date(),
            })),
          },
        },
        include: { versions: { orderBy: [{ version: "desc" }, { createdAt: "desc" }] } },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          boothId: booth.id,
          action: "FRAME_CREATED",
          entityType: "FRAME",
          entityId: created.id,
          metadata: { slug, layouts: storedUploads.map((upload) => upload.kind), dnpTwoInchCut },
        },
      });
      return created;
    });

    const readiness = await reconcileBoothReadiness(booth.id);
    return NextResponse.json({ frame: await toCatalogItem(frame), readiness }, { status: 201 });
  } catch (error) {
    await removeSavedFrame(savedPaths);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Frame gagal disimpan." },
      { status: 400 },
    );
  }
}

export async function PUT(request: Request) {
  const savedPaths: string[] = [];
  try {
    const actor = await getAuthorizedUser([UserRole.SUPER_ADMIN, UserRole.ADMIN]);
    if (!actor) return NextResponse.json({ error: "Login admin diperlukan." }, { status: 403 });
    const formData = await request.formData();
    const frameId = String(formData.get("id") ?? "");
    const boothId = String(formData.get("boothId") ?? "");
    if (!z.uuid().safeParse(frameId).success || !z.uuid().safeParse(boothId).success) {
      return NextResponse.json({ error: "ID Frame / Booth UUID tidak valid." }, { status: 400 });
    }

    const existingFrame = await prisma.frame.findFirst({
      where: { id: frameId, active: true },
      include: { versions: { where: { published: true } } },
    });
    if (!existingFrame) return NextResponse.json({ error: "Frame tidak ditemukan." }, { status: 404 });

    const booth = await prisma.booth.findUnique({ where: { id: boothId }, select: { id: true, tenantId: true } });
    if (!booth || (actor.role !== UserRole.SUPER_ADMIN && actor.tenantId !== booth.tenantId)) {
      return NextResponse.json({ error: "Booth tidak berada dalam akses akun ini." }, { status: 403 });
    }
    if (existingFrame.boothId !== booth.id || existingFrame.tenantId !== booth.tenantId) {
      return NextResponse.json({ error: "Frame tidak berada pada booth yang dipilih." }, { status: 403 });
    }

    const parsed = frameFields.safeParse({
      name: formData.get("name"),
      description: formData.get("description") || undefined,
    });
    const dnpTwoInchCut = String(formData.get("dnpTwoInchCut") ?? "false") === "true";
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data frame tidak valid." }, { status: 400 });
    }

    const validEntries = layoutEntries.filter((layout) => {
      const file = formData.get(layout.field);
      return file instanceof File && file.size > 0;
    });
    let removedLayoutsValue: unknown = null;
    try {
      removedLayoutsValue = JSON.parse(String(formData.get("removedLayouts") ?? "[]"));
    } catch {
      return NextResponse.json({ error: "Daftar grid yang dihapus tidak valid." }, { status: 400 });
    }
    const removedLayouts = removedLayoutsSchema.safeParse(removedLayoutsValue);
    if (!removedLayouts.success) {
      return NextResponse.json({ error: "Daftar grid yang dihapus tidak valid." }, { status: 400 });
    }
    const uploadedKinds = new Set(validEntries.map((entry) => entry.kind));
    const removedEntries = layoutEntries.filter(
      (entry) => removedLayouts.data.includes(entry.count) && !uploadedKinds.has(entry.kind),
    );
    const remainingKinds = new Set(existingFrame.versions.map((version) => version.layoutKind));
    removedEntries.forEach((entry) => remainingKinds.delete(entry.kind));
    validEntries.forEach((entry) => remainingKinds.add(entry.kind));
    if (remainingKinds.size === 0) {
      return NextResponse.json({ error: "Minimal satu grid harus tetap tersedia pada frame." }, { status: 400 });
    }

    const uploads = await Promise.all(validEntries.map(async (layout) => {
      const file = formData.get(layout.field) as File;
      const normalized = await normalizeFramePng(file, layout.count);
      return { ...layout, ...normalized };
    }));

    const storedUploads: Array<(typeof uploads)[number] & { assetPath: string }> = [];
    for (const upload of uploads) {
      const stored = await saveFramePng(booth.tenantId, booth.id, existingFrame.slug, upload.count, upload.bytes, upload.checksum);
      savedPaths.push(stored.absolutePath);
      storedUploads.push({ ...upload, assetPath: stored.assetPath });
    }

    const updatedFrame = await prisma.$transaction(async (tx) => {
      await tx.frame.update({
        where: { id: frameId },
        data: {
          name: parsed.data.name,
          description: parsed.data.description || null,
          dnpTwoInchCut,
        },
      });

      const replacedOrRemovedKinds = Array.from(new Set([...removedEntries.map((entry) => entry.kind), ...validEntries.map((entry) => entry.kind)]));
      if (replacedOrRemovedKinds.length > 0) {
        await tx.frameVersion.updateMany({ where: { frameId, layoutKind: { in: replacedOrRemovedKinds }, published: true }, data: { published: false, publishedAt: null } });
      }

      for (const [index, upload] of storedUploads.entries()) {
        const nextVersionNumber = Math.max(0, ...existingFrame.versions.map((v) => v.version)) + index + 1;
        await tx.frameVersion.create({
          data: {
            frameId,
            version: nextVersionNumber,
            layoutKind: upload.kind,
            widthPx: upload.widthPx,
            heightPx: upload.heightPx,
            assetPath: upload.assetPath,
            checksum: upload.checksum,
            published: true,
            publishedAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          boothId: booth.id,
          action: "FRAME_UPDATED",
          entityType: "FRAME",
          entityId: frameId,
          metadata: { name: parsed.data.name, updatedLayouts: storedUploads.map((u) => u.kind), removedLayouts: removedEntries.map((entry) => entry.kind), dnpTwoInchCut },
        },
      });

      return tx.frame.findUnique({
        where: { id: frameId },
        include: { versions: { where: { published: true }, orderBy: [{ version: "desc" }, { createdAt: "desc" }] } },
      });
    });

    if (!updatedFrame) throw new Error("Frame gagal diperbarui.");
    const readiness = await reconcileBoothReadiness(booth.id);
    return NextResponse.json({ frame: await toCatalogItem(updatedFrame), readiness }, { status: 200 });
  } catch (error) {
    await removeSavedFrame(savedPaths);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Frame gagal diperbarui." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await getAuthorizedUser([UserRole.SUPER_ADMIN, UserRole.ADMIN]);
    if (!actor) return NextResponse.json({ error: "Login admin diperlukan." }, { status: 403 });

    const url = new URL(request.url);
    const frameId = url.searchParams.get("id");
    const boothId = url.searchParams.get("boothId");
    if (!frameId || !boothId || !z.uuid().safeParse(frameId).success || !z.uuid().safeParse(boothId).success) {
      return NextResponse.json({ error: "ID Frame dan Booth UUID wajib diberikan." }, { status: 400 });
    }

    const frame = await prisma.frame.findUnique({ where: { id: frameId } });
    if (!frame || !frame.active) return NextResponse.json({ error: "Frame tidak ditemukan." }, { status: 404 });

    const booth = await prisma.booth.findUnique({ where: { id: boothId }, select: { id: true, tenantId: true } });
    if (!booth || (actor.role !== UserRole.SUPER_ADMIN && actor.tenantId !== booth.tenantId)) {
      return NextResponse.json({ error: "Booth tidak berada dalam akses akun ini." }, { status: 403 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.frame.update({ where: { id: frameId }, data: { active: false } });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          boothId: booth.id,
          action: "FRAME_DELETED",
          entityType: "FRAME",
          entityId: frameId,
          metadata: { name: frame.name, slug: frame.slug },
        },
      });
    });

    const readiness = await reconcileBoothReadiness(booth.id);
    return NextResponse.json({ success: true, frameId, readiness }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Frame gagal dihapus." },
      { status: 400 },
    );
  }
}
