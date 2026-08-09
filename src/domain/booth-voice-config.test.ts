import { describe, expect, it } from "vitest";
import { getBoothVoiceEnabled, mergeBoothVoiceConfig } from "./booth-voice-config";

describe("booth voice configuration", () => {
  it("keeps voice enabled for booths without an explicit setting", () => {
    expect(getBoothVoiceEnabled(null)).toBe(true);
    expect(getBoothVoiceEnabled({})).toBe(true);
  });

  it("reads and merges the live voice setting without dropping other config", () => {
    expect(getBoothVoiceEnabled({ voiceEnabled: false })).toBe(false);
    expect(mergeBoothVoiceConfig({ camera: "dslr" }, false)).toEqual({ camera: "dslr", voiceEnabled: false });
  });
});
