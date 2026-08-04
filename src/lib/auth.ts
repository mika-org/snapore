import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { UserRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { signValue } from "@/lib/security";

export const SESSION_COOKIE = "snapore_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  userId: string;
  expiresAt: number;
};

export type AuthUser = {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: UserRole;
};

export function createSessionToken(userId: string) {
  const payload: SessionPayload = { userId, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signValue(encoded)}`;
}

function parseSessionToken(token: string | undefined) {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = Buffer.from(signValue(encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.userId || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = parseSessionToken(token);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, tenantId: true, email: true, name: true, role: true, active: true },
  });
  if (!user?.active) return null;
  return { id: user.id, tenantId: user.tenantId, email: user.email, name: user.name, role: user.role };
}

export async function getAuthorizedUser(roles: UserRole[]) {
  const user = await getCurrentUser();
  return user && roles.includes(user.role) ? user : null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
