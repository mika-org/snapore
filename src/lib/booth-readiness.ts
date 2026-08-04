import { BoothStatus } from "@/generated/prisma/client";
import { evaluateBoothResources } from "@/domain/booth-readiness";
import { prisma } from "@/lib/prisma";

export async function inspectBoothReadiness(boothId: string) {
  const booth = await prisma.booth.findUnique({
    where: { id: boothId },
    select: { id: true, tenantId: true, kioskEnabled: true, maintenanceMode: true, status: true },
  });
  if (!booth) return null;

  const now = new Date();
  const [layouts, frames] = await Promise.all([
    prisma.layout.findMany({
      where: { active: true, versions: { some: { published: true } } },
      select: { kind: true },
    }),
    prisma.frame.findMany({
      where: {
        tenantId: booth.tenantId,
        active: true,
        OR: [{ boothId: booth.id }, { boothId: null }],
        AND: [
          { OR: [{ activeFrom: null }, { activeFrom: { lte: now } }] },
          { OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] },
        ],
      },
      select: { versions: { where: { published: true }, select: { layoutKind: true } } },
    }),
  ]);
  const resources = evaluateBoothResources(
    layouts.map((layout) => layout.kind),
    frames.flatMap((frame) => frame.versions.map((version) => version.layoutKind)),
  );
  const operational = booth.kioskEnabled && !booth.maintenanceMode && resources.ready;
  const reason = !booth.kioskEnabled
    ? "Booth dinonaktifkan oleh admin."
    : !resources.ready
      ? resources.reason
      : booth.maintenanceMode
        ? "Booth sedang dalam mode maintenance."
        : null;

  return { ...booth, ...resources, operational, reason };
}

export async function reconcileBoothReadiness(boothId: string) {
  const readiness = await inspectBoothReadiness(boothId);
  if (!readiness) return null;
  const maintenanceMode = !readiness.kioskEnabled || !readiness.ready;
  const status = maintenanceMode
    ? BoothStatus.MAINTENANCE
    : readiness.status === BoothStatus.MAINTENANCE
      ? BoothStatus.OFFLINE
      : readiness.status;
  if (readiness.maintenanceMode !== maintenanceMode || readiness.status !== status) {
    await prisma.booth.update({ where: { id: boothId }, data: { maintenanceMode, status } });
  }
  const operational = readiness.kioskEnabled && !maintenanceMode && readiness.ready;
  const reason = !readiness.kioskEnabled
    ? "Booth dinonaktifkan oleh admin."
    : !readiness.ready
      ? readiness.reason
      : maintenanceMode
        ? "Booth sedang dalam mode maintenance."
        : null;
  return { ...readiness, maintenanceMode, status, operational, reason };
}

export async function setBoothEnabled(boothId: string, enabled: boolean) {
  await prisma.booth.update({
    where: { id: boothId },
    data: enabled
      ? { kioskEnabled: true }
      : { kioskEnabled: false, maintenanceMode: true, status: BoothStatus.MAINTENANCE },
  });
  return reconcileBoothReadiness(boothId);
}

export async function markBoothResourceMaintenance(boothId: string) {
  await prisma.booth.update({
    where: { id: boothId },
    data: { maintenanceMode: true, status: BoothStatus.MAINTENANCE },
  });
}
