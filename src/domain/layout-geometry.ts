export type LayoutCount = 2 | 4 | 6 | 8;

export type LayoutSlotGeometry = {
  slotIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const PRINT_CANVAS = {
  width: 1200,
  height: 1800,
  dpi: 300,
  gap: 34,
  marginX: 72,
  top: 122,
  bottom: 186,
} as const;

export function getLayoutSlots(count: LayoutCount): LayoutSlotGeometry[] {
  const columns = count === 2 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const slotWidth = (PRINT_CANVAS.width - PRINT_CANVAS.marginX * 2 - PRINT_CANVAS.gap * (columns - 1)) / columns;
  const slotHeight = (PRINT_CANVAS.height - PRINT_CANVAS.top - PRINT_CANVAS.bottom - PRINT_CANVAS.gap * (rows - 1)) / rows;

  return Array.from({ length: count }, (_, slotIndex) => ({
    slotIndex,
    x: PRINT_CANVAS.marginX + (slotIndex % columns) * (slotWidth + PRINT_CANVAS.gap),
    y: PRINT_CANVAS.top + Math.floor(slotIndex / columns) * (slotHeight + PRINT_CANVAS.gap),
    width: slotWidth,
    height: slotHeight,
  }));
}
