import { describe, expect, it } from "vitest";
import { evaluateBoothResources } from "./booth-readiness";

describe("booth resource readiness", () => {
  it("aktif jika sedikitnya satu layout memiliki frame yang cocok", () => {
    expect(evaluateBoothResources(["GRID_2", "GRID_4"], ["GRID_4", "GRID_8"])).toEqual({
      ready: true,
      reason: null,
      layoutCounts: [4],
    });
  });

  it("maintenance jika layout belum dipublikasikan", () => {
    expect(evaluateBoothResources([], ["GRID_4"]).reason).toContain("layout");
  });

  it("maintenance jika frame tidak ada atau tidak cocok", () => {
    expect(evaluateBoothResources(["GRID_4"], []).reason).toContain("frame");
    expect(evaluateBoothResources(["GRID_2"], ["GRID_8"]).ready).toBe(false);
  });
});
