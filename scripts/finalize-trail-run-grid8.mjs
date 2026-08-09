import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error("Usage: node scripts/finalize-trail-run-grid8.mjs <source.png> <output.png>");
}

const target = { width: 1200, height: 1800 };
const sourcePath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const { data, info } = await sharp(sourcePath)
  .resize(target.width, target.height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const width = info.width;
const height = info.height;
const seen = new Uint8Array(width * height);
const components = [];
const isKeyGreen = (index) => {
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return green >= 145 && green >= red * 1.7 && green >= blue * 1.7;
};

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const start = y * width + x;
    if (seen[start] || !isKeyGreen(start)) continue;
    const queue = [start];
    seen[start] = 1;
    const component = { area: 0, minX: x, minY: y, maxX: x, maxY: y };
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const currentX = current % width;
      const currentY = Math.floor(current / width);
      component.area += 1;
      component.minX = Math.min(component.minX, currentX);
      component.minY = Math.min(component.minY, currentY);
      component.maxX = Math.max(component.maxX, currentX);
      component.maxY = Math.max(component.maxY, currentY);
      for (const neighbour of [current - 1, current + 1, current - width, current + width]) {
        if (neighbour < 0 || neighbour >= width * height || seen[neighbour]) continue;
        const neighbourX = neighbour % width;
        const neighbourY = Math.floor(neighbour / width);
        if (Math.abs(neighbourX - currentX) + Math.abs(neighbourY - currentY) !== 1) continue;
        if (!isKeyGreen(neighbour)) continue;
        seen[neighbour] = 1;
        queue.push(neighbour);
      }
    }
    if (component.area > width * height * 0.025) components.push(component);
  }
}

const windows = components.sort((a, b) => b.area - a.area).slice(0, 8);
if (windows.length !== 8) {
  throw new Error(`Expected 8 chroma-key windows, detected ${windows.length}.`);
}

for (const window of windows) {
  for (let y = window.minY; y <= window.maxY; y += 1) {
    for (let x = window.minX; x <= window.maxX; x += 1) {
      data[(y * width + x) * 4 + 3] = 0;
    }
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await sharp(data, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(outputPath);

console.log(JSON.stringify({ outputPath, width, height, windows }, null, 2));
