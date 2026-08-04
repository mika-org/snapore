import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSessionSchema = z.object({
  id: z.string().uuid().optional(),
  boothCode: z.string().min(2).max(40).default("BKK-001"),
  layoutVersionId: z.string().optional(),
  frameVersionId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });
    const sessions = await prisma.photoSession.findMany({
      where: user.role === "SUPER_ADMIN" ? {} : { booth: { tenantId: user.tenantId ?? "__none__" } },
      orderBy: { startedAt: "desc" },
      take: 30,
      include: {
        booth: { select: { code: true, name: true } },
        order: { include: { payment: true, printJobs: true } },
        uploadJobs: true,
      },
    });
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: "Database belum siap", detail: error instanceof Error ? error.message : undefined },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });
    const input = createSessionSchema.parse(await request.json());
    const booth = await prisma.booth.findUnique({ where: { code: input.boothCode } });
    if (!booth) return NextResponse.json({ error: "Booth tidak ditemukan" }, { status: 404 });
    if (user.role !== "SUPER_ADMIN" && booth.tenantId !== user.tenantId) return NextResponse.json({ error: "Booth di luar tenant akun." }, { status: 403 });

    const id = input.id ?? crypto.randomUUID();
    const session = await prisma.photoSession.create({
      data: {
        id,
        publicCode: id.slice(0, 8).toUpperCase(),
        boothId: booth.id,
        layoutVersionId: input.layoutVersionId,
        frameVersionId: input.frameVersionId,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Payload tidak valid", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: "Gagal membuat sesi", detail: error instanceof Error ? error.message : undefined }, { status: 500 });
  }
}
