import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateBoothResources } from "@/domain/booth-readiness";
import { isSessionResettable, SESSION_RESET_CODE_TTL_MINUTES } from "@/domain/session-reset";
import { BoothStatus, CameraKind, DeviceStatus, DeviceType, PrinterKind, UserRole, XenditEnvironment } from "@/generated/prisma/client";
import { getAuthorizedUser } from "@/lib/auth";
import { reconcileBoothReadiness, setBoothEnabled } from "@/lib/booth-readiness";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, hashPassword, maskSecret, signValue } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const money = z.coerce.number().min(0).max(1_000_000_000);
const percentage = z.coerce.number().min(0).max(100);

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("createTenant"),
    name: z.string().trim().min(2).max(80),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
    taxRate: percentage.default(11),
    defaultPrintCost: money.default(5000),
  }),
  z.object({
    action: z.literal("createUser"),
    tenantId: z.uuid().nullable(),
    name: z.string().trim().min(2).max(80),
    email: z.email().trim().toLowerCase(),
    password: z.string().min(10).max(128),
    role: z.enum([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OPERATOR, UserRole.VIEWER]),
  }),
  z.object({
    action: z.literal("updateUser"),
    userId: z.uuid(),
    tenantId: z.uuid().nullable(),
    name: z.string().trim().min(2).max(80),
    email: z.email().trim().toLowerCase(),
    password: z.preprocess(
      (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
      z.string().min(10).max(128).optional(),
    ),
    role: z.enum([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OPERATOR, UserRole.VIEWER]),
    active: z.boolean(),
  }),
  z.object({
    action: z.literal("createBooth"),
    tenantId: z.uuid(),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]+$/).min(2).max(30),
    name: z.string().trim().min(2).max(80),
    location: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal("updateBoothStatus"),
    boothId: z.uuid(),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("updateTenant"),
    tenantId: z.uuid(),
    taxRate: percentage,
    pricesIncludeTax: z.boolean(),
    defaultPrintCost: money,
    paymentFeeRate: percentage,
    paymentFeeFixed: money,
    xenditEnabled: z.boolean(),
    xenditEnvironment: z.enum([XenditEnvironment.TEST, XenditEnvironment.LIVE]),
    xenditApiKey: z.string().trim().max(500).optional(),
    xenditWebhookToken: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("generateSessionReset"),
    sessionId: z.uuid(),
    reason: z.string().trim().max(240).optional(),
  }),
]);

async function authorize() {
  return getAuthorizedUser([UserRole.SUPER_ADMIN]);
}

function number(value: { toString(): string } | number) {
  return Number(value.toString());
}

function revealResetCode(value: string) {
  try {
    return decryptSecret(value);
  } catch {
    return null;
  }
}

