import { getAuthorizedUser } from "@/lib/auth";
import { UserRole } from "@/generated/prisma/client";
import { buildSalesProfitCsv } from "@/domain/sales-export";
import { classifySession, isTestingSession } from "@/domain/session-classification";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function number(value: { toString(): string } | number) {
  return Number(value.toString());
}

export async function GET(request: Request) {
  if (!await getAuthorizedUser([UserRole.SUPER_ADMIN])) return Response.json({ error: "Akses super admin diperlukan." }, { status: 403 });
  const searchParams = new URL(request.url).searchParams;
  const fromValue = searchParams.get("from");
  const toValue = searchParams.get("to");
  const from = fromValue && !Number.isNaN(Date.parse(fromValue)) ? new Date(fromValue) : null;
  const to = toValue && !Number.isNaN(Date.parse(toValue)) ? new Date(toValue) : null;

  const [orders, sessions] = await Promise.all([
    prisma.order.findMany({
      where: from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
      orderBy: { createdAt: "asc" },
      include: { session: { include: { booth: { include: { tenant: { select: { name: true } } } } } }, payment: true, printJobs: { orderBy: { queuedAt: "asc" }, take: 1, include: { device: true } } },
    }),
    prisma.photoSession.findMany({
      where: from || to ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {},
      orderBy: { startedAt: "desc" },
      include: { booth: { include: { tenant: { select: { name: true } } } }, layoutVersion: { include: { layout: { select: { name: true } } } }, frameVersion: { include: { frame: { select: { name: true } } } }, order: { include: { payment: true } }, _count: { select: { photos: true } } },
    }),
  ]);

  const grouped = new Map<string, { tenant: string; booth: string; device: string; orders: number; prints: number; gross: number; tax: number; printCost: number; paymentFee: number; netProfit: number }>();
  orders.forEach((order) => {
    if (isTestingSession({ paymentProvider: order.payment?.provider, paymentMetadata: order.payment?.metadata, sessionMetadata: order.session.metadata })) return;
    const device = order.printJobs[0]?.device;
    const key = `${order.session.booth.id}:${device?.id ?? "unassigned"}`;
    const current = grouped.get(key) ?? { tenant: order.session.booth.tenant.name, booth: order.session.booth.name, device: device?.name ?? "Belum ditetapkan", orders: 0, prints: 0, gross: 0, tax: 0, printCost: 0, paymentFee: 0, netProfit: 0 };
    current.orders += 1;
    current.prints += order.copies;
    current.gross += number(order.total);
    current.tax += number(order.tax);
    current.printCost += number(order.printCost);
    current.paymentFee += number(order.paymentFee);
    current.netProfit += number(order.netProfit) || number(order.total) - number(order.tax) - number(order.printCost) - number(order.paymentFee);
    grouped.set(key, current);
  });

  const csv = buildSalesProfitCsv({
    generatedAt: new Date(),
    sales: Array.from(grouped.values()),
    sessions: sessions.map((session) => ({
      publicCode: session.publicCode,
      tenant: session.booth.tenant.name,
      booth: session.booth.name,
      status: session.status,
      outcome: session.status === "COMPLETED" ? "SUCCESS" : ["FAILED", "CANCELLED", "EXPIRED"].includes(session.status) ? "FAILED" : "IN_PROGRESS",
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      photoCount: session._count.photos,
      layout: session.layoutVersion?.layout.name ?? null,
      frame: session.frameVersion?.frame.name ?? null,
      paymentStatus: session.order?.payment?.status ?? "NOT_REQUIRED",
      sessionKind: classifySession({ paymentProvider: session.order?.payment?.provider, paymentMetadata: session.order?.payment?.metadata, sessionMetadata: session.metadata }).kind,
      total: number(session.order?.total ?? 0),
    })),
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="snapore-sales-profit-${date}.csv"`, "Cache-Control": "no-store" } });
}
