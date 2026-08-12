import { describe, expect, it } from "vitest";
import { extractJpegFrames, isGphoto2OutputForPrefix, parseGphoto2AutoDetect, parseGphoto2CaptureChoices, parseGphoto2SummaryModel, parseUsbipdCanonR100, windowsPathToWslPath } from "./gphoto2-camera-adapter";

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

  it("reads the real model from a generic PTP camera summary", () => {
    expect(parseGphoto2SummaryModel(`
Camera summary:
Manufacturer: Canon.Inc
Model: Canon EOS R100
  Version: 3-1.0.2
`)).toBe("Canon EOS R100");
  });

  it("maps Windows capture paths into WSL", () => {
    expect(windowsPathToWslPath("D:\\Photos\\Snapore Test\\capture.jpg")).toBe("/mnt/d/Photos/Snapore Test/capture.jpg");
  });

  it("accepts normal capture and thumb-prefixed preview output", () => {
    expect(isGphoto2OutputForPrefix("snapore-123.jpg", "snapore-123")).toBe(true);
    expect(isGphoto2OutputForPrefix("thumb_snapore-123.jpg", "snapore-123")).toBe(true);
    expect(isGphoto2OutputForPrefix("another-capture.jpg", "snapore-123")).toBe(false);
  });

  it("parses image and preview capture choices from Canon abilities", () => {
    expect(parseGphoto2CaptureChoices(`
Abilities for camera             : USB PTP Class Camera
Capture choices                  :
                                 : Image
                                 : Preview
Configuration support            : yes
    `)).toEqual({ image: true, preview: true });
  });

  it("extracts complete JPEG frames and keeps a split frame for the next stream chunk", () => {
    const first = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xff, 0xd9]);
    const secondStart = Buffer.from([0xff, 0xd8, 0xff, 0x02]);
    const parsed = extractJpegFrames(Buffer.concat([Buffer.from("noise"), first, secondStart]));
    expect(parsed.frames).toEqual([first]);
    expect(parsed.remainder).toEqual(secondStart);

    const completed = extractJpegFrames(Buffer.concat([parsed.remainder, Buffer.from([0x03, 0xff, 0xd9])]));
    expect(completed.frames).toEqual([Buffer.from([0xff, 0xd8, 0xff, 0x02, 0x03, 0xff, 0xd9])]);
    expect(completed.remainder).toHaveLength(0);
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
