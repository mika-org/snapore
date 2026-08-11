import { describe, expect, it } from "vitest";
import { BYPASS_PAYMENT_PROVIDER, classifySession, isTestingSession } from "./session-classification";

describe("session classification", () => {
  it("menganggap pembayaran bypass sebagai sesi testing", () => {
    expect(classifySession({ paymentProvider: BYPASS_PAYMENT_PROVIDER, paymentMetadata: { reason: "QA frame" } })).toEqual({ kind: "TESTING", reason: "QA frame" });
  });

  it("mengganti catatan bypass kosong dengan penjelasan yang informatif", () => {
    expect(classifySession({ paymentProvider: BYPASS_PAYMENT_PROVIDER, paymentMetadata: { reason: "-" } }).reason).toBe("Bypass pembayaran kiosk");
  });

  it("menganggap pembayaran Xendit TEST sebagai sesi testing", () => {
    expect(isTestingSession({ paymentProvider: "XENDIT", paymentMetadata: { environment: "TEST" } })).toBe(true);
  });

  it("menghormati penanda testing eksplisit pada metadata sesi", () => {
    expect(classifySession({ sessionMetadata: { sessionKind: "TESTING", testingReason: "Kalibrasi kamera" } })).toEqual({ kind: "TESTING", reason: "Kalibrasi kamera" });
  });

  it("menganggap pembayaran live dan sesi reguler sebagai production", () => {
    expect(classifySession({ paymentProvider: "XENDIT", paymentMetadata: { environment: "LIVE" } })).toEqual({ kind: "PRODUCTION", reason: null });
  });
});
