import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const canvas = { width: 1200, height: 1800, gap: 34, marginX: 72, top: 122, bottom: 186 };
const themes = [
  { slug: "sunset-punch", name: "Sunset Punch", background: "#ff604e", ink: "#171717", accent: "#ffd95a" },
  { slug: "electric-mint", name: "Electric Mint", background: "#b9f76b", ink: "#171717", accent: "#4b62ff" },
  { slug: "blue-hour", name: "Blue Hour", background: "#4b62ff", ink: "#f4f1e9", accent: "#ff604e" },
];

function slotsFor(count) {
  const columns = count === 2 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const width = (canvas.width - canvas.marginX * 2 - canvas.gap * (columns - 1)) / columns;
  const height = (canvas.height - canvas.top - canvas.bottom - canvas.gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => ({
    x: canvas.marginX + (index % columns) * (width + canvas.gap),
    y: canvas.top + Math.floor(index / columns) * (height + canvas.gap),
    width,
    height,
  }));
}

function frameSvg(theme, count) {
  const slots = slotsFor(count);
  const maskSlots = slots.map((slot) => `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" rx="18" fill="black"/>`).join("");
  const outlines = slots.map((slot, index) => `
    <rect x="${slot.x - 8}" y="${slot.y - 8}" width="${slot.width + 16}" height="${slot.height + 16}" rx="24" fill="none" stroke="#f4f1e9" stroke-width="16"/>
    <circle cx="${slot.x + 23}" cy="${slot.y + 23}" r="17" fill="${theme.accent}"/>
    <text x="${slot.x + 23}" y="${slot.y + 30}" fill="#171717" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="900">${index + 1}</text>
  `).join("");
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    <defs>
      <mask id="slot-mask"><rect width="1200" height="1800" fill="white"/>${maskSlots}</mask>
    </defs>
    <rect width="1200" height="1800" fill="${theme.background}" mask="url(#slot-mask)"/>
    ${outlines}
    <text x="72" y="75" fill="${theme.ink}" font-family="Arial, sans-serif" font-size="54" font-weight="900" letter-spacing="3">SNAPORE</text>
    <text x="1128" y="70" fill="${theme.ink}" text-anchor="end" font-family="Arial, sans-serif" font-size="26" font-weight="800" letter-spacing="2">${theme.name.toUpperCase()}</text>
    <rect x="72" y="1684" width="14" height="58" rx="7" fill="${theme.accent}"/>
    <text x="105" y="1725" fill="${theme.ink}" font-family="Arial, sans-serif" font-size="25" font-weight="900" letter-spacing="1">${theme.name.toUpperCase()} · GRID ${count}</text>
    <text x="1128" y="1725" fill="${theme.ink}" text-anchor="end" font-family="Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="1">KEEP THE MOMENT LOUD.</text>
    <circle cx="1120" cy="105" r="10" fill="${theme.accent}"/>
  </svg>`;
}

async function main() {
  const outputDirectory = join(process.cwd(), "public", "frames");
  await mkdir(outputDirectory, { recursive: true });
  const generated = [];
  for (const theme of themes) {
    for (const count of [2, 4, 6, 8]) {
      const filename = `${theme.slug}-grid-${count}.png`;
      const destination = join(outputDirectory, filename);
      await sharp(Buffer.from(frameSvg(theme, count)))
        .png({ compressionLevel: 9, palette: true, quality: 100 })
        .toFile(destination);
      generated.push(destination);
    }
  }
  console.log(`Generated ${generated.length} transparent Snapore frame PNG files.`);
  generated.forEach((file) => console.log(file));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
