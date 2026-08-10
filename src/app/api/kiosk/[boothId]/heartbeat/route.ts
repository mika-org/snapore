import { NextResponse } from "next/server";
import { z } from "zod";
import { CameraKind, DeviceStatus, DeviceType, Prisma, PrinterKind } from "@/generated/prisma/client";
import { getPaperLevel } from "@/domain/paper-counter";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusSchema = z.enum(["ONLINE", "OFFLINE", "DEGRADED"]);
const heartbeatSchema = z.object({
  kioskInstanceId: z.uuid(),
  camera: z.object({
    fingerprint: z.string().trim().min(3).max(500),
    name: z.string().trim().min(1).max(200),
    status: statusSchema,
    kind: z.enum(["MEDIA_DEVICE", "DSLR_TETHERED"]).default("MEDIA_DEVICE"),
    driverName: z.string().trim().max(300).nullable().optional(),
    width: z.number().int().min(0).max(20_000).optional(),
    height: z.number().int().min(0).max(20_000).optional(),
  }).nullable().optional(),
  printer: z.object({
    fingerprint: z.string().trim().min(3).max(500),
    deviceId: z.string().trim().min(1).max(500),
    name: z.string().trim().min(1).max(200),
    status: statusSchema,
    kind: z.enum(["DNP", "EPSON", "OS_SPOOLER", "ESC_POS", "MOCK"]),
    driverName: z.string().trim().max(300).nullable().optional(),
    queueName: z.string().trim().min(1).max(300),
    paper: z.object({
      remaining: z.number().int().min(0).max(100_000),
      capacity: z.number().int().min(1).max(100_000),
      sensorBacked: z.boolean(),
    }).optional(),
  }).nullable().optional(),
});

