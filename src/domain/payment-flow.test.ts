import { describe, expect, it } from "vitest";
import { paymentAllowsSessionStart } from "./payment-flow";

describe("QRIS payment gate", () => {
  it("hanya membuka sesi setelah pembayaran berstatus PAID", () => {
    expect(paymentAllowsSessionStart("PAID")).toBe(true);
    for (const status of [undefined, null, "IDLE", "PENDING", "EXPIRED", "FAILED", "NOT_REQUIRED"]) {
      expect(paymentAllowsSessionStart(status)).toBe(false);
    }
  });
});
