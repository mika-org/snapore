import type { LayoutCount } from "@/domain/layout-geometry";

export type FrameAssets = Partial<Record<LayoutCount, string>>;

export type FrameCatalogItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  active: boolean;
  assets: FrameAssets;
  variants: LayoutCount[];
  createdAt: string;
};

export type FrameCatalogResponse = {
  frames: FrameCatalogItem[];
  layoutCounts: LayoutCount[];
  operational: boolean;
  maintenanceReason: string | null;
};
