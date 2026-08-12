import { describe, expect, it } from "vitest";
import { isPermanentUploadFailure } from "./upload-policy";

describe("isPermanentUploadFailure", () => {
  it("stops retrying invalid booth identity and authorization", () => {
    expect(isPermanentUploadFailure(400, "Booth agent belum terdaftar pada tenant.")).toBe(true);
    expect(isPermanentUploadFailure(401, "Otorisasi sinkronisasi tidak valid")).toBe(true);
  });

  it("keeps retrying temporary server and network-adjacent failures", () => {
    expect(isPermanentUploadFailure(400, "Database connection temporarily unavailable")).toBe(false);
    expect(isPermanentUploadFailure(500, "Internal Server Error")).toBe(false);
    expect(isPermanentUploadFailure(503, "Service Unavailable")).toBe(false);
  });
});
