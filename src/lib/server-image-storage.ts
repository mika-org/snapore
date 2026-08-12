import sharp from "sharp";

export type ServerImageKind = "ORIGINAL" | "COMPOSITE";

export type ServerImageStorageConfig = {
  originalMaxEdge: number;
  originalQuality: number;
  compositeMaxEdge: number;
  compositeQuality: number;
};

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function resolveServerImageStorageConfig(environment: Record<string, string | undefined> = process.env): ServerImageStorageConfig {
  return {
    originalMaxEdge: boundedInteger(environment.SNAPORE_SERVER_ORIGINAL_MAX_EDGE, 2_400, 1_200, 6_000),
    originalQuality: boundedInteger(environment.SNAPORE_SERVER_ORIGINAL_JPEG_QUALITY, 78, 55, 95),
    compositeMaxEdge: boundedInteger(environment.SNAPORE_SERVER_COMPOSITE_MAX_EDGE, 1_800, 1_200, 3_600),
    compositeQuality: boundedInteger(environment.SNAPORE_SERVER_COMPOSITE_JPEG_QUALITY, 86, 65, 95),
  };
}

export async function optimizeServerImage(
  source: Uint8Array,
  kind: ServerImageKind,
  config = resolveServerImageStorageConfig(),
) {
  const maxEdge = kind === "COMPOSITE" ? config.compositeMaxEdge : config.originalMaxEdge;
  const quality = kind === "COMPOSITE" ? config.compositeQuality : config.originalQuality;
  const { data, info } = await sharp(source, { failOn: "error", limitInputPixels: 120_000_000 })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality, progressive: true, mozjpeg: true, chromaSubsampling: "4:2:0", optimizeCoding: true })
    .toBuffer({ resolveWithObject: true });

  if (data.length === 0 || data.length > 8 * 1024 * 1024) throw new Error("Hasil optimasi asset tidak valid");
  return {
    bytes: data,
    mimeType: "image/jpeg" as const,
    extension: ".jpg" as const,
    width: info.width,
    height: info.height,
    sourceByteSize: source.byteLength,
    byteSize: data.length,
  };
}
