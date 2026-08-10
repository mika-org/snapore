import { NextResponse } from "next/server";
import { z } from "zod";
import { DeviceStatus, DeviceType, PaymentMode, UserRole } from "@/generated/prisma/client";
import { mergeBoothVoiceConfig } from "@/domain/booth-voice-config";
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
  z.object({
    action: z.literal("setVoiceEnabled"),
    boothId: z.uuid(),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("savePrinterBridge"),
    boothId: z.uuid(),
    fingerprint: z.string().trim().min(3).max(500),
    deviceId: z.string().trim().min(1).max(500),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["DNP", "EPSON", "OS_SPOOLER", "ESC_POS", "MOCK"]),
    driverName: z.string().trim().max(300).optional(),
    queueName: z.string().trim().min(1).max(300),
    dnpCutQueueName: z.string().trim().max(300).nullable().optional(),
    autoConnect: z.boolean(),
    mediaName: z.string().trim().min(1).max(50),
    dpi: z.coerce.number().int().min(150).max(1200),
    borderless: z.boolean(),
    currentSheets: z.coerce.number().int().min(0).max(100_000).default(0),
    paperCapacity: z.coerce.number().int().min(1).max(100_000).default(400),
    lowPaperThreshold: z.coerce.number().int().min(1).max(10_000).default(20),
    paperInitialized: z.boolean().default(false),
    paperSensorBacked: z.boolean().default(false),
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

    if (parsed.data.action === "setVoiceEnabled") {
      const current = await prisma.boothSetting.findUnique({ where: { boothId: booth.id }, select: { config: true } });
      const setting = await prisma.boothSetting.upsert({
        where: { boothId: booth.id },
        update: { config: mergeBoothVoiceConfig(current?.config, parsed.data.enabled) },
        create: { boothId: booth.id, config: mergeBoothVoiceConfig(null, parsed.data.enabled) },
      });
      await prisma.auditLog.create({
        data: { userId: actor.id, boothId: booth.id, action: parsed.data.enabled ? "KIOSK_VOICE_ENABLED" : "KIOSK_VOICE_DISABLED", entityType: "BOOTH_SETTING", entityId: setting.id },
      });
      return NextResponse.json({ ok: true, voiceEnabled: parsed.data.enabled, message: parsed.data.enabled ? "Panduan suara kiosk diaktifkan." : "Panduan suara kiosk dinonaktifkan." });
    }

    if (parsed.data.action === "savePrinterBridge") {
      const bridge = parsed.data;
      const device = await prisma.$transaction(async (tx) => {
        await tx.device.updateMany({
          where: { boothId: booth.id, type: DeviceType.PRINTER, fingerprint: { not: bridge.fingerprint } },
          data: { preferred: false },
        });
        const printer = await tx.device.upsert({
          where: { boothId_fingerprint: { boothId: booth.id, fingerprint: bridge.fingerprint } },
          update: {
            name: bridge.name,
            type: DeviceType.PRINTER,
            status: DeviceStatus.ONLINE,
            preferred: true,
            driverName: bridge.driverName || null,
            lastSeenAt: new Date(),
            capabilities: { source: "LOCAL_DEVICE_AGENT", kind: bridge.kind, queueName: bridge.queueName },
            config: { localDeviceId: bridge.deviceId },
            printerProfile: {
              upsert: {
                create: {
                  kind: bridge.kind,
                  queueName: bridge.queueName,
                  dnpCutQueueName: bridge.dnpCutQueueName || null,
                  autoConnect: bridge.autoConnect,
                  mediaName: bridge.mediaName,
                  dpi: bridge.dpi,
                  borderless: bridge.borderless,
                },
                update: {
                  kind: bridge.kind,
                  queueName: bridge.queueName,
                  dnpCutQueueName: bridge.dnpCutQueueName || null,
                  autoConnect: bridge.autoConnect,
                  mediaName: bridge.mediaName,
                  dpi: bridge.dpi,
                  borderless: bridge.borderless,
                },
              },
            },
            paperCounter: {
              upsert: {
                create: { currentSheets: bridge.currentSheets, capacity: bridge.paperCapacity, lowThreshold: Math.min(bridge.lowPaperThreshold, bridge.paperCapacity), initialized: bridge.paperInitialized || bridge.paperSensorBacked, sensorBacked: bridge.paperSensorBacked, resetAt: new Date(), lastReportedAt: bridge.paperSensorBacked ? new Date() : null },
                update: { currentSheets: bridge.currentSheets, capacity: bridge.paperCapacity, lowThreshold: Math.min(bridge.lowPaperThreshold, bridge.paperCapacity), initialized: bridge.paperInitialized || bridge.paperSensorBacked, sensorBacked: bridge.paperSensorBacked, resetAt: new Date(), lastReportedAt: bridge.paperSensorBacked ? new Date() : null },
              },
            },
          },
          create: {
            boothId: booth.id,
            fingerprint: bridge.fingerprint,
            type: DeviceType.PRINTER,
            name: bridge.name,
            status: DeviceStatus.ONLINE,
            preferred: true,
            driverName: bridge.driverName || null,
            lastSeenAt: new Date(),
            capabilities: { source: "LOCAL_DEVICE_AGENT", kind: bridge.kind, queueName: bridge.queueName },
            config: { localDeviceId: bridge.deviceId },
            printerProfile: {
              create: {
                kind: bridge.kind,
                queueName: bridge.queueName,
                dnpCutQueueName: bridge.dnpCutQueueName || null,
                autoConnect: bridge.autoConnect,
                mediaName: bridge.mediaName,
                dpi: bridge.dpi,
                borderless: bridge.borderless,
              },
            },
            paperCounter: { create: { currentSheets: bridge.currentSheets, capacity: bridge.paperCapacity, lowThreshold: Math.min(bridge.lowPaperThreshold, bridge.paperCapacity), initialized: bridge.paperInitialized || bridge.paperSensorBacked, sensorBacked: bridge.paperSensorBacked, resetAt: new Date(), lastReportedAt: bridge.paperSensorBacked ? new Date() : null } },
          },
          include: { printerProfile: true },
        });
        await tx.deviceHeartbeat.create({
          data: { deviceId: printer.id, status: DeviceStatus.ONLINE, metrics: { source: "PRINTER_BRIDGE_CONFIG" } },
        });
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            boothId: booth.id,
            action: "PRINTER_BRIDGE_CONFIGURED",
            entityType: "DEVICE",
            entityId: printer.id,
            metadata: { kind: bridge.kind, queueName: bridge.queueName, dnpCutQueueName: bridge.dnpCutQueueName || null, autoConnect: bridge.autoConnect, paper: { initialized: bridge.paperInitialized || bridge.paperSensorBacked, currentSheets: bridge.currentSheets, capacity: bridge.paperCapacity, lowThreshold: Math.min(bridge.lowPaperThreshold, bridge.paperCapacity), source: bridge.paperSensorBacked ? "SENSOR" : "ESTIMATED" } },
          },
        });
        return printer;
      });
      return NextResponse.json({ ok: true, deviceId: device.id, message: `${device.name} terhubung dan menjadi printer utama.` });
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
