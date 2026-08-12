import { describe, expect, it } from "vitest";
import { selectPreferredAgentCamera, selectPreferredBrowserCamera } from "./camera-selection";

const camera = (deviceId: string, label: string) => ({ deviceId, label, kind: "videoinput" as MediaDeviceKind });

describe("automatic browser camera selection", () => {
  it("prefers a connected DSLR or external webcam on a booth computer", () => {
    expect(selectPreferredBrowserCamera([camera("built-in", "Integrated Camera"), camera("canon", "Canon EOS Webcam Utility")])?.deviceId).toBe("canon");
  });

  it("prefers the front camera on a phone or tablet", () => {
    expect(selectPreferredBrowserCamera([camera("rear", "Back Camera"), camera("front", "Front Camera")], "Android Mobile")?.deviceId).toBe("front");
  });

  it("keeps the Canon virtual camera free while EDSDK owns the R100", () => {
    expect(selectPreferredBrowserCamera(
      [camera("built-in", "Integrated Camera"), camera("canon", "Canon EOS Webcam Utility")],
      "Windows",
      { avoidSdkControlledCamera: true },
    )?.deviceId).toBe("built-in");
  });

  it("uses the SDK camera selected by the local agent", () => {
    const selected = selectPreferredAgentCamera([
      { id: "browser-camera", type: "CAMERA", name: "Browser camera", status: "ONLINE" },
      { id: "CANON_EDSDK:r50", type: "CAMERA", kind: "CANON_EDSDK", name: "Canon EOS R50", status: "ONLINE", capabilities: { sdkBridge: true } },
      { id: "CANON_EDSDK:r100", type: "CAMERA", kind: "CANON_EDSDK", name: "Canon EOS R100", status: "ONLINE", capabilities: { sdkBridge: true, autoSelected: true } },
    ]);

    expect(selected?.id).toBe("CANON_EDSDK:r100");
  });

  it("uses the R100 selected through gPhoto2/PTP", () => {
    const selected = selectPreferredAgentCamera([
      { id: "browser-camera", type: "CAMERA", name: "Browser camera", status: "ONLINE" },
      { id: "GPHOTO2_PTP:usb:001,004", type: "CAMERA", kind: "GPHOTO2_PTP", name: "Canon EOS R100", status: "ONLINE", capabilities: { ptp: true, gphoto2: true, autoSelected: true } },
    ]);

    expect(selected?.id).toBe("GPHOTO2_PTP:usb:001,004");
  });

  it("falls back to another online SDK camera when the R100 is disconnected", () => {
    const selected = selectPreferredAgentCamera([
      { id: "CANON_EDSDK:r100", type: "CAMERA", kind: "CANON_EDSDK", name: "Canon EOS R100", status: "OFFLINE", capabilities: { sdkBridge: true } },
      { id: "VENDOR_SDK:fallback", type: "CAMERA", kind: "VENDOR_SDK", name: "USB camera bridge", status: "ONLINE", capabilities: { sdkBridge: true, autoSelected: true } },
    ]);

    expect(selected?.id).toBe("VENDOR_SDK:fallback");
  });
});
