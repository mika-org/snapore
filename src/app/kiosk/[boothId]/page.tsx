import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KioskExperience } from "@/components/kiosk-experience";
import { KioskUnavailable } from "@/components/kiosk-unavailable";
import { reconcileBoothReadiness } from "@/lib/booth-readiness";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Kiosk" };

export default async function BoothKioskPage({ params }: { params: Promise<{ boothId: string }> }) {
  const { boothId } = await params;
  const booth = await prisma.booth.findFirst({
    where: { id: boothId, tenant: { status: "ACTIVE" } },
    include: {
      tenant: { include: { paymentConfig: { select: { enabled: true, apiKeyEncrypted: true } } } },
      pricingRules: { where: { active: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!booth) notFound();
  const readiness = await reconcileBoothReadiness(booth.id);
  if (!readiness?.operational) {
    return <KioskUnavailable boothName={booth.name} boothCode={booth.code} reason={readiness?.reason ?? "Konfigurasi booth belum lengkap."} />;
  }
  const pricing = booth.pricingRules[0] ?? await prisma.pricingRule.findFirst({ where: { tenantId: booth.tenantId, boothId: null, active: true }, orderBy: { createdAt: "desc" } });
  return <KioskExperience booth={{
    id: booth.id,
    code: booth.code,
    name: booth.name,
    tenantName: booth.tenant.name,
    basePrice: pricing ? Number(pricing.basePrice) : 50_000,
    additionalCopyPrice: pricing ? Number(pricing.additionalCopy) : 20_000,
    paymentEnabled: Boolean(booth.tenant.paymentConfig?.enabled && booth.tenant.paymentConfig.apiKeyEncrypted),
    taxRate: Number(booth.tenant.taxRate),
    pricesIncludeTax: booth.tenant.pricesIncludeTax,
    printCostPerCopy: Number(booth.tenant.defaultPrintCost),
    paymentFeeRate: Number(booth.tenant.paymentFeeRate),
    paymentFeeFixed: Number(booth.tenant.paymentFeeFixed),
  }} />;
}
