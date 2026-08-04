export type FinanceSettings = {
  taxRate: number;
  pricesIncludeTax: boolean;
  printCostPerCopy: number;
  paymentFeeRate: number;
  paymentFeeFixed: number;
};

function roundCurrency(value: number) {
  return Math.round(value);
}

export function calculateSaleFinance(subtotal: number, copies: number, settings: FinanceSettings) {
  const safeSubtotal = Math.max(0, subtotal);
  const safeCopies = Math.max(1, Math.floor(copies));
  const rate = Math.max(0, settings.taxRate) / 100;
  const tax = settings.pricesIncludeTax
    ? safeSubtotal - safeSubtotal / (1 + rate)
    : safeSubtotal * rate;
  const total = settings.pricesIncludeTax ? safeSubtotal : safeSubtotal + tax;
  const printCost = Math.max(0, settings.printCostPerCopy) * safeCopies;
  const paymentFee = total * (Math.max(0, settings.paymentFeeRate) / 100) + Math.max(0, settings.paymentFeeFixed);
  const netProfit = total - tax - printCost - paymentFee;
  return {
    subtotal: roundCurrency(safeSubtotal),
    tax: roundCurrency(tax),
    total: roundCurrency(total),
    printCost: roundCurrency(printCost),
    paymentFee: roundCurrency(paymentFee),
    netProfit: roundCurrency(netProfit),
  };
}
