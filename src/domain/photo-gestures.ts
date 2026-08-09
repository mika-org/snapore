export type GesturePoint = { x: number; y: number };

export function clampGestureValue(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getGestureMetrics(points: Iterable<GesturePoint>) {
  const values = [...points];
  if (!values.length) return { center: null, distance: 0, angle: 0 };
  if (values.length === 1) return { center: values[0], distance: 0, angle: 0 };
  const [first, second] = values;
  return {
    center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    distance: Math.hypot(second.x - first.x, second.y - first.y),
    angle: Math.atan2(second.y - first.y, second.x - first.x) * (180 / Math.PI),
  };
}

export function normalizeGestureAngle(value: number) {
  if (value > 180) return value - 360;
  if (value < -180) return value + 360;
  return value;
}

export type PhotoTransformGeometry = {
  scale: number;
  offsetX: number;
  offsetY: number;
  widthPercent: number;
  heightPercent: number;
};

/**
 * Calculates a rotation-aware cover transform. The returned translation is
 * clamped in the photo's local axes, so no corner of the slot can reveal an
 * empty background while the photo is panned, zoomed, or rotated.
 */
export function getPhotoTransformGeometry(input: {
  imageWidth: number;
  imageHeight: number;
  slotWidth: number;
  slotHeight: number;
  rotation?: number;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
}): PhotoTransformGeometry {
  const imageWidth = Math.max(1, input.imageWidth);
  const imageHeight = Math.max(1, input.imageHeight);
  const slotWidth = Math.max(1, input.slotWidth);
  const slotHeight = Math.max(1, input.slotHeight);
  const radians = ((input.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const absCos = Math.abs(cos);
  const absSin = Math.abs(sin);

  const projectedHalfWidth = (slotWidth * absCos + slotHeight * absSin) / 2;
  const projectedHalfHeight = (slotWidth * absSin + slotHeight * absCos) / 2;
  const coverScale = Math.max(
    (projectedHalfWidth * 2) / imageWidth,
    (projectedHalfHeight * 2) / imageHeight,
  );
  const scale = coverScale * clampGestureValue(input.zoom ?? 1, 1, 4);

  const requestedX = (input.offsetX ?? 0) * slotWidth;
  const requestedY = (input.offsetY ?? 0) * slotHeight;
  const localX = cos * requestedX + sin * requestedY;
  const localY = -sin * requestedX + cos * requestedY;
  const maxLocalX = Math.max(0, (imageWidth * scale) / 2 - projectedHalfWidth);
  const maxLocalY = Math.max(0, (imageHeight * scale) / 2 - projectedHalfHeight);
  const clampedLocalX = clampGestureValue(localX, -maxLocalX, maxLocalX);
  const clampedLocalY = clampGestureValue(localY, -maxLocalY, maxLocalY);
  const translatedX = cos * clampedLocalX - sin * clampedLocalY;
  const translatedY = sin * clampedLocalX + cos * clampedLocalY;

  return {
    scale,
    offsetX: translatedX / slotWidth,
    offsetY: translatedY / slotHeight,
    widthPercent: (imageWidth * scale * 100) / slotWidth,
    heightPercent: (imageHeight * scale * 100) / slotHeight,
  };
}
