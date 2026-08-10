import { describe, expect, it } from "vitest";
import { getPaperLevel, remainingPaperAfterPrint } from "./paper-counter";

describe("paper counter", () => {
  it("marks empty and low stock at the configured boundary", () => {
    expect(getPaperLevel(0, 20)).toBe("EMPTY");
    expect(getPaperLevel(20, 20)).toBe("LOW");
    expect(getPaperLevel(21, 20)).toBe("OK");
  });

  it("decrements one sheet per copy", () => {
    expect(remainingPaperAfterPrint(100, 3)).toBe(97);
  });

  it("never produces a negative paper count", () => {
    expect(remainingPaperAfterPrint(1, 4)).toBe(0);
  });
});
