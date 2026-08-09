import { describe, expect, it } from "vitest";
import { paymentAllowsSessionStart, paymentRequiresBypass } from "./payment-flow";

describe("payment gate", () => {
  it("membuka sesi untuk pembayaran lunas atau yang memang tidak diwajibkan", () => {
    expect(paymentAllowsSessionStart("PAID")).toBe(true);
    expect(paymentAllowsSessionStart("NOT_REQUIRED")).toBe(true);
    for (const status of [undefined, null, "IDLE", "PENDING", "EXPIRED", "FAILED"]) {
      expect(paymentAllowsSessionStart(status)).toBe(false);
    }
  });

  it("mengalihkan konfigurasi QRIS yang belum siap ke otorisasi bypass", () => {
    expect(paymentRequiresBypass("BYPASS_REQUIRED", true)).toBe(true);
    expect(paymentRequiresBypass("BYPASS_REQUIRED", false)).toBe(false);
    expect(paymentRequiresBypass("PENDING", true)).toBe(false);
  });
});
