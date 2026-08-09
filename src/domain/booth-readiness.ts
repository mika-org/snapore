import type { LayoutCount } from "@/domain/layout-geometry";

const layoutCountByKind: Record<string, LayoutCount | undefined> = {
  GRID_2: 2,
  GRID_4: 4,
  GRID_6: 6,
  GRID_8: 8,
};

export type BoothResourceReadiness = {
  ready: boolean;
  reason: string | null;
  layoutCounts: LayoutCount[];
};

export function evaluateBoothResources(publishedLayoutKinds: readonly string[], publishedFrameKinds: readonly string[]): BoothResourceReadiness {
  const layoutKinds = new Set(publishedLayoutKinds);
  const frameKinds = new Set(publishedFrameKinds);

  const layoutCounts = Object.entries(layoutCountByKind)
    .filter(([kind]) => layoutKinds.has(kind) && frameKinds.has(kind))
    .map(([, count]) => count)
    .filter((count): count is LayoutCount => Boolean(count))
    .sort((a, b) => a - b);

  if (layoutKinds.size === 0) {
    return { ready: false, reason: "Belum ada layout aktif yang dipublikasikan.", layoutCounts: [] };
  }
  if (frameKinds.size === 0) {
    return { ready: false, reason: "Belum ada frame aktif yang dipublikasikan untuk booth ini.", layoutCounts: [] };
  }
  if (layoutCounts.length === 0) {
    return { ready: false, reason: "Frame aktif belum cocok dengan layout yang dipublikasikan.", layoutCounts: [] };
  }
  return { ready: true, reason: null, layoutCounts };
}
