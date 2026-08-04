import { describe, expect, it } from "vitest";
import { calculateOrder, transitionSession } from "./session";

describe("kiosk session state machine", () => {
  it("menjalankan happy path", () => {
    let state = transitionSession("IDLE", "START");
    state = transitionSession(state, "PAYMENT_COMPLETE");
    state = transitionSession(state, "SELECT_LAYOUT");
    state = transitionSession(state, "SELECT_FRAME");
    state = transitionSession(state, "CAPTURE_COMPLETE");
    state = transitionSession(state, "APPROVE_PHOTOS");
    state = transitionSession(state, "CONFIRM_PRINT");
    state = transitionSession(state, "PRINT_COMPLETE");
    expect(state).toBe("DONE");
  });

  it("menolak transisi ilegal", () => {
    expect(() => transitionSession("IDLE", "CONFIRM_PRINT")).toThrow(/tidak valid/);
  });

  it.each([2, 4, 6, 8])("retake satu slot pada grid %i kembali ke review", () => {
    expect(transitionSession("REVIEW", "RETAKE_PHOTO")).toBe("CAPTURE");
    expect(transitionSession("CAPTURE", "RETAKE_COMPLETE")).toBe("REVIEW");
  });
});

describe("order pricing", () => {
  it("menghitung tambahan copy setelah copy pertama", () => {
    expect(calculateOrder(50_000, 20_000, 3)).toEqual({
      copies: 3,
      subtotal: 90_000,
      tax: 0,
      total: 90_000,
    });
  });
});
