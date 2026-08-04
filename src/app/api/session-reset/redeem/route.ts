import { NextResponse } from "next/server";
import { z } from "zod";
import { isSessionResettable } from "@/domain/session-reset";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { signValue } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const redeemSchema = z.object({
  boothId: z.uuid(),
  code: z.string().regex(/^\d{6}$/, "Kode reset harus terdiri dari 6 digit."),
});

const resetAttempts = new Map<string, { failures: number; blockedUntil: number }>();

function registerFailure(boothId: string) {
  const current = resetAttempts.get(boothId);
  const failures = (current?.blockedUntil && current.blockedUntil > Date.now() ? current.failures : 0) + 1;
  resetAttempts.set(boothId, { failures, blockedUntil: failures >= 5 ? Date.now() + 60_000 : Date.now() + 10 * 60_000 });
}

export async function POST(request: Request) {
  const parsed = redeemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Kode reset tidak valid." }, { status: 400 });

  const guard = resetAttempts.get(parsed.data.boothId);
  if (guard && guard.failures >= 5 && guard.blockedUntil > Date.now()) {
    return NextResponse.json({ error: "Terlalu banyak percobaan. Coba kembali dalam 1 menit." }, { status: 429 });
  }

  const codeHash = signValue(`session-reset:${parsed.data.code}`);
  const resetCode = await prisma.sessionResetCode.findUnique({
    where: { codeHash },
    include: {
      session: {
        include: {
          booth: { select: { id: true, kioskEnabled: true } },
          gallery: { select: { id: true } },
          order: { include: { payment: true, printJobs: { select: { id: true } } } },
        },
      },
    },
  });
  const now = new Date();
  if (!resetCode || resetCode.session.booth.id !== parsed.data.boothId || !resetCode.session.booth.kioskEnabled || resetCode.usedAt || resetCode.revokedAt || resetCode.expiresAt <= now) {
    registerFailure(parsed.data.boothId);
    return NextResponse.json({ error: "Kode reset salah, sudah digunakan, atau kedaluwarsa." }, { status: 404 });
  }

  const session = resetCode.session;
  const paymentStatus = session.order?.payment?.status;
  if (paymentStatus && !["PAID", "NOT_REQUIRED"].includes(paymentStatus)) {
    return NextResponse.json({ error: "Pembayaran sesi belum dapat digunakan untuk restart." }, { status: 409 });
  }
  if (!isSessionResettable({ status: session.status, hasGallery: Boolean(session.gallery), printJobCount: session.order?.printJobs.length ?? 0 })) {
    return NextResponse.json({ error: "Sesi sudah selesai atau sudah masuk antrean cetak sehingga tidak dapat di-reset." }, { status: 409 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.sessionResetCode.updateMany({
        where: { id: resetCode.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw new Error("Kode reset sudah digunakan.");

      await tx.uploadJob.deleteMany({ where: { sessionId: session.id } });
      await tx.asset.deleteMany({ where: { sessionId: session.id } });
      await tx.capturedPhoto.deleteMany({ where: { sessionId: session.id } });
      await tx.composition.deleteMany({ where: { sessionId: session.id } });
      await tx.photoSession.update({
        where: { id: session.id },
        data: {
          layoutVersionId: null,
          frameVersionId: null,
          status: SessionStatus.CREATED,
          completedAt: null,
          cancelledAt: null,
          expiresAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          boothId: session.boothId,
          action: "SESSION_RESET_CODE_REDEEMED",
          entityType: "PHOTO_SESSION",
          entityId: session.id,
          reason: resetCode.reason,
          metadata: { resetCodeId: resetCode.id },
        },
      });
    });
    resetAttempts.delete(parsed.data.boothId);
    return NextResponse.json({ sessionId: session.id, restartAt: "LAYOUT", sessionWindowSeconds: 15 * 60 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sesi gagal di-reset." }, { status: 409 });
  }
}
