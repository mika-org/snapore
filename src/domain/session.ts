import type { LayoutCount } from "@/domain/layout-geometry";
import type { FrameCatalogItem } from "@/domain/frame-catalog";

export const kioskSteps = [
  "IDLE",
  "PAYMENT",
  "LAYOUT",
  "FRAME",
  "CAPTURE",
  "REVIEW",
  "CHECKOUT",
  "PRINTING",
  "DONE",
] as const;

export type KioskStep = (typeof kioskSteps)[number];

export type KioskEvent =
  | "START"
  | "PAYMENT_COMPLETE"
  | "SELECT_LAYOUT"
  | "SELECT_FRAME"
  | "CAPTURE_COMPLETE"
  | "RETAKE_PHOTO"
  | "RETAKE_COMPLETE"
  | "APPROVE_PHOTOS"
  | "CONFIRM_PRINT"
  | "PRINT_COMPLETE"
  | "RESET";

const transitions: Record<KioskStep, Partial<Record<KioskEvent, KioskStep>>> = {
  IDLE: { START: "PAYMENT", RESET: "IDLE" },
  PAYMENT: { PAYMENT_COMPLETE: "LAYOUT", RESET: "IDLE" },
  LAYOUT: { SELECT_LAYOUT: "FRAME", RESET: "IDLE" },
  FRAME: { SELECT_FRAME: "CAPTURE", RESET: "IDLE" },
  CAPTURE: { CAPTURE_COMPLETE: "REVIEW", RETAKE_COMPLETE: "REVIEW", RESET: "IDLE" },
  REVIEW: { RETAKE_PHOTO: "CAPTURE", APPROVE_PHOTOS: "CHECKOUT", RESET: "IDLE" },
  CHECKOUT: { CONFIRM_PRINT: "PRINTING", RESET: "IDLE" },
  PRINTING: { PRINT_COMPLETE: "DONE", RESET: "IDLE" },
  DONE: { RESET: "IDLE" },
};

export function transitionSession(step: KioskStep, event: KioskEvent): KioskStep {
  const next = transitions[step][event];
  if (!next) throw new Error(`Transisi ${event} tidak valid dari ${step}`);
  return next;
}

export type LayoutPreset = {
  id: "grid-2" | "grid-4" | "grid-6" | "grid-8";
  name: string;
  count: LayoutCount;
  tagline: string;
};

export const layoutPresets: LayoutPreset[] = [
  { id: "grid-2", name: "Double Take", count: 2, tagline: "Dua momen, ruang ekstra" },
  { id: "grid-4", name: "Classic Four", count: 4, tagline: "Favorit untuk semua pose" },
  { id: "grid-6", name: "Story Six", count: 6, tagline: "Satu sesi, satu cerita" },
  { id: "grid-8", name: "Mega Eight", count: 8, tagline: "Delapan pose dalam satu frame" },
];

export type FramePreset = FrameCatalogItem & {
  tone: "coral" | "mint" | "blue" | "custom";
  accent: string;
};

export const framePresets: FramePreset[] = [
  {
    id: "sunset-punch",
    slug: "sunset-punch",
    name: "Sunset Punch",
    description: "Frame coral dengan aksen matahari dan tipografi Snapore.",
    active: true,
    variants: [2, 4, 6, 8],
    createdAt: "",
    tone: "coral",
    accent: "#ff614f",
    assets: { 2: "/frames/sunset-punch-grid-2.png", 4: "/frames/sunset-punch-grid-4.png", 6: "/frames/sunset-punch-grid-6.png", 8: "/frames/sunset-punch-grid-8.png" },
  },
  {
    id: "electric-mint",
    slug: "electric-mint",
    name: "Electric Mint",
    description: "Frame hijau mint dengan aksen biru elektrik.",
    active: true,
    variants: [2, 4, 6, 8],
    createdAt: "",
    tone: "mint",
    accent: "#baf867",
    assets: { 2: "/frames/electric-mint-grid-2.png", 4: "/frames/electric-mint-grid-4.png", 6: "/frames/electric-mint-grid-6.png", 8: "/frames/electric-mint-grid-8.png" },
  },
  {
    id: "blue-hour",
    slug: "blue-hour",
    name: "Blue Hour",
    description: "Frame biru elektrik dengan tipografi terang dan aksen coral.",
    active: true,
    variants: [2, 4, 6, 8],
    createdAt: "",
    tone: "blue",
    accent: "#4d63ff",
    assets: { 2: "/frames/blue-hour-grid-2.png", 4: "/frames/blue-hour-grid-4.png", 6: "/frames/blue-hour-grid-6.png", 8: "/frames/blue-hour-grid-8.png" },
  },
];

export function getFrameAsset(frame: Pick<FramePreset, "assets">, count: LayoutCount) {
  const asset = frame.assets[count];
  if (!asset) throw new Error(`Frame tidak memiliki aset untuk grid ${count}.`);
  return asset;
}

export function calculateOrder(basePrice: number, additionalCopyPrice: number, copies: number) {
  const safeCopies = Math.max(1, Math.floor(copies));
  const subtotal = basePrice + (safeCopies - 1) * additionalCopyPrice;
  return { copies: safeCopies, subtotal, tax: 0, total: subtotal };
}
