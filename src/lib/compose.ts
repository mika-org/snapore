import { getLayoutSlots, getSlotBleed, type FrameAssetGeometry, type FrameOrientation, type LayoutCount } from "@/domain/layout-geometry";
import { getPhotoTransformGeometry } from "@/domain/photo-gestures";

export type EditorSettings = {
  rotation: number;
  flipped: boolean;
  zoom: number;
  brightness: number;
  filter: "normal" | "mono" | "warm" | "cool" | "vintage" | "vivid";
  offsetX: number;
  offsetY: number;
};

export type CompositionInput = {
  photos: string[];
  photoSettings?: Record<number, EditorSettings>;
  count: LayoutCount;
  frameTone: "coral" | "mint" | "blue" | "custom";
  frameAsset?: string;
  orientation?: FrameOrientation;
  frameGeometry?: FrameAssetGeometry;
};

const toneMap = {
  coral: { background: "#ff614f", ink: "#171717", label: "SUNSET PUNCH" },
  mint: { background: "#baf867", ink: "#171717", label: "ELECTRIC MINT" },
  blue: { background: "#4d63ff", ink: "#f8f5ed", label: "BLUE HOUR" },
  custom: { background: "#f7f2e8", ink: "#171717", label: "CUSTOM FRAME" },
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  settings?: EditorSettings,
) {
  const rotation = settings?.rotation ?? 0;
  const flipped = settings?.flipped ?? false;
  const zoom = settings?.zoom ?? 1;
  const offsetX = settings?.offsetX ?? 0;
  const offsetY = settings?.offsetY ?? 0;
  const brightness = settings?.brightness ?? 1;
  const filter = settings?.filter ?? "normal";

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.fillStyle = "#f7f2e8";
  ctx.fillRect(x, y, width, height);

  const filterLook = filter === "mono"
    ? "grayscale(1) contrast(1.1)"
    : filter === "warm"
      ? "sepia(0.35) saturate(1.25)"
      : filter === "cool"
        ? "hue-rotate(180deg) saturate(1.15)"
        : filter === "vintage"
          ? "sepia(0.5) contrast(0.9) brightness(1.05)"
          : filter === "vivid"
            ? "saturate(1.8) contrast(1.15)"
            : "saturate(1)";

  ctx.filter = `brightness(${brightness}) ${filterLook}`;

  const rad = (rotation * Math.PI) / 180;
  const transform = getPhotoTransformGeometry({
    imageWidth: image.naturalWidth || image.width,
    imageHeight: image.naturalHeight || image.height,
    slotWidth: width,
    slotHeight: height,
    rotation,
    zoom,
    offsetX,
    offsetY,
  });

  ctx.translate(x + width / 2 + transform.offsetX * width, y + height / 2 + transform.offsetY * height);
  ctx.rotate(rad);
  ctx.scale(flipped ? -transform.scale : transform.scale, transform.scale);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  ctx.restore();
}

export async function composePrint(input: CompositionInput) {
  let loadedFrame: HTMLImageElement | null = null;
  let orientation: FrameOrientation = input.frameGeometry?.orientation ?? input.orientation ?? "portrait";

  if (input.frameAsset) {
    loadedFrame = await loadImage(input.frameAsset);
    if (!input.orientation && loadedFrame.width > loadedFrame.height) {
      orientation = "landscape";
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = input.frameGeometry?.width ?? (orientation === "landscape" ? 1800 : 1200);
  canvas.height = input.frameGeometry?.height ?? (orientation === "landscape" ? 1200 : 1800);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak tersedia");

  const tone = toneMap[input.frameTone] ?? toneMap.custom;
  ctx.fillStyle = tone.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const slots = input.frameGeometry?.slots.length === input.count
    ? input.frameGeometry.slots
    : getLayoutSlots(input.count, orientation);
  const images = await Promise.all(input.photos.slice(0, input.count).map(loadImage));

  images.forEach((image, index) => {
    const slot = slots[index];
    const settings = input.photoSettings?.[index];
    ctx.save();
    const bleed = getSlotBleed(slot);
    drawCover(ctx, image, slot.x - bleed, slot.y - bleed, slot.width + bleed * 2, slot.height + bleed * 2, settings);
    ctx.restore();
  });

  if (loadedFrame) {
    ctx.drawImage(loadedFrame, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = tone.ink;
    ctx.font = "900 54px Arial";
    ctx.fillText("SNAPORE", 72, 70);
    ctx.textAlign = "right";
    ctx.font = "700 26px Arial";
    ctx.fillText(tone.label, canvas.width - 72, 67);
    ctx.font = "600 22px Arial";
    ctx.fillText(new Date().toLocaleDateString("id-ID"), canvas.width - 72, canvas.height - 58);
    ctx.textAlign = "left";
    ctx.font = "800 24px Arial";
    ctx.fillText("KEEP THE MOMENT LOUD.", 72, canvas.height - 58);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Gagal membuat composite"))), "image/jpeg", 0.94),
  );
  return { blob, dataUrl };
}
