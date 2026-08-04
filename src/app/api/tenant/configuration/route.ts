import { NextResponse } from "next/server";
import { z } from "zod";
import { PaymentMode, UserRole } from "@/generated/prisma/client";
import { getAuthorizedUser } from "@/lib/auth";
import { setBoothEnabled } from "@/lib/booth-readiness";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("savePricing"),
    boothId: z.uuid(),
    name: z.string().trim().min(2).max(80),
    basePrice: z.coerce.number().min(0).max(1_000_000_000),
    additionalCopy: z.coerce.number().min(0).max(1_000_000_000),
    taxRate: z.coerce.number().min(0).max(100),
  }),
  z.object({
    action: z.literal("saveBoothSettings"),
    boothId: z.uuid(),
    countdownSeconds: z.coerce.number().int().min(1).max(30),
    maxRetakes: z.coerce.number().int().min(0).max(20),
    idleTimeoutSeconds: z.coerce.number().int().min(30).max(3600),
    paymentMode: z.enum([PaymentMode.DISABLED, PaymentMode.CASH, PaymentMode.MANUAL, PaymentMode.ONLINE_PROVIDER]),
    unprintedRetentionHours: z.coerce.number().int().min(1).max(720),
    syncedRetentionDays: z.coerce.number().int().min(1).max(365),
  }),
  z.object({
    action: z.literal("setBoothEnabled"),
    boothId: z.uuid(),
    enabled: z.boolean(),
  }),
]);

export async function POST(request: Request) {
  const actor = await getAuthorizedUser([UserRole.ADMIN]);
  if (!actor?.tenantId) return NextResponse.json({ error: "Akses admin tenant diperlukan." }, { status: 403 });

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data tidak valid." }, { status: 400 });

  const booth = await prisma.booth.findFirst({ where: { id: parsed.data.boothId, tenantId: actor.tenantId }, select: { id: true } });
  if (!booth) return NextResponse.json({ error: "Booth tidak ditemukan pada tenant ini." }, { status: 404 });

  try {
    if (parsed.data.action === "setBoothEnabled") {
      const readiness = await setBoothEnabled(booth.id, parsed.data.enabled);
      await prisma.auditLog.create({
        data: {
          userId: actor.id,
          boothId: booth.id,
          action: parsed.data.enabled ? "BOOTH_ENABLED" : "BOOTH_DISABLED",
          entityType: "BOOTH",
          entityId: booth.id,
          metadata: { requestedEnabled: parsed.data.enabled, operational: readiness?.operational ?? false, reason: readiness?.reason ?? null },
        },
      });
      return NextResponse.json({
        ok: true,
        operational: readiness?.operational ?? false,
        message: readiness?.operational
          ? "Booth aktif dan siap menerima sesi."
          : parsed.data.enabled
            ? `Booth tetap maintenance: ${readiness?.reason ?? "konfigurasi belum lengkap."}`
            : "Booth berhasil dinonaktifkan.",
      });
    }

    if (parsed.data.action === "savePricing") {
      const existing = await prisma.pricingRule.findFirst({
        where: { tenantId: actor.tenantId, boothId: booth.id, active: true },
        orderBy: { createdAt: "asc" },
      });
      const pricing = existing
        ? await prisma.pricingRule.update({
            where: { id: existing.id },
            data: {
              name: parsed.data.name,
              basePrice: parsed.data.basePrice,
              additionalCopy: parsed.data.additionalCopy,
              taxRate: parsed.data.taxRate,
            },
          })
        : await prisma.pricingRule.create({
            data: {
              tenantId: actor.tenantId,
              boothId: booth.id,
              name: parsed.data.name,
              mediaName: "4x6",
              basePrice: parsed.data.basePrice,
              additionalCopy: parsed.data.additionalCopy,
              taxRate: parsed.data.taxRate,
            },
          });
      await prisma.auditLog.create({
        data: { userId: actor.id, boothId: booth.id, action: "PRICING_UPDATED", entityType: "PRICING_RULE", entityId: pricing.id },
      });
      return NextResponse.json({ ok: true, id: pricing.id });
    }

    const setting = await prisma.boothSetting.upsert({
      where: { boothId: booth.id },
      update: {
        countdownSeconds: parsed.data.countdownSeconds,
        maxRetakes: parsed.data.maxRetakes,
        idleTimeoutSeconds: parsed.data.idleTimeoutSeconds,
        paymentMode: parsed.data.paymentMode,
        unprintedRetentionHours: parsed.data.unprintedRetentionHours,
        syncedRetentionDays: parsed.data.syncedRetentionDays,
      },
      create: {
        boothId: booth.id,
        countdownSeconds: parsed.data.countdownSeconds,
        maxRetakes: parsed.data.maxRetakes,
        idleTimeoutSeconds: parsed.data.idleTimeoutSeconds,
        paymentMode: parsed.data.paymentMode,
        unprintedRetentionHours: parsed.data.unprintedRetentionHours,
        syncedRetentionDays: parsed.data.syncedRetentionDays,
      },
    });
    await prisma.auditLog.create({
      data: { userId: actor.id, boothId: booth.id, action: "BOOTH_SETTINGS_UPDATED", entityType: "BOOTH_SETTING", entityId: setting.id },
    });
    return NextResponse.json({ ok: true, id: setting.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Konfigurasi gagal disimpan." }, { status: 400 });
  }
}
