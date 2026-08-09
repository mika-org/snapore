import { describe, expect, it } from "vitest";
import { buildSalesProfitCsv } from "./sales-export";

describe("sales and profit Excel CSV export", () => {
  it("exports numeric finance values and protects spreadsheet formulas", () => {
    const csv = buildSalesProfitCsv({
      generatedAt: new Date("2026-08-09T00:00:00.000Z"),
      sales: [{ tenant: "=unsafe", booth: "BKK-001", device: "DNP", orders: 1, prints: 2, gross: 100000, tax: 10000, printCost: 5000, paymentFee: 1000, netProfit: 84000 }],
      sessions: [],
    });
    expect(csv).toContain("\uFEFFsep=,");
    expect(csv).toContain("\"'=unsafe\"");
    expect(csv).toContain("1,2,100000,10000,5000,1000,84000");
  });
});
