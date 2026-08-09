import sharp from "sharp";
import type { LayoutCount, LayoutSlotGeometry } from "@/domain/layout-geometry";

type Component = {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  touchesEdge: boolean;
};

const DETECTION_WIDTH = 300;

function sortSlots(components: Component[]) {
  const medianHeight = [...components]
    .map((item) => item.maxY - item.minY + 1)
    .sort((a, b) => a - b)[Math.floor(components.length / 2)] ?? 1;
  const rowTolerance = Math.max(3, medianHeight * 0.45);
  return [...components].sort((a, b) => {
    const centerYA = (a.minY + a.maxY) / 2;
    const centerYB = (b.minY + b.maxY) / 2;
    return Math.abs(centerYA - centerYB) <= rowTolerance
      ? a.minX - b.minX
      : centerYA - centerYB;
  });
}

export async function detectTransparentFrameSlots(
  source: Buffer,
  count: LayoutCount,
  widthPx: number,
  heightPx: number,
): Promise<LayoutSlotGeometry[]> {
  const detectionHeight = Math.max(1, Math.round((DETECTION_WIDTH * heightPx) / widthPx));
  const { data, info } = await sharp(source)
    .resize(DETECTION_WIDTH, detectionHeight, { fit: "fill", kernel: sharp.kernel.nearest })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const seen = new Uint8Array(width * height);
  const components: Component[] = [];
  const isTransparent = (index: number) => data[index * 4 + 3] <= 48;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (seen[start] || !isTransparent(start)) continue;
      const queue = [start];
      seen[start] = 1;
      const component: Component = { area: 0, minX: x, minY: y, maxX: x, maxY: y, touchesEdge: false };

      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        const currentX = current % width;
        const currentY = Math.floor(current / width);
        component.area += 1;
        component.minX = Math.min(component.minX, currentX);
        component.maxX = Math.max(component.maxX, currentX);
        component.minY = Math.min(component.minY, currentY);
        component.maxY = Math.max(component.maxY, currentY);
        if (currentX === 0 || currentY === 0 || currentX === width - 1 || currentY === height - 1) component.touchesEdge = true;

        const neighbours = [current - 1, current + 1, current - width, current + width];
        for (const neighbour of neighbours) {
          if (neighbour < 0 || neighbour >= width * height || seen[neighbour]) continue;
          const neighbourX = neighbour % width;
          const neighbourY = Math.floor(neighbour / width);
          if (Math.abs(neighbourX - currentX) + Math.abs(neighbourY - currentY) !== 1) continue;
          if (!isTransparent(neighbour)) continue;
          seen[neighbour] = 1;
          queue.push(neighbour);
        }
      }
      components.push(component);
    }
  }

  const minimumArea = width * height * 0.003;
  const candidates = components
    .filter((item) => !item.touchesEdge && item.area >= minimumArea)
    .sort((a, b) => b.area - a.area)
    .slice(0, count);
  if (candidates.length !== count) {
    throw new Error(`PNG Grid ${count} harus memiliki tepat ${count} area foto transparan yang tertutup.`);
  }

  const scaleX = widthPx / width;
  const scaleY = heightPx / height;
  return sortSlots(candidates).map((item, slotIndex) => {
    const x = Math.max(0, Math.floor(item.minX * scaleX));
    const y = Math.max(0, Math.floor(item.minY * scaleY));
    const right = Math.min(widthPx, Math.ceil((item.maxX + 1) * scaleX));
    const bottom = Math.min(heightPx, Math.ceil((item.maxY + 1) * scaleY));
    return { slotIndex, x, y, width: right - x, height: bottom - y };
  });
}
