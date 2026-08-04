import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { PaymentStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/security";

export const runtime = "nodejs";

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const webhookId = request.headers.get("webhook-id");
  const callbackToken = request.headers.get("x-callback-token");
  if (!webhookId || !callbackToken) return NextResponse.json({ error: "Header webhook tidak lengkap." }, { status: 401 });
  const payload = await request.json().catch(() => null) as { event?: string; data?: { payment_request_id?: string; status?: string } } | null;
  const providerReference = payload?.data?.payment_request_id;
  if (!payload?.event || !providerReference) return NextResponse.json({ error: "Payload webhook tidak valid." }, { status: 400 });

  const payment = await prisma.payment.findUnique({
    where: { providerReference },
    include: { order: { include: { session: { include: { booth: { include: { tenant: { include: { paymentConfig: true } } } } } } } } },
  });
  const encryptedToken = payment?.order.session.booth.tenant.paymentConfig?.webhookTokenEncrypted;
  if (!payment || !encryptedToken || !secureEqual(callbackToken, decryptSecret(encryptedToken))) {
    return NextResponse.json({ error: "Webhook tidak terverifikasi." }, { status: 401 });
  }

  const existing = await prisma.webhookEvent.findUnique({ where: { providerEventId: webhookId }, select: { id: true } });
  if (existing) return NextResponse.json({ ok: true, duplicate: true });

  const paid = payload.event === "payment.succeeded" || payload.data?.status === "SUCCEEDED";
  await prisma.$transaction(async (tx) => {
    await tx.webhookEvent.create({ data: { provider: "XENDIT", providerEventId: webhookId, eventType: payload.event!, payload: payload as object, processedAt: new Date() } });
    if (paid) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID, paidAt: new Date() } });
      await tx.paymentEvent.create({ data: { paymentId: payment.id, status: PaymentStatus.PAID, externalId: webhookId, payload: payload as object } });
    }
  });
  return NextResponse.json({ ok: true });
}
