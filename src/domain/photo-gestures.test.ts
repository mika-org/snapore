import { describe, expect, it } from "vitest";
import { clampGestureValue, getGestureMetrics, getPhotoTransformGeometry, normalizeGestureAngle } from "./photo-gestures";

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

  it("menaikkan cover scale ketika foto diputar agar sudut slot tetap tertutup", () => {
    const normal = getPhotoTransformGeometry({ imageWidth: 1600, imageHeight: 1200, slotWidth: 800, slotHeight: 600, rotation: 0 });
    const diagonal = getPhotoTransformGeometry({ imageWidth: 1600, imageHeight: 1200, slotWidth: 800, slotHeight: 600, rotation: 45 });
    expect(normal.scale).toBeCloseTo(0.5);
    expect(diagonal.scale).toBeGreaterThan(normal.scale);
  });

  it("mengunci pan pada batas foto yang masih menutup seluruh slot", () => {
    const atCover = getPhotoTransformGeometry({
      imageWidth: 1200,
      imageHeight: 1800,
      slotWidth: 600,
      slotHeight: 900,
      zoom: 1,
      offsetX: 0.4,
      offsetY: -0.4,
    });
    expect(atCover.offsetX).toBeCloseTo(0);
    expect(atCover.offsetY).toBeCloseTo(0);

    const zoomed = getPhotoTransformGeometry({
      imageWidth: 1200,
      imageHeight: 1800,
      slotWidth: 600,
      slotHeight: 900,
      zoom: 2,
      offsetX: 0.4,
      offsetY: -0.4,
    });
    expect(zoomed.offsetX).toBeCloseTo(0.4);
    expect(zoomed.offsetY).toBeCloseTo(-0.4);
  });
});
