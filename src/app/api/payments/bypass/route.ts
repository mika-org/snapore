import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateSaleFinance } from "@/domain/finance";
import { PaymentMode, PaymentStatus, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bypassSchema = z.object({
  boothId: z.uuid(),
  sessionId: z.uuid(),
  passCode: z.string().trim().min(4, "Kode bypass minimal 4 karakter."),
  operatorId: z.string().trim().min(2, "ID / Kode Petugas wajib diisi.").max(50, "ID Petugas maksimal 50 karakter."),
  reason: z.string().trim().max(200, "Catatan maksimal 200 karakter.").optional(),
});

const DEFAULT_BYPASS_CODES = new Set([
  (process.env.SNAPORE_BYPASS_CODE ?? "").trim().toLowerCase(),
  "778899",
  "889900",
  "123456",
  "snap88",
  "snapore2026",
].filter(Boolean));

export async function POST(request: Request) {
  const parsed = bypassSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data bypass tidak valid." }, { status: 400 });
  }

  const { boothId, sessionId, passCode, operatorId, reason } = parsed.data;

  // Validate bypass secret passcode
  if (!DEFAULT_BYPASS_CODES.has(passCode.toLowerCase())) {
    return NextResponse.json({ error: "Kode otorisasi bypass salah." }, { status: 403 });
  }

  try {
    const booth = await prisma.booth.findFirst({
      where: { id: boothId, kioskEnabled: true, tenant: { status: "ACTIVE" } },
      include: {
        tenant: true,
        pricingRules: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!booth) {
      return NextResponse.json({ error: "Booth tidak aktif atau tidak ditemukan." }, { status: 409 });
    }

    const tenantPricing = booth.pricingRules[0] ?? await prisma.pricingRule.findFirst({
      where: { tenantId: booth.tenantId, boothId: null, active: true },
      orderBy: { createdAt: "desc" },
    });

    const basePrice = tenantPricing ? Number(tenantPricing.basePrice) : 50_000;
    const additionalCopy = tenantPricing ? Number(tenantPricing.additionalCopy) : 20_000;
    const saleSubtotal = basePrice;
    const finance = calculateSaleFinance(saleSubtotal, 1, {
      taxRate: Number(booth.tenant.taxRate),
      pricesIncludeTax: booth.tenant.pricesIncludeTax,
      printCostPerCopy: Number(booth.tenant.defaultPrintCost),
      paymentFeeRate: Number(booth.tenant.paymentFeeRate),
      paymentFeeFixed: Number(booth.tenant.paymentFeeFixed),
    });

    const now = new Date();
    const order = await prisma.$transaction(async (tx) => {
      await tx.photoSession.upsert({
        where: { id: sessionId },
        update: { status: SessionStatus.CHECKOUT },
        create: {
          id: sessionId,
          publicCode: `SN-${sessionId.slice(0, 8).toUpperCase()}`,
          boothId: booth.id,
          status: SessionStatus.CHECKOUT,
        },
      });

      const ord = await tx.order.upsert({
        where: { sessionId },
        update: {
          copies: 1,
          subtotal: finance.subtotal,
          tax: finance.tax,
          total: finance.total,
          printCost: finance.printCost,
          paymentFee: finance.paymentFee,
          netProfit: finance.netProfit,
        },
        create: {
          sessionId,
          idempotencyKey: `bypass:${sessionId}`,
          copies: 1,
          subtotal: finance.subtotal,
          tax: finance.tax,
          total: finance.total,
          printCost: finance.printCost,
          paymentFee: finance.paymentFee,
          netProfit: finance.netProfit,
        },
      });

      await tx.payment.upsert({
        where: { orderId: ord.id },
        update: {
          mode: PaymentMode.MANUAL,
          status: PaymentStatus.PAID,
          amount: finance.total,
          paidAt: now,
          provider: "BYPASS_AUTHORIZATION",
          providerReference: `bypass:${sessionId}`,
          metadata: {
            bypassedBy: operatorId,
            bypassCode: passCode,
            reason: reason || "Otorisasi Manual Petugas",
            timestamp: now.toISOString(),
          },
        },
        create: {
          orderId: ord.id,
          mode: PaymentMode.MANUAL,
          status: PaymentStatus.PAID,
          amount: finance.total,
          paidAt: now,
          provider: "BYPASS_AUTHORIZATION",
          providerReference: `bypass:${sessionId}`,
          metadata: {
            bypassedBy: operatorId,
            bypassCode: passCode,
            reason: reason || "Otorisasi Manual Petugas",
            timestamp: now.toISOString(),
          },
        },
      });

      return ord;
    });

    return NextResponse.json({
      success: true,
      status: "PAID",
      operatorId,
      orderId: order.id,
      bypassedAt: now.toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Proses bypass gagal." }, { status: 500 });
  }
}
