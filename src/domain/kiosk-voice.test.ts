import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kioskStepVoiceAsset, kioskVoiceAsset, retakeVoiceAsset } from "./kiosk-voice";

describe("Indonesian kiosk voice guide", () => {
  it("memetakan setiap tahap ke rekaman lokal perempuan Indonesia", () => {
    expect(kioskStepVoiceAsset("PAYMENT", 4)).toBe("/voice/id-ID-gadis/payment.mp3");
    expect(kioskStepVoiceAsset("CAPTURE", 8)).toBe("/voice/id-ID-gadis/capture-8.mp3");
  });

  it("menyediakan cue countdown dan feedback sebagai MP3", () => {
    expect(kioskVoiceAsset("COUNTDOWN_3")).toBe("/voice/id-ID-gadis/countdown-3.mp3");
    expect(kioskVoiceAsset("RETAKE_SUCCESS")).toBe("/voice/id-ID-gadis/retake-success.mp3");
  });

  it("membatasi nomor retake ke aset satu sampai delapan", () => {
    expect(retakeVoiceAsset(3)).toBe("/voice/id-ID-gadis/retake-3.mp3");
    expect(retakeVoiceAsset(99)).toBe("/voice/id-ID-gadis/retake-8.mp3");
  });

  it("menyimpan rekaman Gadis Neural dan semua aset utama di public", () => {
    const voiceDirectory = join(process.cwd(), "public", "voice", "id-ID-gadis");
    const manifest = JSON.parse(readFileSync(join(voiceDirectory, "manifest.json"), "utf8")) as {
      voice: string;
      gender: string;
      assets: Record<string, { file: string }>;
    };
    expect(manifest.voice).toBe("id-ID-GadisNeural");
    expect(manifest.gender).toBe("female");
    expect(Object.keys(manifest.assets)).toHaveLength(29);
    expect(Object.values(manifest.assets).every(({ file }) => existsSync(join(voiceDirectory, file)))).toBe(true);
  });
});
