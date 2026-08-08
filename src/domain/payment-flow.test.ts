import { describe, expect, it } from "vitest";
import { paymentAllowsSessionStart } from "./payment-flow";

describe("payment gate", () => {
  it("membuka sesi untuk pembayaran lunas atau yang memang tidak diwajibkan", () => {
    expect(paymentAllowsSessionStart("PAID")).toBe(true);
    expect(paymentAllowsSessionStart("NOT_REQUIRED")).toBe(true);
    for (const status of [undefined, null, "IDLE", "PENDING", "EXPIRED", "FAILED"]) {
      expect(paymentAllowsSessionStart(status)).toBe(false);
    }
  });
});
