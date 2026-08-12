import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { optimizeServerImage, resolveServerImageStorageConfig } from "./server-image-storage";

describe("server image storage optimization", () => {
  it("uses storage-conscious defaults and bounded environment overrides", () => {
    expect(resolveServerImageStorageConfig({
      SNAPORE_SERVER_ORIGINAL_MAX_EDGE: "2048",
      SNAPORE_SERVER_ORIGINAL_JPEG_QUALITY: "74",
      SNAPORE_SERVER_COMPOSITE_MAX_EDGE: "999999",
      SNAPORE_SERVER_COMPOSITE_JPEG_QUALITY: "10",
    })).toEqual({
      originalMaxEdge: 2048,
      originalQuality: 74,
      compositeMaxEdge: 1800,
      compositeQuality: 86,
    });
  });

  it("downscales a raw capture and stores it as optimized JPEG", async () => {
    const source = await sharp({
      create: { width: 4_000, height: 3_000, channels: 3, background: { r: 90, g: 140, b: 210 } },
    }).png().toBuffer();
    const optimized = await optimizeServerImage(source, "ORIGINAL", {
      originalMaxEdge: 2_000,
      originalQuality: 76,
      compositeMaxEdge: 1_800,
      compositeQuality: 86,
    });

    expect(optimized.mimeType).toBe("image/jpeg");
    expect(optimized.extension).toBe(".jpg");
    expect(optimized.width).toBe(2_000);
    expect(optimized.height).toBe(1_500);
    expect(optimized.byteSize).toBeLessThan(optimized.sourceByteSize);
  });

  it("keeps the framed composite within its print-preview dimensions", async () => {
    const source = await sharp({
      create: { width: 1_200, height: 1_800, channels: 3, background: { r: 240, g: 230, b: 220 } },
    }).jpeg({ quality: 95 }).toBuffer();
    const optimized = await optimizeServerImage(source, "COMPOSITE");
    expect({ width: optimized.width, height: optimized.height }).toEqual({ width: 1_200, height: 1_800 });
    expect(optimized.byteSize).toBeLessThanOrEqual(optimized.sourceByteSize);
  });
});
