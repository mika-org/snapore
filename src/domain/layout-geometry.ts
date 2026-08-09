export type LayoutCount = 2 | 4 | 6 | 8;
export type FrameOrientation = "portrait" | "landscape";

export type LayoutSlotGeometry = {
  slotIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FrameAssetGeometry = {
  width: number;
  height: number;
  orientation: FrameOrientation;
  slots: LayoutSlotGeometry[];
};

export function getPrintCanvas(orientation: FrameOrientation = "portrait") {
  const isLandscape = orientation === "landscape";
  return {
    width: isLandscape ? 1800 : 1200,
    height: isLandscape ? 1200 : 1800,
    dpi: 300,
    gap: 34,
    marginX: isLandscape ? 72 : 72,
    top: isLandscape ? 72 : 122,
    bottom: isLandscape ? 126 : 186,
    orientation,
  };
}

export const PRINT_CANVAS = getPrintCanvas("portrait");

export function getSlotBleed(slot: Pick<LayoutSlotGeometry, "width" | "height">) {
  return Math.max(8, Math.round(Math.min(slot.width, slot.height) * 0.015));
}

export function getLayoutSlots(count: LayoutCount, orientation: FrameOrientation = "portrait"): LayoutSlotGeometry[] {
  const isLandscape = orientation === "landscape";
  const canvas = getPrintCanvas(orientation);
  const columns = isLandscape
    ? (count === 2 ? 2 : count === 4 ? 2 : count === 6 ? 3 : 4)
    : (count === 2 ? 1 : 2);
  const rows = Math.ceil(count / columns);
  const slotWidth = (canvas.width - canvas.marginX * 2 - canvas.gap * (columns - 1)) / columns;
  const slotHeight = (canvas.height - canvas.top - canvas.bottom - canvas.gap * (rows - 1)) / rows;

  return Array.from({ length: count }, (_, slotIndex) => ({
    slotIndex,
    x: Math.round(canvas.marginX + (slotIndex % columns) * (slotWidth + canvas.gap)),
    y: Math.round(canvas.top + Math.floor(slotIndex / columns) * (slotHeight + canvas.gap)),
    width: Math.round(slotWidth),
    height: Math.round(slotHeight),
  }));
}
