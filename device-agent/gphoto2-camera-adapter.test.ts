import { describe, expect, it } from "vitest";
import { parseGphoto2AutoDetect, parseUsbipdCanonR100, windowsPathToWslPath } from "./gphoto2-camera-adapter";

describe("gPhoto2 PTP camera adapter", () => {
  it("parses Canon cameras and their USB ports", () => {
    expect(parseGphoto2AutoDetect(`
Model                          Port
----------------------------------------------------------
Canon EOS R100                 usb:001,004
Canon EOS R50                  usb:002,003
`)).toEqual([
      { name: "Canon EOS R100", port: "usb:001,004" },
      { name: "Canon EOS R50", port: "usb:002,003" },
    ]);
  });

  it("returns no camera for an empty auto-detect result", () => {
    expect(parseGphoto2AutoDetect("Model                          Port\n----------------------------------------------------------\n")).toEqual([]);
  });

  it("maps Windows capture paths into WSL", () => {
    expect(windowsPathToWslPath("D:\\Photos\\Snapore Test\\capture.jpg")).toBe("/mnt/d/Photos/Snapore Test/capture.jpg");
  });

  it("finds the R100 BUSID and sharing state from usbipd", () => {
    expect(parseUsbipdCanonR100(`
Connected:
BUSID  VID:PID    DEVICE                                      STATE
2-3    04a9:3312  Canon EOS R100                              Shared
`)).toEqual({ busId: "2-3", state: "SHARED" });
  });

  it("reports when the R100 still needs its one-time admin bind", () => {
    expect(parseUsbipdCanonR100("2-3    04a9:3312  Canon EOS R100    Not shared"))
      .toEqual({ busId: "2-3", state: "NOT_SHARED" });
  });
});
