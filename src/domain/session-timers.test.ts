import { describe, expect, it } from "vitest";
import { formatSessionTimer, PAYMENT_WINDOW_SECONDS, remainingSeconds, SESSION_WINDOW_SECONDS } from "./session-timers";

describe("kiosk session timers", () => {
  it("menggunakan window QRIS 5 menit dan sesi 15 menit", () => {
    expect(PAYMENT_WINDOW_SECONDS).toBe(300);
    expect(SESSION_WINDOW_SECONDS).toBe(900);
  });

  it("menghitung sisa waktu tanpa menghasilkan angka negatif", () => {
    expect(remainingSeconds(305_000, 5_000)).toBe(300);
    expect(remainingSeconds(4_999, 5_000)).toBe(0);
  });

  it("memformat countdown menjadi mm:ss", () => {
    expect(formatSessionTimer(300)).toBe("05:00");
    expect(formatSessionTimer(61)).toBe("01:01");
    expect(formatSessionTimer(0)).toBe("00:00");
  });
});
