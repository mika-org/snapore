import { describe, expect, it } from "vitest";
import { isSessionResettable, isSixDigitResetCode, SESSION_RESET_CODE_TTL_MINUTES } from "./session-reset";

describe("session reset recovery", () => {
  it("menggunakan kode sekali pakai dengan masa berlaku 10 menit", () => {
    expect(SESSION_RESET_CODE_TTL_MINUTES).toBe(10);
    expect(isSixDigitResetCode("004281")).toBe(true);
    expect(isSixDigitResetCode("4281")).toBe(false);
    expect(isSixDigitResetCode("12A456")).toBe(false);
  });

  it("hanya mengizinkan reset sebelum galeri atau print job dibuat", () => {
    expect(isSessionResettable({ status: "CHECKOUT", hasGallery: false, printJobCount: 0 })).toBe(true);
    expect(isSessionResettable({ status: "COMPLETED", hasGallery: false, printJobCount: 0 })).toBe(false);
    expect(isSessionResettable({ status: "CHECKOUT", hasGallery: true, printJobCount: 0 })).toBe(false);
    expect(isSessionResettable({ status: "CHECKOUT", hasGallery: false, printJobCount: 1 })).toBe(false);
  });
});
