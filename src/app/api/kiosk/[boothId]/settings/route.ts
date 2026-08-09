import { NextResponse } from "next/server";
import { getBoothVoiceEnabled } from "@/domain/booth-voice-config";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ boothId: string }> }) {
  const { boothId } = await params;
  const booth = await prisma.booth.findFirst({
    where: { id: boothId, tenant: { status: "ACTIVE" } },
    select: { kioskEnabled: true, maintenanceMode: true, setting: { select: { config: true, maxRetakes: true } } },
  });
  if (!booth) return NextResponse.json({ error: "Booth tidak ditemukan." }, { status: 404 });

  return NextResponse.json(
    { kioskEnabled: booth.kioskEnabled, maintenanceMode: booth.maintenanceMode, voiceEnabled: getBoothVoiceEnabled(booth.setting?.config), maxRetakes: booth.setting?.maxRetakes ?? 1 },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
