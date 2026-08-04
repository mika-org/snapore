import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { reconcileBoothReadiness } from "@/lib/booth-readiness";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Kiosk" };

export default async function KioskPage() {
  const booths = await prisma.booth.findMany({ where: { kioskEnabled: true, tenant: { status: "ACTIVE" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  for (const booth of booths) {
    const readiness = await reconcileBoothReadiness(booth.id);
    if (readiness?.operational) redirect(`/kiosk/${booth.id}`);
  }
  redirect("/login");
}
