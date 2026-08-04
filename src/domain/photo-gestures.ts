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
