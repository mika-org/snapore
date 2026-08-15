import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createGalleryLink } from "@/lib/gallery-link";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });

  const { sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) {
    return NextResponse.json({ error: "Identitas sesi tidak valid." }, { status: 400 });
  }

  const session = await prisma.photoSession.findFirst({
    where: {
      id: sessionId,
      ...(user.role === "SUPER_ADMIN" ? {} : { booth: { tenantId: user.tenantId ?? "__none__" } }),
    },
    select: {
      publicCode: true,
      gallery: { select: { id: true, active: true, expiresAt: true } },
    },
  });
  if (!session) return NextResponse.json({ error: "Sesi tidak ditemukan." }, { status: 404 });
  if (!session.gallery?.active) {
    return NextResponse.json({ error: "Gallery sesi belum tersedia." }, { status: 409 });
  }
  if (session.gallery.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Gallery sesi sudah kedaluwarsa." }, { status: 410 });
  }

  await prisma.galleryToken.deleteMany({
    where: {
      galleryId: session.gallery.id,
      OR: [{ expiresAt: { lte: new Date() } }, { revokedAt: { not: null } }],
    },
  });
  const galleryUrl = await createGalleryLink(session.gallery.id, session.gallery.expiresAt, new URL(request.url).origin);

  return NextResponse.json({
    galleryUrl,
    expiresAt: session.gallery.expiresAt,
    publicCode: session.publicCode,
  });
}
