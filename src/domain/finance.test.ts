import { describe, expect, it } from "vitest";
import { calculateSaleFinance } from "./finance";

describe("sale finance", () => {
  it("memisahkan pajak inklusif untuk memperoleh laba bersih", () => {
    expect(calculateSaleFinance(50_000, 1, { taxRate: 11, pricesIncludeTax: true, printCostPerCopy: 5_000, paymentFeeRate: 0.7, paymentFeeFixed: 0 }))
      .toEqual({ subtotal: 50_000, tax: 4_955, total: 50_000, printCost: 5_000, paymentFee: 350, netProfit: 39_695 });
  });

  it("menambahkan pajak ketika harga belum termasuk pajak", () => {
    expect(calculateSaleFinance(50_000, 2, { taxRate: 11, pricesIncludeTax: false, printCostPerCopy: 5_000, paymentFeeRate: 0, paymentFeeFixed: 0 }))
      .toEqual({ subtotal: 50_000, tax: 5_500, total: 55_500, printCost: 10_000, paymentFee: 0, netProfit: 40_000 });
  });
});
