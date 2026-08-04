import { describe, expect, it } from "vitest";
import { clampGestureValue, getGestureMetrics, normalizeGestureAngle } from "./photo-gestures";

describe("photo editor gestures", () => {
  it("menghitung center, pinch distance, dan twist angle dari dua jari", () => {
    expect(getGestureMetrics([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toEqual({
      center: { x: 0, y: 50 },
      distance: 100,
      angle: 90,
    });
  });

  it("menormalkan twist yang melewati batas 180 derajat", () => {
    expect(normalizeGestureAngle(358)).toBe(-2);
    expect(normalizeGestureAngle(-358)).toBe(2);
  });

  it("membatasi zoom dan posisi agar foto tidak hilang dari canvas", () => {
    expect(clampGestureValue(3, 1, 2.25)).toBe(2.25);
    expect(clampGestureValue(-.8, -.4, .4)).toBe(-.4);
  });
});
