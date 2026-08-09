import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeFramePng, slugifyFrameName } from "./frame-storage";

describe("frame storage", () => {
  it("membuat slug yang aman untuk path dan database", () => {
    expect(slugifyFrameName("  Bunga Malam #01  ")).toBe("bunga-malam-01");
    expect(slugifyFrameName("Édition Spéciale")).toBe("edition-speciale");
  });

  it("menerima PNG transparan portrait dan mendeteksi ukuran 1200x1800", async () => {
    const bytes = await sharp({
      create: { width: 600, height: 900, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } },
    }).composite([
      { input: Buffer.from('<svg width="600" height="900"><rect x="40" y="80" width="520" height="330" fill="black"/><rect x="40" y="450" width="520" height="330" fill="black"/></svg>'), blend: "dest-out" },
    ]).png().toBuffer();
    const result = await normalizeFramePng(new File([bytes], "portrait.png", { type: "image/png" }), 2);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(result.widthPx).toBe(1200);
    expect(result.heightPx).toBe(1800);
    expect(result.orientation).toBe("portrait");
    expect(result.slots).toHaveLength(2);
  });

  it("menerima PNG transparan landscape dan mendeteksi ukuran 1800x1200", async () => {
    const bytes = await sharp({
      create: { width: 1920, height: 1080, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } },
    }).composite([
      { input: Buffer.from('<svg width="1920" height="1080"><rect x="240" y="100" width="650" height="760" fill="black"/><rect x="1030" y="100" width="650" height="760" fill="black"/></svg>'), blend: "dest-out" },
    ]).png().toBuffer();
    const result = await normalizeFramePng(new File([bytes], "landscape.png", { type: "image/png" }), 2);
    expect(result.widthPx).toBe(1800);
    expect(result.heightPx).toBe(1200);
    expect(result.orientation).toBe("landscape");
    expect(result.slots).toHaveLength(2);
  });
});
