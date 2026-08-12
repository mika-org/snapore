import { describe, expect, it } from "vitest";
import type { DiscoveredDevice } from "./contracts";
import { rankSdkCameras, sdkCameraPriority } from "./camera-selection";

function camera(id: string, name: string, kind = "VENDOR_SDK", status: DiscoveredDevice["status"] = "ONLINE"): DiscoveredDevice {
  return { id, fingerprint: id, type: "CAMERA", kind, name, status, capabilities: { sdkBridge: true } };
}

describe("SDK camera auto-selection", () => {
  it("prioritizes a Canon EOS R100 connected over PTP", () => {
    const selected = rankSdkCameras([
      { device: camera("fallback", "Generic tethered camera") },
      { device: { ...camera("GPHOTO2_PTP:usb:001,004", "Canon EOS R100", "GPHOTO2_PTP"), capabilities: { ptp: true, gphoto2: true } } },
    ])[0];

    expect(selected.device.kind).toBe("GPHOTO2_PTP");
  });

  it("prioritizes Canon EOS R100 over other SDK cameras", () => {
    const ranked = rankSdkCameras([
      { device: camera("sony", "Sony Alpha") },
      { device: camera("r100", "Canon EOS R100", "CANON_EDSDK") },
      { device: camera("r50", "Canon EOS R50", "CANON_EDSDK") },
    ]);

    expect(ranked[0].device.id).toBe("r100");
  });

  it("keeps an offline R100 below an online fallback", () => {
    expect(sdkCameraPriority(camera("r100", "Canon EOS R100", "CANON_EDSDK", "OFFLINE")))
      .toBeLessThan(sdkCameraPriority(camera("fallback", "Generic tethered camera")));
  });

  it("supports a configurable preferred Canon model", () => {
    const ranked = rankSdkCameras([
      { device: camera("r100", "Canon EOS R100", "CANON_EDSDK") },
      { device: camera("r50", "Canon EOS R50", "CANON_EDSDK") },
    ], "EOS R50");

    expect(ranked[0].device.id).toBe("r50");
  });
});
