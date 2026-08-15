import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/security";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Email atau password tidak valid." }, { status: 400 });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, include: { tenant: true } });
    if (!user?.active || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
    }
    if (user.tenant && user.tenant.status !== "ACTIVE") {
      return NextResponse.json({ error: "Tenant sedang dinonaktifkan." }, { status: 403 });
    }

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, role: user.role, tenantId: user.tenantId },
      redirectTo: user.role === "SUPER_ADMIN" ? "/super-admin" : "/admin",
    });
    response.cookies.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions);
    return response;
  } catch (error) {
    console.error("Login request failed.", error);
    return NextResponse.json({ error: "Layanan autentikasi sedang bermasalah. Silakan coba lagi." }, { status: 500 });
  }
}
