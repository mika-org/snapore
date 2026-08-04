import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string; assetId: string }> }) {
  const { token, assetId } = await params;
  const galleryToken = await prisma.galleryToken.findUnique({ where: { tokenHash: hash(token) }, include: { gallery: true } }).catch(() => null);
  if (!galleryToken || galleryToken.revokedAt || galleryToken.expiresAt < new Date() || !galleryToken.gallery.active) {
    return NextResponse.json({ error: "Gallery link tidak valid" }, { status: 404 });
  }
  const asset = await prisma.asset.findFirst({ where: { id: assetId, sessionId: galleryToken.gallery.sessionId } });
  if (!asset?.objectKey) return NextResponse.json({ error: "Asset tidak ditemukan" }, { status: 404 });

  const root = resolve(/* turbopackIgnore: true */ process.env.SNAPORE_SERVER_UPLOAD_DIR ?? "./server-uploads");
  const filePath = resolve(/* turbopackIgnore: true */ root, asset.objectKey);
  if (!filePath.startsWith(`${root}${sep}`)) return NextResponse.json({ error: "Path asset tidak valid" }, { status: 400 });

  try {
    const bytes = await readFile(/* turbopackIgnore: true */ filePath);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(bytes, {
      headers: {
        "content-type": asset.mimeType,
        "content-length": String(bytes.length),
        "cache-control": "private, max-age=300",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="snapore-${asset.id}${extname(filePath)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "File asset tidak tersedia" }, { status: 404 });
  }
}
