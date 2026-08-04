import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });
    const boothWhere = user.role === "SUPER_ADMIN" ? {} : { tenantId: user.tenantId ?? "__none__" };
    const sessionWhere = user.role === "SUPER_ADMIN" ? {} : { booth: { tenantId: user.tenantId ?? "__none__" } };
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [booths, sessionsToday, printedToday, pendingUploads, recentSessions] = await Promise.all([
      prisma.booth.findMany({ where: boothWhere, include: { devices: { include: { paperCounter: true } } } }),
      prisma.photoSession.count({ where: { ...sessionWhere, startedAt: { gte: start } } }),
      prisma.printJob.count({ where: { printedAt: { gte: start }, order: { session: sessionWhere } } }),
      prisma.uploadJob.count({ where: { status: { in: ["QUEUED", "UPLOADING", "RETRYING"] }, session: sessionWhere } }),
      prisma.photoSession.findMany({ where: sessionWhere, orderBy: { startedAt: "desc" }, take: 5, include: { booth: true, order: true } }),
    ]);
    return NextResponse.json({ booths, sessionsToday, printedToday, pendingUploads, recentSessions });
  } catch (error) {
    return NextResponse.json({ error: "Database belum siap", detail: error instanceof Error ? error.message : undefined }, { status: 503 });
  }
}
