import { getLayoutSlots, PRINT_CANVAS, type LayoutCount } from "@/domain/layout-geometry";

export type CompositionInput = {
  photos: string[];
  count: LayoutCount;
  frameTone: "coral" | "mint" | "blue" | "custom";
  frameAsset?: string;
};

const toneMap = {
  coral: { background: "#ff614f", ink: "#171717", label: "SUNSET PUNCH" },
  mint: { background: "#baf867", ink: "#171717", label: "ELECTRIC MINT" },
  blue: { background: "#4d63ff", ink: "#f8f5ed", label: "BLUE HOUR" },
  custom: { background: "#171717", ink: "#f8f5ed", label: "CUSTOM FRAME" },
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const ratio = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / ratio;
  const sourceHeight = height / ratio;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

export async function composePrint(input: CompositionInput) {
  const canvas = document.createElement("canvas");
  canvas.width = PRINT_CANVAS.width;
  canvas.height = PRINT_CANVAS.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia");

  const tone = toneMap[input.frameTone];
  ctx.fillStyle = tone.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const slots = getLayoutSlots(input.count);
  const images = await Promise.all(input.photos.slice(0, input.count).map(loadImage));

  images.forEach((image, index) => {
    const slot = slots[index];
    ctx.save();
    ctx.fillStyle = "#f7f2e8";
    ctx.fillRect(slot.x - 8, slot.y - 8, slot.width + 16, slot.height + 16);
    drawCover(ctx, image, slot.x, slot.y, slot.width, slot.height);
    ctx.restore();
  });

  if (input.frameAsset) {
    const frame = await loadImage(input.frameAsset);
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = tone.ink;
    ctx.font = "900 54px Arial";
    ctx.fillText("SNAPORE", 72, 70);
    ctx.textAlign = "right";
    ctx.font = "700 26px Arial";
    ctx.fillText(tone.label, 1128, 67);
    ctx.font = "600 22px Arial";
    ctx.fillText(new Date().toLocaleDateString("id-ID"), 1128, 1742);
    ctx.textAlign = "left";
    ctx.font = "800 24px Arial";
    ctx.fillText("KEEP THE MOMENT LOUD.", 72, 1742);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Gagal membuat composite"))), "image/jpeg", 0.94),
  );
  return { blob, dataUrl };
}
