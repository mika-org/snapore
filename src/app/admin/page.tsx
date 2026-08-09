import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TenantConfiguration } from "@/components/tenant-configuration";
import { getCurrentUser } from "@/lib/auth";
import { inspectBoothReadiness } from "@/lib/booth-readiness";
import { getBoothVoiceEnabled } from "@/domain/booth-voice-config";
import { prisma } from "@/lib/prisma";

function dateTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone }).format(value);
}

function heartbeatLabel(value: Date | null, timeZone: string) {
  return value ? `Heartbeat ${dateTime(value, timeZone)}` : null;
}

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "SUPER_ADMIN") redirect("/super-admin");
  if (!user.tenantId) redirect("/login");

  const [tenant, layouts] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: user.tenantId },
      include: {
        paymentConfig: true,
        booths: {
          orderBy: { createdAt: "asc" },
          include: {
            setting: true,
            idleMedia: { orderBy: { sortOrder: "asc" } },
            pricingRules: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 },
            devices: {
              orderBy: [{ preferred: "desc" }, { createdAt: "asc" }],
              include: { cameraProfile: true, printerProfile: true },
            },
          },
        },
      },
    }),
    prisma.layout.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: { versions: { where: { published: true }, orderBy: { version: "desc" }, take: 1 } },
    }),
  ]);

  const booths = tenant?.booths ?? [];
  const primaryBooth = booths[0] ?? null;
  const timeZone = primaryBooth?.timezone ?? "Asia/Bangkok";
  const readinessByBooth = new Map((await Promise.all(booths.map(async (booth) => [booth.id, await inspectBoothReadiness(booth.id)] as const))));
  const boothData = booths.map((booth) => {
    const pricing = booth.pricingRules[0] ?? null;
    const readiness = readinessByBooth.get(booth.id);
    return {
      id: booth.id,
      code: booth.code,
      name: booth.name,
      status: booth.status,
      kioskEnabled: booth.kioskEnabled,
      maintenanceMode: booth.maintenanceMode || !readiness?.ready,
      resourceReady: readiness?.ready ?? false,
      readinessReason: readiness?.reason ?? "Konfigurasi booth belum lengkap.",
      layoutCounts: readiness?.layoutCounts ?? [],
      devices: booth.devices.map((device) => ({
        id: device.id,
        name: device.name,
        type: device.type,
        status: device.status,
        preferred: device.preferred,
        detail: device.cameraProfile
          ? `${device.cameraProfile.kind} · ${device.cameraProfile.width}×${device.cameraProfile.height}`
          : device.printerProfile
            ? `${device.printerProfile.kind} · ${device.printerProfile.mediaName} · ${device.printerProfile.dpi} DPI`
            : device.type,
        lastSeenLabel: heartbeatLabel(device.lastSeenAt, booth.timezone),
      })),
      pricing: pricing ? {
        id: pricing.id,
        name: pricing.name,
        basePrice: Number(pricing.basePrice),
        additionalCopy: Number(pricing.additionalCopy),
        taxRate: Number(pricing.taxRate),
      } : null,
      setting: booth.setting ? {
        countdownSeconds: booth.setting.countdownSeconds,
        maxRetakes: booth.setting.maxRetakes,
        idleTimeoutSeconds: booth.setting.idleTimeoutSeconds,
        paymentMode: booth.setting.paymentMode,
        unprintedRetentionHours: booth.setting.unprintedRetentionHours,
        syncedRetentionDays: booth.setting.syncedRetentionDays,
        voiceEnabled: getBoothVoiceEnabled(booth.setting.config),
      } : null,
      idleMedia: booth.idleMedia.map((media) => ({
        id: media.id,
        title: media.title,
        mediaType: media.mediaType,
        durationMs: media.durationMs,
        active: media.active,
      })),
    };
  });
  const kioskUrl = primaryBooth?.kioskEnabled ? `/kiosk/${primaryBooth.id}` : null;

  return (
    <AppShell workspace={{
      name: tenant?.name ?? "Tenant",
      code: primaryBooth?.code ?? null,
      userName: user.name,
      userRole: user.role,
      kioskUrl,
      boothStatus: primaryBooth?.status ?? null,
      lastHeartbeatLabel: heartbeatLabel(primaryBooth?.lastHeartbeatAt ?? null, timeZone),
    }}>
      <header className="page-header">
        <div>
          <div className="eyebrow"><SlidersHorizontal size={13} /> {tenant?.name ?? "Tenant"} configuration</div>
          <h1>Konfigurasi booth<br />berbasis database.</h1>
          <p>Frame, perangkat, harga, retake, pembayaran, dan retensi di bawah ini adalah data aktual tenant. Setiap perubahan disimpan langsung ke PostgreSQL.</p>
        </div>
        <div className="header-actions">{kioskUrl ? <Link className="secondary-button" href={kioskUrl}>Preview kiosk</Link> : null}</div>
      </header>

      <TenantConfiguration
        booths={boothData}
        layouts={layouts.map((layout) => ({ id: layout.id, name: layout.name, kind: layout.kind, publishedVersion: layout.versions[0]?.version ?? null }))}
        payment={{
          enabled: tenant?.paymentConfig?.enabled ?? false,
          environment: tenant?.paymentConfig?.environment ?? "TEST",
          configured: Boolean(tenant?.paymentConfig?.apiKeyEncrypted),
        }}
        canEdit={user.role === "ADMIN"}
      />
    </AppShell>
  );
}
