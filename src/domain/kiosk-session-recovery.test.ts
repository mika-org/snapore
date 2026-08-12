import { describe, expect, it } from "vitest";
import { newestKioskRecoveryCandidate, resolveKioskRecovery } from "./kiosk-session-recovery";

describe("kiosk refresh recovery", () => {
  it("memilih snapshot paling baru antara IndexedDB dan shadow snapshot", () => {
    const older = { sessionId: "session-1", savedAt: "2026-08-12T10:00:00.000Z", state: { step: "FRAME" } };
    const newer = { sessionId: "session-1", savedAt: "2026-08-12T10:00:01.000Z", state: { step: "CAPTURE" } };
    expect(newestKioskRecoveryCandidate([older, newer])).toBe(newer);
  });

  it.each(["PAYMENT", "LAYOUT", "FRAME", "DONE"] as const)("mempertahankan step %s", (step) => {
    expect(resolveKioskRecovery({
      step,
      photoCount: 0,
      requiredPhotoCount: 4,
      hasComposite: false,
      hasSubmittedJob: false,
      retakeIndex: null,
      retakesUsed: 0,
      retakeCompletedAfterSnapshot: false,
    }).step).toBe(step);
  });

  it("melanjutkan capture yang sudah lengkap ke review", () => {
    expect(resolveKioskRecovery({
      step: "CAPTURE",
      photoCount: 4,
      requiredPhotoCount: 4,
      hasComposite: false,
      hasSubmittedJob: false,
      retakeIndex: null,
      retakesUsed: 0,
      retakeCompletedAfterSnapshot: false,
    }).step).toBe("REVIEW");
  });

  it.each([
    { step: "CAPTURE", photoCount: 2, hasComposite: false, expected: "CAPTURE" },
    { step: "REVIEW", photoCount: 4, hasComposite: false, expected: "REVIEW" },
    { step: "CHECKOUT", photoCount: 4, hasComposite: true, expected: "CHECKOUT" },
  ] as const)("memulihkan $step yang masih konsisten ke step yang sama", ({ step, photoCount, hasComposite, expected }) => {
    expect(resolveKioskRecovery({
      step,
      photoCount,
      requiredPhotoCount: 4,
      hasComposite,
      hasSubmittedJob: false,
      retakeIndex: null,
      retakesUsed: 0,
      retakeCompletedAfterSnapshot: false,
    }).step).toBe(expected);
  });

  it("menyelesaikan retake yang tersimpan setelah snapshot", () => {
    expect(resolveKioskRecovery({
      step: "CAPTURE",
      photoCount: 4,
      requiredPhotoCount: 4,
      hasComposite: false,
      hasSubmittedJob: false,
      retakeIndex: 2,
      retakesUsed: 0,
      retakeCompletedAfterSnapshot: true,
    })).toEqual({ step: "REVIEW", retakeIndex: null, retakesUsed: 1 });
  });

  it("mengembalikan review yang kekurangan foto ke capture", () => {
    expect(resolveKioskRecovery({
      step: "REVIEW",
      photoCount: 3,
      requiredPhotoCount: 4,
      hasComposite: false,
      hasSubmittedJob: false,
      retakeIndex: null,
      retakesUsed: 0,
      retakeCompletedAfterSnapshot: false,
    }).step).toBe("CAPTURE");
  });

  it("hanya menganggap printing selesai jika job sudah tercatat", () => {
    const base = {
      step: "PRINTING" as const,
      photoCount: 4,
      requiredPhotoCount: 4,
      hasComposite: true,
      retakeIndex: null,
      retakesUsed: 0,
      retakeCompletedAfterSnapshot: false,
    };
    expect(resolveKioskRecovery({ ...base, hasSubmittedJob: true }).step).toBe("DONE");
    expect(resolveKioskRecovery({ ...base, hasSubmittedJob: false }).step).toBe("CHECKOUT");
  });
});
