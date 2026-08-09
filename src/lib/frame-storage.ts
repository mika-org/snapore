import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { LayoutCount } from "@/domain/layout-geometry";
import { detectTransparentFrameSlots } from "./frame-slot-detection";

export const FRAME_WIDTH = 1200;
export const FRAME_HEIGHT = 1800;
export const MAX_FRAME_BYTES = 10 * 1024 * 1024;

export function slugifyFrameName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "frame";
}

export async function normalizeFramePng(file: File, count: LayoutCount) {
  if (file.size <= 0 || file.size > MAX_FRAME_BYTES) {
    throw new Error("Ukuran setiap PNG harus antara 1 byte dan 10 MB.");
  }
  if (file.type !== "image/png") {
    throw new Error("Frame hanya menerima file PNG transparan.");
  }

  const source = Buffer.from(await file.arrayBuffer());
  const image = sharp(source);
  const metadata = await image.metadata();
  if (metadata.format !== "png") {
    throw new Error("Isi file tidak terdeteksi sebagai PNG yang valid.");
  }
  if (!metadata.hasAlpha) {
    throw new Error("PNG harus memiliki kanal transparansi untuk area foto.");
  }

  const isLandscape = (metadata.width ?? 1200) > (metadata.height ?? 1800);
  const widthPx = isLandscape ? 1800 : 1200;
  const heightPx = isLandscape ? 1200 : 1800;

  const processed = metadata.width === widthPx && metadata.height === heightPx
    ? image
    : image.resize(widthPx, heightPx, {
        fit: "cover",
        position: "centre",
        kernel: sharp.kernel.lanczos3,
      });

  const bytes = await processed
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: true })
    .toBuffer();
  const slots = await detectTransparentFrameSlots(bytes, count, widthPx, heightPx);

  return {
    bytes,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    widthPx,
    heightPx,
    orientation: isLandscape ? ("landscape" as const) : ("portrait" as const),
    slots,
  };
}

export async function saveFramePng(tenantId: string, boothId: string, slug: string, count: LayoutCount, bytes: Buffer, checksum: string) {
  const relativeDirectory = join("uploads", "frames", tenantId, boothId, slug);
  const absoluteDirectory = join(process.cwd(), "public", relativeDirectory);
  await mkdir(absoluteDirectory, { recursive: true });

  const fileName = `grid-${count}-${checksum.slice(0, 12)}-${randomUUID()}.png`;
  const absolutePath = join(absoluteDirectory, fileName);
  await writeFile(absolutePath, bytes, { flag: "wx" });

  return {
    absolutePath,
    assetPath: `/${relativeDirectory.replaceAll("\\", "/")}/${fileName}`,
  };
}

export async function removeSavedFrame(paths: string[]) {
  await Promise.all(paths.map((path) => unlink(path).catch(() => undefined)));
}
