import { extname, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });

  const { assetId } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { session: { select: { booth: { select: { tenantId: true } } } } },
  });
  if (!asset || (user.role !== "SUPER_ADMIN" && user.tenantId !== asset.session.booth.tenantId)) {
    return NextResponse.json({ error: "Aset foto tidak ditemukan." }, { status: 404 });
  }

  const uploadRoot = resolve(/* turbopackIgnore: true */ process.env.SNAPORE_SERVER_UPLOAD_DIR ?? "./server-uploads");
  const filePath = asset.objectKey
    ? resolve(/* turbopackIgnore: true */ uploadRoot, asset.objectKey)
    : asset.localPath
      ? resolve(/* turbopackIgnore: true */ asset.localPath)
      : null;
  if (!filePath || (filePath !== uploadRoot && !filePath.startsWith(`${uploadRoot}${sep}`))) {
    return NextResponse.json({ error: "Path aset tidak valid." }, { status: 400 });
  }

  try {
    const bytes = await readFile(/* turbopackIgnore: true */ filePath);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(bytes, {
      headers: {
        "content-type": asset.mimeType,
        "content-length": String(bytes.length),
        "cache-control": "private, max-age=60",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="snapore-${asset.kind.toLowerCase()}-${asset.id}${extname(filePath)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "File foto tidak tersedia." }, { status: 404 });
  }
}
