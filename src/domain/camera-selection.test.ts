import { describe, expect, it } from "vitest";
import { selectPreferredBrowserCamera } from "./camera-selection";

const camera = (deviceId: string, label: string) => ({ deviceId, label, kind: "videoinput" as MediaDeviceKind });

describe("automatic browser camera selection", () => {
  it("prefers a connected DSLR or external webcam on a booth computer", () => {
    expect(selectPreferredBrowserCamera([camera("built-in", "Integrated Camera"), camera("canon", "Canon EOS Webcam Utility")])?.deviceId).toBe("canon");
  });

  it("prefers the front camera on a phone or tablet", () => {
    expect(selectPreferredBrowserCamera([camera("rear", "Back Camera"), camera("front", "Front Camera")], "Android Mobile")?.deviceId).toBe("front");
  });
});