async function getOverviewResponse() {
  if (!await authorize()) return NextResponse.json({ error: "Akses super admin diperlukan." }, { status: 403 });
  const now = new Date();
  const [tenants, users, booths, orders, sessions, layouts, activeFrames] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      include: { paymentConfig: true, _count: { select: { users: true, booths: true, frames: true } } },
    }),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, tenantId: true, name: true, email: true, role: true, active: true, createdAt: true } }),
    prisma.booth.findMany({ orderBy: { createdAt: "asc" }, include: { tenant: { select: { name: true } }, devices: { orderBy: { createdAt: "asc" } } } }),
    prisma.order.findMany({
      include: {
        session: { include: { booth: { include: { tenant: { select: { id: true, name: true } } } } } },
        printJobs: { orderBy: { queuedAt: "asc" }, take: 1, include: { device: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.photoSession.findMany({
      orderBy: { startedAt: "desc" },
      take: 200,
      include: {
        booth: { include: { tenant: { select: { id: true, name: true } } } },
        layoutVersion: { include: { layout: { select: { name: true } } } },
        frameVersion: { include: { frame: { select: { name: true } } } },
        order: { include: { payment: true, printJobs: { select: { id: true, status: true } } } },
        uploadJobs: { orderBy: { updatedAt: "desc" }, take: 1 },
        gallery: { select: { id: true } },
        resetCodes: {
          where: { usedAt: null, revokedAt: null, expiresAt: { gt: now } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: { select: { photos: true } },
      },
    }),
    prisma.layout.findMany({
      where: { active: true, versions: { some: { published: true } } },
      select: { kind: true },
    }),
    prisma.frame.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ activeFrom: null }, { activeFrom: { lte: now } }] },
          { OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] },
        ],
      },
      select: { tenantId: true, boothId: true, versions: { where: { published: true }, select: { layoutKind: true } } },
    }),
  ]);

  const salesMap = new Map<string, { tenantId: string; tenant: string; boothId: string; booth: string; deviceId: string | null; device: string; orders: number; prints: number; gross: number; tax: number; printCost: number; paymentFee: number; netProfit: number }>();
  for (const order of orders) {
    const booth = order.session.booth;
    const device = order.printJobs[0]?.device ?? null;
    const key = `${booth.id}:${device?.id ?? "unassigned"}`;
    const row = salesMap.get(key) ?? {
      tenantId: booth.tenant.id,
      tenant: booth.tenant.name,
      boothId: booth.id,
      booth: booth.name,
      deviceId: device?.id ?? null,
      device: device?.name ?? "Belum ditetapkan",
      orders: 0,
      prints: 0,
      gross: 0,
      tax: 0,
      printCost: 0,
      paymentFee: 0,
      netProfit: 0,
    };
    row.orders += 1;
    row.prints += order.copies;
    row.gross += number(order.total);
    row.tax += number(order.tax);
    row.printCost += number(order.printCost);
    row.paymentFee += number(order.paymentFee);
    row.netProfit += number(order.netProfit) || number(order.total) - number(order.tax) - number(order.printCost) - number(order.paymentFee);
    salesMap.set(key, row);
  }

  const publishedLayoutKinds = layouts.map((layout) => layout.kind);
  const boothReadiness = new Map(booths.map((booth) => {
    const resources = evaluateBoothResources(
      publishedLayoutKinds,
      activeFrames
        .filter((frame) => frame.tenantId === booth.tenantId && (frame.boothId === null || frame.boothId === booth.id))
        .flatMap((frame) => frame.versions.map((version) => version.layoutKind)),
    );
    const reason = !booth.kioskEnabled
      ? "Booth dinonaktifkan oleh admin."
      : !resources.ready
        ? resources.reason
        : booth.maintenanceMode
          ? "Booth sedang dalam mode maintenance."
          : null;
    return [booth.id, { ...resources, reason }] as const;
  }));

  return NextResponse.json({
    tenants: tenants.map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      taxRate: number(tenant.taxRate),
      pricesIncludeTax: tenant.pricesIncludeTax,
      defaultPrintCost: number(tenant.defaultPrintCost),
      paymentFeeRate: number(tenant.paymentFeeRate),
      paymentFeeFixed: number(tenant.paymentFeeFixed),
      counts: tenant._count,
      payment: {
        enabled: tenant.paymentConfig?.enabled ?? false,
        environment: tenant.paymentConfig?.environment ?? XenditEnvironment.TEST,
        apiKeyMasked: maskSecret(tenant.paymentConfig?.apiKeyLastFour),
        webhookTokenMasked: maskSecret(tenant.paymentConfig?.webhookTokenLastFour),
      },
    })),
    users,
    booths: booths.map((booth) => ({
      ...(() => {
        const readiness = boothReadiness.get(booth.id);
        return {
          maintenanceMode: booth.maintenanceMode || !readiness?.ready,
          resourceReady: readiness?.ready ?? false,
          readinessReason: readiness?.reason ?? "Konfigurasi booth belum lengkap.",
          layoutCounts: readiness?.layoutCounts ?? [],
        };
      })(),
      id: booth.id,
      tenantId: booth.tenantId,
      tenant: booth.tenant.name,
      code: booth.code,
      name: booth.name,
      location: booth.location,
      status: booth.status,
      kioskEnabled: booth.kioskEnabled,
      kioskUrl: `/kiosk/${booth.id}`,
      devices: booth.devices.map((device) => ({ id: device.id, name: device.name, type: device.type, status: device.status })),
    })),
    sessions: sessions.map((session) => {
      const activeReset = session.resetCodes[0] ?? null;
      const paymentStatus = session.order?.payment?.status;
      const resettable = isSessionResettable({ status: session.status, hasGallery: Boolean(session.gallery), printJobCount: session.order?.printJobs.length ?? 0 })
        && (!paymentStatus || ["PAID", "NOT_REQUIRED"].includes(paymentStatus));
      return {
        id: session.id,
        publicCode: session.publicCode,
        tenantId: session.booth.tenant.id,
        tenant: session.booth.tenant.name,
        boothId: session.booth.id,
        booth: session.booth.name,
        boothCode: session.booth.code,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        layout: session.layoutVersion?.layout.name ?? null,
        frame: session.frameVersion?.frame.name ?? null,
        photoCount: session._count.photos,
        copies: session.order?.copies ?? 0,
        total: number(session.order?.total ?? 0),
        paymentStatus: paymentStatus ?? "NOT_REQUIRED",
        uploadStatus: session.uploadJobs[0]?.status ?? null,
        resettable,
        activeReset: activeReset ? {
          code: revealResetCode(activeReset.codeEncrypted),
          expiresAt: activeReset.expiresAt,
          reason: activeReset.reason,
        } : null,
      };
    }),
    sales: Array.from(salesMap.values()),
  });
}

