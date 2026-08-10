import type { FrameAssetGeometry, LayoutCount } from "@/domain/layout-geometry";

export type FrameAssets = Partial<Record<LayoutCount, string>>;
export type FrameAssetMetadata = Partial<Record<LayoutCount, FrameAssetGeometry>>;

export type FrameCatalogItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  active: boolean;
  dnpTwoInchCut: boolean;
  assets: FrameAssets;
  assetMeta?: FrameAssetMetadata;
  variants: LayoutCount[];
  createdAt: string;
};

export type FrameCatalogResponse = {
  frames: FrameCatalogItem[];
  layoutCounts: LayoutCount[];
  operational: boolean;
  maintenanceReason: string | null;
};
