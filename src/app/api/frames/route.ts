import { LayoutKind, UserRole, type Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { FrameCatalogItem, FrameCatalogResponse } from "@/domain/frame-catalog";
import type { LayoutCount } from "@/domain/layout-geometry";
import { getAuthorizedUser } from "@/lib/auth";
import { reconcileBoothReadiness } from "@/lib/booth-readiness";
import { normalizeFramePng, removeSavedFrame, saveFramePng, slugifyFrameName } from "@/lib/frame-storage";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const frameFields = z.object({
  name: z.string().trim().min(2, "Nama frame minimal 2 karakter.").max(80, "Nama frame maksimal 80 karakter."),
  description: z.string().trim().max(240, "Deskripsi maksimal 240 karakter.").optional(),
});

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

function toCatalogItem(frame: FrameWithVersions, allowedCounts?: readonly LayoutCount[]): FrameCatalogItem {
  const assets: FrameCatalogItem["assets"] = {};
  for (const version of frame.versions) {
    const count = Number(version.layoutKind.split("_")[1]) as LayoutCount;
    if ((!allowedCounts || allowedCounts.includes(count)) && !assets[count]) assets[count] = version.assetPath;
  }
  return {
    id: frame.id,
    slug: frame.slug,
    name: frame.name,
    description: frame.description,
    active: frame.active,
    assets,
    variants: layoutEntries.map((entry) => entry.count).filter((count) => Boolean(assets[count])),
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
    const frames = await queryFrames({ tenantId: booth.tenantId, OR: [{ boothId }, { boothId: null }] });
    const layoutCounts = readiness?.layoutCounts ?? [];
    return NextResponse.json({
      frames: frames.map((frame) => toCatalogItem(frame, layoutCounts)).filter((frame) => frame.variants.length > 0),
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
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data frame tidak valid." }, { status: 400 });
    }

    const uploads = await Promise.all(layoutEntries.map(async (layout) => {
      const file = formData.get(layout.field);
      if (!(file instanceof File) || file.size === 0) {
        throw new Error(`PNG untuk Grid ${layout.count} wajib dipilih.`);
      }
      const normalized = await normalizeFramePng(file);
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
          active: true,
          sortOrder: (highestSortOrder._max.sortOrder ?? 0) + 1,
          versions: {
            create: storedUploads.map((upload) => ({
              version: 1,
              layoutKind: upload.kind,
              widthPx: 1200,
              heightPx: 1800,
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
          metadata: { slug, layouts: storedUploads.map((upload) => upload.kind) },
        },
      });
      return created;
    });

    const readiness = await reconcileBoothReadiness(booth.id);
    return NextResponse.json({ frame: toCatalogItem(frame, readiness?.layoutCounts), readiness }, { status: 201 });
  } catch (error) {
    await removeSavedFrame(savedPaths);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Frame gagal disimpan." },
      { status: 400 },
    );
  }
}