async function sampleHeartbeat(tx: Prisma.TransactionClient, deviceId: string, status: DeviceStatus, metrics: Prisma.InputJsonValue) {
  const latest = await tx.deviceHeartbeat.findFirst({
    where: { deviceId },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true },
  });
  if (!latest || latest.status !== status || Date.now() - latest.createdAt.getTime() >= 60_000) {
    await tx.deviceHeartbeat.create({ data: { deviceId, status, metrics } });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ boothId: string }> }) {
  const { boothId } = await params;
  if (!z.uuid().safeParse(boothId).success) return NextResponse.json({ error: "Booth tidak valid." }, { status: 400 });
  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Heartbeat tidak valid." }, { status: 400 });

  const booth = await prisma.booth.findFirst({
    where: { id: boothId, kioskEnabled: true, tenant: { status: "ACTIVE" } },
    select: { id: true, code: true },
  });
  if (!booth) return NextResponse.json({ error: "Booth kiosk tidak aktif atau tidak ditemukan." }, { status: 404 });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.booth.update({ where: { id: booth.id }, data: { lastHeartbeatAt: now, status: "ONLINE" } });
    const kiosk = await tx.device.upsert({
      where: { boothId_fingerprint: { boothId: booth.id, fingerprint: `kiosk:${parsed.data.kioskInstanceId}` } },
      update: { name: `Kiosk ${booth.code}`, type: DeviceType.KIOSK, status: DeviceStatus.ONLINE, preferred: true, lastSeenAt: now, capabilities: { source: "KIOSK_BROWSER" } },
      create: { boothId: booth.id, fingerprint: `kiosk:${parsed.data.kioskInstanceId}`, name: `Kiosk ${booth.code}`, type: DeviceType.KIOSK, status: DeviceStatus.ONLINE, preferred: true, lastSeenAt: now, capabilities: { source: "KIOSK_BROWSER" } },
    });
    await sampleHeartbeat(tx, kiosk.id, DeviceStatus.ONLINE, { source: "KIOSK_BROWSER" });

    const cameraInput = parsed.data.camera;
    if (cameraInput) {
      if (cameraInput.status === "ONLINE") {
        await tx.device.updateMany({ where: { boothId: booth.id, type: DeviceType.CAMERA, fingerprint: { not: cameraInput.fingerprint } }, data: { preferred: false } });
      }
      const cameraStatus = DeviceStatus[cameraInput.status];
      const cameraKind = cameraInput.kind === "DSLR_TETHERED" ? CameraKind.DSLR_TETHERED : CameraKind.MEDIA_DEVICE;
      const camera = await tx.device.upsert({
        where: { boothId_fingerprint: { boothId: booth.id, fingerprint: cameraInput.fingerprint } },
        update: {
          name: cameraInput.name,
          type: DeviceType.CAMERA,
          status: cameraStatus,
          preferred: cameraInput.status === "ONLINE",
          driverName: cameraInput.driverName || null,
          lastSeenAt: now,
          capabilities: { source: "KIOSK_HEARTBEAT", width: cameraInput.width ?? null, height: cameraInput.height ?? null },
          cameraProfile: { upsert: { create: { kind: cameraKind, width: cameraInput.width || 1920, height: cameraInput.height || 1080 }, update: { kind: cameraKind, width: cameraInput.width || 1920, height: cameraInput.height || 1080 } } },
        },
        create: {
          boothId: booth.id,
          fingerprint: cameraInput.fingerprint,
          name: cameraInput.name,
          type: DeviceType.CAMERA,
          status: cameraStatus,
          preferred: cameraInput.status === "ONLINE",
          driverName: cameraInput.driverName || null,
          lastSeenAt: now,
          capabilities: { source: "KIOSK_HEARTBEAT", width: cameraInput.width ?? null, height: cameraInput.height ?? null },
          cameraProfile: { create: { kind: cameraKind, width: cameraInput.width || 1920, height: cameraInput.height || 1080 } },
        },
      });
      await sampleHeartbeat(tx, camera.id, cameraStatus, { source: "KIOSK_HEARTBEAT", active: cameraInput.status === "ONLINE" });
    } else {
      await tx.device.updateMany({ where: { boothId: booth.id, type: DeviceType.CAMERA, preferred: true }, data: { status: DeviceStatus.OFFLINE, lastSeenAt: now } });
    }

    const printerInput = parsed.data.printer;
    if (printerInput) {
      if (printerInput.status === "ONLINE") {
        await tx.device.updateMany({ where: { boothId: booth.id, type: DeviceType.PRINTER, fingerprint: { not: printerInput.fingerprint } }, data: { preferred: false } });
      }
      const printerStatus = DeviceStatus[printerInput.status];
      const sensorPaper = printerInput.paper?.sensorBacked === true ? printerInput.paper : undefined;
      const printer = await tx.device.upsert({
        where: { boothId_fingerprint: { boothId: booth.id, fingerprint: printerInput.fingerprint } },
        update: {
          name: printerInput.name,
          type: DeviceType.PRINTER,
          status: printerStatus,
          preferred: printerInput.status === "ONLINE",
          driverName: printerInput.driverName || null,
          lastSeenAt: now,
          capabilities: { source: "KIOSK_AGENT_HEARTBEAT", queueName: printerInput.queueName, localDeviceId: printerInput.deviceId },
          config: { localDeviceId: printerInput.deviceId },
          printerProfile: { upsert: { create: { kind: printerInput.kind as PrinterKind, queueName: printerInput.queueName }, update: { kind: printerInput.kind as PrinterKind, queueName: printerInput.queueName } } },
          paperCounter: {
            upsert: {
              create: { currentSheets: sensorPaper?.remaining ?? 0, capacity: sensorPaper?.capacity ?? 400, initialized: Boolean(sensorPaper), sensorBacked: Boolean(sensorPaper), lastReportedAt: sensorPaper ? now : null },
              update: sensorPaper ? { currentSheets: sensorPaper.remaining, capacity: sensorPaper.capacity, initialized: true, sensorBacked: true, lastReportedAt: now } : {},
            },
          },
        },
        create: {
          boothId: booth.id,
          fingerprint: printerInput.fingerprint,
          name: printerInput.name,
          type: DeviceType.PRINTER,
          status: printerStatus,
          preferred: printerInput.status === "ONLINE",
          driverName: printerInput.driverName || null,
          lastSeenAt: now,
          capabilities: { source: "KIOSK_AGENT_HEARTBEAT", queueName: printerInput.queueName, localDeviceId: printerInput.deviceId },
          config: { localDeviceId: printerInput.deviceId },
          printerProfile: { create: { kind: printerInput.kind as PrinterKind, queueName: printerInput.queueName } },
          paperCounter: { create: { currentSheets: sensorPaper?.remaining ?? 0, capacity: sensorPaper?.capacity ?? 400, initialized: Boolean(sensorPaper), sensorBacked: Boolean(sensorPaper), lastReportedAt: sensorPaper ? now : null } },
        },
      });
      await sampleHeartbeat(tx, printer.id, printerStatus, { source: "KIOSK_AGENT_HEARTBEAT", queueName: printerInput.queueName });
    } else {
      await tx.device.updateMany({ where: { boothId: booth.id, type: DeviceType.PRINTER, preferred: true }, data: { status: DeviceStatus.OFFLINE, lastSeenAt: now } });
    }
  });

  const [camera, printer] = await Promise.all([
    prisma.device.findFirst({ where: { boothId: booth.id, type: DeviceType.CAMERA }, orderBy: [{ preferred: "desc" }, { lastSeenAt: "desc" }], include: { cameraProfile: true } }),
    prisma.device.findFirst({ where: { boothId: booth.id, type: DeviceType.PRINTER }, orderBy: [{ preferred: "desc" }, { lastSeenAt: "desc" }], include: { printerProfile: true, paperCounter: true } }),
  ]);
  const paper = printer?.paperCounter;
  return NextResponse.json({
    ok: true,
    reportedAt: now.toISOString(),
    camera: camera ? { name: camera.name, status: camera.status, kind: camera.cameraProfile?.kind ?? "MEDIA_DEVICE" } : null,
    printer: printer ? { name: printer.name, status: printer.status, kind: printer.printerProfile?.kind ?? "OS_SPOOLER", queueName: printer.printerProfile?.queueName ?? printer.name } : null,
    paper: paper ? {
      remaining: paper.currentSheets,
      capacity: paper.capacity,
      lowThreshold: paper.lowThreshold,
      level: paper.initialized ? getPaperLevel(paper.currentSheets, paper.lowThreshold) : "UNKNOWN",
      source: paper.sensorBacked ? "SENSOR" : "ESTIMATED",
      updatedAt: paper.updatedAt.toISOString(),
    } : null,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
