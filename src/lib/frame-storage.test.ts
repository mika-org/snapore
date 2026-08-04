import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { FRAME_HEIGHT, FRAME_WIDTH, normalizeFramePng, slugifyFrameName } from "./frame-storage";

describe("frame storage", () => {
  it("membuat slug yang aman untuk path dan database", () => {
    expect(slugifyFrameName("  Bunga Malam #01  ")).toBe("bunga-malam-01");
    expect(slugifyFrameName("Édition Spéciale")).toBe("edition-speciale");
  });

  it("menerima PNG transparan 1200x1800", async () => {
    const bytes = await sharp({
      create: { width: FRAME_WIDTH, height: FRAME_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
    const result = await normalizeFramePng(new File([bytes], "frame.png", { type: "image/png" }));
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("menolak ukuran PNG yang tidak sesuai", async () => {
    const bytes = await sharp({
      create: { width: 600, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
    await expect(normalizeFramePng(new File([bytes], "small.png", { type: "image/png" })))
      .rejects.toThrow("1200×1800");
  });
});
