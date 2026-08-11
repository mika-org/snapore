import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateSaleFinance } from "@/domain/finance";
import { LayoutKind, PaymentMode, PaymentStatus, SessionStatus } from "@/generated/prisma/client";
import { markBoothResourceMaintenance } from "@/lib/booth-readiness";
import { prisma } from "@/lib/prisma";
import { createQrisPayment, getPaymentRequest } from "@/lib/xendit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  boothId: z.uuid(),
  sessionId: z.uuid(),
  frameId: z.string().min(1).max(100).optional(),
  layoutCount: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8)]).optional(),
  copies: z.number().int().min(1).max(10).default(1),
}).refine((input) => Boolean(input.frameId) === Boolean(input.layoutCount), {
  message: "Frame dan layout harus dikirim bersamaan.",
});

const layoutKinds = { 2: LayoutKind.GRID_2, 4: LayoutKind.GRID_4, 6: LayoutKind.GRID_6, 8: LayoutKind.GRID_8 } as const;

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Checkout tidak valid." }, { status: 400 });
  try {
    const input = parsed.data;
    const booth = await prisma.booth.findFirst({
      where: { id: input.boothId, kioskEnabled: true, maintenanceMode: false, tenant: { status: "ACTIVE" } },
      include: {
        tenant: { include: { paymentConfig: true } },
        setting: true,
        pricingRules: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!booth) return NextResponse.json({ error: "Booth sedang nonaktif atau maintenance." }, { status: 409 });
    const paymentMode = booth.setting?.paymentMode ?? PaymentMode.DISABLED;
    if (paymentMode === PaymentMode.CASH || paymentMode === PaymentMode.MANUAL) {
      return NextResponse.json({ error: "Mode pembayaran cash/manual belum didukung kiosk. Pilih Disabled atau Xendit QRIS di pengaturan booth." }, { status: 409 });
    }
    const paymentConfig = booth.tenant.paymentConfig;
    const encryptedApiKey = paymentConfig?.enabled ? paymentConfig.apiKeyEncrypted : null;
    const previouslyAuthorizedPayment = await prisma.payment.findFirst({
      where: { order: { sessionId: input.sessionId }, status: PaymentStatus.PAID },
      select: { id: true },
    });
    if (paymentMode === PaymentMode.ONLINE_PROVIDER && !encryptedApiKey && !previouslyAuthorizedPayment) {
      return NextResponse.json({
        paymentRequired: true,
        bypassAvailable: true,
        status: "BYPASS_REQUIRED",
      });
    }
    const tenantPricing = booth.pricingRules[0] ?? await prisma.pricingRule.findFirst({ where: { tenantId: booth.tenantId, boothId: null, active: true }, orderBy: { createdAt: "desc" } });
    const basePrice = tenantPricing ? Number(tenantPricing.basePrice) : 50_000;
    const additionalCopy = tenantPricing ? Number(tenantPricing.additionalCopy) : 20_000;
    const saleSubtotal = basePrice + Math.max(0, input.copies - 1) * additionalCopy;
    const finance = calculateSaleFinance(saleSubtotal, input.copies, {
      taxRate: Number(booth.tenant.taxRate),
      pricesIncludeTax: booth.tenant.pricesIncludeTax,
      printCostPerCopy: Number(booth.tenant.defaultPrintCost),
      paymentFeeRate: Number(booth.tenant.paymentFeeRate),
      paymentFeeFixed: Number(booth.tenant.paymentFeeFixed),
    });
    const layoutKind = input.layoutCount ? layoutKinds[input.layoutCount] : null;
    const [layoutVersion, frame] = layoutKind && input.frameId
      ? await Promise.all([
        prisma.layoutVersion.findFirst({ where: { published: true, layout: { kind: layoutKind, active: true } }, orderBy: { version: "desc" } }),
        prisma.frame.findFirst({
          where: {
            tenantId: booth.tenantId,
            active: true,
            AND: [
              { OR: [{ id: input.frameId }, { slug: input.frameId }] },
              { OR: [{ boothId: booth.id }, { boothId: null }] },
            ],
          },
          include: { versions: { where: { layoutKind, published: true }, orderBy: { version: "desc" }, take: 1 } },
        }),
      ])
      : [null, null];
    if (layoutKind && (!layoutVersion || !frame?.versions[0])) {
      await markBoothResourceMaintenance(booth.id);
      return NextResponse.json({ error: "Layout atau frame tidak tersedia. Booth otomatis masuk maintenance; aktifkan kembali setelah konfigurasi diperbaiki." }, { status: 409 });
    }

    const order = await prisma.$transaction(async (tx) => {
      await tx.photoSession.upsert({
        where: { id: input.sessionId },
        update: { layoutVersionId: layoutVersion?.id, frameVersionId: frame?.versions[0]?.id, status: SessionStatus.CHECKOUT },
        create: { id: input.sessionId, publicCode: `SN-${input.sessionId.slice(0, 8).toUpperCase()}`, boothId: booth.id, layoutVersionId: layoutVersion?.id, frameVersionId: frame?.versions[0]?.id, status: SessionStatus.CHECKOUT },
      });
      return tx.order.upsert({
        where: { sessionId: input.sessionId },
        update: { copies: input.copies, subtotal: finance.subtotal, tax: finance.tax, total: finance.total, printCost: finance.printCost, paymentFee: finance.paymentFee, netProfit: finance.netProfit },
        create: { sessionId: input.sessionId, idempotencyKey: `checkout:${input.sessionId}`, copies: input.copies, subtotal: finance.subtotal, tax: finance.tax, total: finance.total, printCost: finance.printCost, paymentFee: finance.paymentFee, netProfit: finance.netProfit },
      });
    });

    if (paymentMode === PaymentMode.DISABLED) {
      await prisma.payment.upsert({
        where: { orderId: order.id },
        update: { mode: PaymentMode.DISABLED, status: PaymentStatus.NOT_REQUIRED, provider: null, providerReference: null, amount: finance.total, paidAt: null, expiresAt: null },
        create: { orderId: order.id, mode: PaymentMode.DISABLED, status: PaymentStatus.NOT_REQUIRED, amount: finance.total },
      });
      return NextResponse.json({ paymentRequired: false, status: PaymentStatus.NOT_REQUIRED, expiresAt: null, finance });
    }

    const existing = await prisma.payment.findUnique({ where: { orderId: order.id } });
    if (existing?.status === PaymentStatus.PAID) {
      return NextResponse.json({ paymentRequired: true, status: PaymentStatus.PAID, expiresAt: existing.expiresAt?.toISOString() ?? null, finance });
    }
    if (existing?.providerReference && existing.metadata && typeof existing.metadata === "object" && "qrString" in existing.metadata) {
      const metadata = existing.metadata as { qrString?: string; expiresAt?: string };
      if (metadata.qrString && existing.expiresAt && existing.expiresAt > new Date()) {
        return NextResponse.json({ paymentRequired: true, status: existing.status, qrString: metadata.qrString, expiresAt: metadata.expiresAt, finance });
      }
    }

    if (!encryptedApiKey) return NextResponse.json({ error: "API key Xendit belum dikonfigurasi." }, { status: 409 });
    const xendit = await createQrisPayment({ encryptedApiKey, amount: finance.total, referenceId: input.sessionId, description: `${booth.name} photo print` });
    const paymentMetadata = { qrString: xendit.qrString, expiresAt: xendit.expiresAt, environment: paymentConfig?.environment ?? "LIVE" };
    await prisma.payment.upsert({
      where: { orderId: order.id },
      update: { mode: PaymentMode.ONLINE_PROVIDER, status: PaymentStatus.PENDING, provider: "XENDIT", providerReference: xendit.id, amount: finance.total, expiresAt: new Date(xendit.expiresAt), metadata: paymentMetadata },
      create: { orderId: order.id, mode: PaymentMode.ONLINE_PROVIDER, status: PaymentStatus.PENDING, provider: "XENDIT", providerReference: xendit.id, amount: finance.total, expiresAt: new Date(xendit.expiresAt), metadata: paymentMetadata },
    });
    return NextResponse.json({ paymentRequired: true, status: PaymentStatus.PENDING, qrString: xendit.qrString, expiresAt: xendit.expiresAt, finance });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "QRIS gagal dibuat." }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId || !z.uuid().safeParse(sessionId).success) return NextResponse.json({ error: "sessionId tidak valid." }, { status: 400 });
  const payment = await prisma.payment.findFirst({
    where: { order: { sessionId } },
    include: { order: { include: { session: { include: { booth: { include: { tenant: { include: { paymentConfig: true } } } } } } } } },
  });
  if (!payment) return NextResponse.json({ error: "Pembayaran tidak ditemukan." }, { status: 404 });
  if (payment.status === PaymentStatus.PENDING && payment.expiresAt && payment.expiresAt <= new Date()) {
    await prisma.$transaction([
      prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.EXPIRED } }),
      prisma.paymentEvent.create({ data: { paymentId: payment.id, status: PaymentStatus.EXPIRED, externalId: `expiry:${payment.id}`, payload: { source: "KIOSK_COUNTDOWN" } } }),
    ]).catch(() => undefined);
    return NextResponse.json({ status: PaymentStatus.EXPIRED, expiresAt: payment.expiresAt.toISOString() });
  }
  if (payment.status === PaymentStatus.PENDING && payment.providerReference) {
    const config = payment.order.session.booth.tenant.paymentConfig;
    if (config?.apiKeyEncrypted) {
      try {
        const remote = await getPaymentRequest(config.apiKeyEncrypted, payment.providerReference);
        if (remote.status === "SUCCEEDED") {
          await prisma.$transaction([
            prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID, paidAt: new Date() } }),
            prisma.paymentEvent.create({ data: { paymentId: payment.id, status: PaymentStatus.PAID, externalId: `poll:${remote.id}:SUCCEEDED`, payload: remote as object } }),
          ]);
          return NextResponse.json({ status: PaymentStatus.PAID, expiresAt: payment.expiresAt?.toISOString() ?? null });
        }
      } catch {
        // Webhook remains the source of truth when polling is temporarily unavailable.
      }
    }
  }
  return NextResponse.json({ status: payment.status, expiresAt: payment.expiresAt?.toISOString() ?? null });
}