export async function GET() {
  try {
    return await getOverviewResponse();
  } catch (error) {
    console.error("GET /api/super-admin failed", error);
    return NextResponse.json(
      { error: "Data Super Admin gagal dimuat.", detail: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const actor = await authorize();
  if (!actor) return NextResponse.json({ error: "Akses super admin diperlukan." }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Data tidak valid." }, { status: 400 });

  try {
    const data = parsed.data;
    if (data.action === "createTenant") {
      const tenant = await prisma.tenant.create({
        data: { name: data.name, slug: data.slug, taxRate: data.taxRate, defaultPrintCost: data.defaultPrintCost },
      });
      await prisma.auditLog.create({ data: { userId: actor.id, action: "TENANT_CREATED", entityType: "TENANT", entityId: tenant.id } });
      return NextResponse.json({ id: tenant.id }, { status: 201 });
    }

    if (data.action === "createUser") {
      if (data.role !== UserRole.SUPER_ADMIN && !data.tenantId) throw new Error("User tenant wajib memiliki tenant.");
      const user = await prisma.user.create({
        data: {
          tenantId: data.role === UserRole.SUPER_ADMIN ? null : data.tenantId,
          name: data.name,
          email: data.email,
          passwordHash: hashPassword(data.password),
          role: data.role,
        },
      });
      await prisma.auditLog.create({ data: { userId: actor.id, action: "USER_CREATED", entityType: "USER", entityId: user.id, metadata: { role: user.role, tenantId: user.tenantId } } });
      return NextResponse.json({ id: user.id }, { status: 201 });
    }

    if (data.action === "updateUser") {
      const existing = await prisma.user.findUnique({ where: { id: data.userId } });
      if (!existing) return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
      if (data.role !== UserRole.SUPER_ADMIN && !data.tenantId) throw new Error("User tenant wajib memiliki tenant.");
      if (existing.id === actor.id && (data.role !== UserRole.SUPER_ADMIN || !data.active)) {
        throw new Error("Akun yang sedang digunakan tidak dapat menurunkan role atau menonaktifkan dirinya sendiri.");
      }
      if (existing.role === UserRole.SUPER_ADMIN && (data.role !== UserRole.SUPER_ADMIN || !data.active)) {
        const activeSuperAdmins = await prisma.user.count({ where: { role: UserRole.SUPER_ADMIN, active: true } });
        if (activeSuperAdmins <= 1) throw new Error("Minimal satu Super Admin aktif harus dipertahankan.");
      }

      const user = await prisma.user.update({
        where: { id: data.userId },
        data: {
          tenantId: data.role === UserRole.SUPER_ADMIN ? null : data.tenantId,
          name: data.name,
          email: data.email,
          role: data.role,
          active: data.active,
          ...(data.password ? { passwordHash: hashPassword(data.password) } : {}),
        },
      });
      await prisma.auditLog.create({
        data: {
          userId: actor.id,
          action: "USER_UPDATED",
          entityType: "USER",
          entityId: user.id,
          metadata: { role: user.role, tenantId: user.tenantId, active: user.active, passwordChanged: Boolean(data.password) },
        },
      });
      return NextResponse.json({ id: user.id });
    }

    if (data.action === "createBooth") {
      const booth = await prisma.booth.create({
        data: {
          tenantId: data.tenantId,
          code: data.code,
          name: data.name,
          location: data.location || null,
          timezone: "Asia/Jakarta",
          status: BoothStatus.OFFLINE,
          setting: { create: { countdownSeconds: 3, maxRetakes: 1, paymentMode: "ONLINE_PROVIDER" } },
          devices: {
            create: [
              { fingerprint: `browser-camera-${crypto.randomUUID()}`, type: DeviceType.CAMERA, name: "Browser camera", status: DeviceStatus.OFFLINE, preferred: true, cameraProfile: { create: { kind: CameraKind.MEDIA_DEVICE } } },
              { fingerprint: `mock-printer-${crypto.randomUUID()}`, type: DeviceType.PRINTER, name: "Printer booth", status: DeviceStatus.OFFLINE, preferred: true, printerProfile: { create: { kind: PrinterKind.MOCK } }, paperCounter: { create: { currentSheets: 0 } } },
            ],
          },
        },
      });
      await reconcileBoothReadiness(booth.id);
      await prisma.auditLog.create({ data: { userId: actor.id, boothId: booth.id, action: "BOOTH_CREATED", entityType: "BOOTH", entityId: booth.id } });
      return NextResponse.json({ id: booth.id, kioskUrl: `/kiosk/${booth.id}` }, { status: 201 });
    }

    if (data.action === "updateBoothStatus") {
      const booth = await prisma.booth.findUnique({ where: { id: data.boothId }, select: { id: true, name: true } });
      if (!booth) return NextResponse.json({ error: "Booth tidak ditemukan." }, { status: 404 });
      const readiness = await setBoothEnabled(booth.id, data.enabled);
      await prisma.auditLog.create({
        data: {
          userId: actor.id,
          boothId: booth.id,
          action: data.enabled ? "BOOTH_ENABLED" : "BOOTH_DISABLED",
          entityType: "BOOTH",
          entityId: booth.id,
          metadata: { requestedEnabled: data.enabled, operational: readiness?.operational ?? false, reason: readiness?.reason ?? null },
        },
      });
      return NextResponse.json({
        ok: true,
        operational: readiness?.operational ?? false,
        maintenanceMode: readiness?.maintenanceMode ?? true,
        reason: readiness?.reason ?? null,
        message: readiness?.operational
          ? `${booth.name} aktif dan siap menerima sesi.`
          : data.enabled
            ? `${booth.name} tetap maintenance: ${readiness?.reason ?? "konfigurasi belum lengkap."}`
            : `${booth.name} berhasil dinonaktifkan.`,
      });
    }

    if (data.action === "generateSessionReset") {
      const session = await prisma.photoSession.findUnique({
        where: { id: data.sessionId },
        include: { gallery: { select: { id: true } }, order: { include: { payment: true, printJobs: { select: { id: true } } } } },
      });
      if (!session) return NextResponse.json({ error: "Sesi tidak ditemukan." }, { status: 404 });
      const paymentStatus = session.order?.payment?.status;
      if (!isSessionResettable({ status: session.status, hasGallery: Boolean(session.gallery), printJobCount: session.order?.printJobs.length ?? 0 }) || (paymentStatus && !["PAID", "NOT_REQUIRED"].includes(paymentStatus))) {
        return NextResponse.json({ error: "Reset hanya tersedia untuk sesi terbayar yang belum selesai, belum memiliki galeri, dan belum masuk antrean cetak." }, { status: 409 });
      }

      const expiresAt = new Date(Date.now() + SESSION_RESET_CODE_TTL_MINUTES * 60 * 1000);
      await prisma.sessionResetCode.updateMany({
        where: { sessionId: session.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
        const codeHash = signValue(`session-reset:${code}`);
        if (await prisma.sessionResetCode.findUnique({ where: { codeHash }, select: { id: true } })) continue;
        const [resetCode] = await prisma.$transaction([
          prisma.sessionResetCode.create({
            data: {
              sessionId: session.id,
              codeHash,
              codeEncrypted: encryptSecret(code),
              createdById: actor.id,
              reason: data.reason || null,
              expiresAt,
            },
          }),
          prisma.auditLog.create({
            data: {
              userId: actor.id,
              boothId: session.boothId,
              action: "SESSION_RESET_CODE_GENERATED",
              entityType: "PHOTO_SESSION",
              entityId: session.id,
              reason: data.reason || null,
              metadata: { expiresAt: expiresAt.toISOString() },
            },
          }),
        ]);
        return NextResponse.json({ id: resetCode.id, code, expiresAt: expiresAt.toISOString() }, { status: 201 });
      }
      throw new Error("Kode reset unik gagal dibuat. Silakan coba kembali.");
    }

    const apiKey = data.xenditApiKey?.trim();
    const webhookToken = data.xenditWebhookToken?.trim();
    await prisma.$transaction([
      prisma.tenant.update({
        where: { id: data.tenantId },
        data: {
          taxRate: data.taxRate,
          pricesIncludeTax: data.pricesIncludeTax,
          defaultPrintCost: data.defaultPrintCost,
          paymentFeeRate: data.paymentFeeRate,
          paymentFeeFixed: data.paymentFeeFixed,
        },
      }),
      prisma.tenantPaymentConfig.upsert({
        where: { tenantId: data.tenantId },
        update: {
          enabled: data.xenditEnabled,
          environment: data.xenditEnvironment,
          ...(apiKey ? { apiKeyEncrypted: encryptSecret(apiKey), apiKeyLastFour: apiKey.slice(-4) } : {}),
          ...(webhookToken ? { webhookTokenEncrypted: encryptSecret(webhookToken), webhookTokenLastFour: webhookToken.slice(-4) } : {}),
        },
        create: {
          tenantId: data.tenantId,
          enabled: data.xenditEnabled,
          environment: data.xenditEnvironment,
          apiKeyEncrypted: apiKey ? encryptSecret(apiKey) : null,
          apiKeyLastFour: apiKey ? apiKey.slice(-4) : null,
          webhookTokenEncrypted: webhookToken ? encryptSecret(webhookToken) : null,
          webhookTokenLastFour: webhookToken ? webhookToken.slice(-4) : null,
        },
      }),
      prisma.auditLog.create({ data: { userId: actor.id, action: "TENANT_SETTINGS_UPDATED", entityType: "TENANT", entityId: data.tenantId } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operasi gagal." }, { status: 400 });
  }
}
