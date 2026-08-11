export type SalesExportRow = {
  tenant: string;
  booth: string;
  device: string;
  orders: number;
  prints: number;
  gross: number;
  tax: number;
  printCost: number;
  paymentFee: number;
  netProfit: number;
};

export type SessionExportRow = {
  publicCode: string;
  tenant: string;
  booth: string;
  status: string;
  outcome: string;
  startedAt: Date;
  completedAt: Date | null;
  photoCount: number;
  layout: string | null;
  frame: string | null;
  paymentStatus: string;
  sessionKind: string;
  total: number;
};

function csvCell(value: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function row(values: Array<string | number>) {
  return values.map(csvCell).join(",");
}

export function buildSalesProfitCsv(input: { generatedAt: Date; sales: SalesExportRow[]; sessions: SessionExportRow[] }) {
  const totals = input.sales.reduce((sum, item) => ({
    orders: sum.orders + item.orders,
    prints: sum.prints + item.prints,
    gross: sum.gross + item.gross,
    tax: sum.tax + item.tax,
    printCost: sum.printCost + item.printCost,
    paymentFee: sum.paymentFee + item.paymentFee,
    netProfit: sum.netProfit + item.netProfit,
  }), { orders: 0, prints: 0, gross: 0, tax: 0, printCost: 0, paymentFee: 0, netProfit: 0 });

  const lines = [
    "sep=,",
    row(["SNAPORE SALES & PROFIT REPORT"]),
    row(["Generated at", input.generatedAt.toISOString()]),
    row(["Currency", "IDR"]),
    "",
    row(["SUMMARY"]),
    row(["Orders", "Prints", "Gross", "Tax", "Print cost", "Payment fee", "Net profit"]),
    row([totals.orders, totals.prints, totals.gross, totals.tax, totals.printCost, totals.paymentFee, totals.netProfit]),
    "",
    row(["SALES BY BOOTH & DEVICE"]),
    row(["Tenant", "Booth", "Device", "Orders", "Prints", "Gross", "Tax", "Print cost", "Payment fee", "Net profit"]),
    ...input.sales.map((item) => row([item.tenant, item.booth, item.device, item.orders, item.prints, item.gross, item.tax, item.printCost, item.paymentFee, item.netProfit])),
    "",
    row(["PHOTO SESSION OUTCOMES"]),
    row(["Session code", "Tenant", "Booth", "Type", "Status", "Outcome", "Started at", "Completed at", "Photos", "Layout", "Frame", "Payment", "Total"]),
    ...input.sessions.map((item) => row([item.publicCode, item.tenant, item.booth, item.sessionKind, item.status, item.outcome, item.startedAt.toISOString(), item.completedAt?.toISOString() ?? "", item.photoCount, item.layout ?? "", item.frame ?? "", item.paymentStatus, item.total])),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}
