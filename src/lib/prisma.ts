import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import { PrismaClient } from "@/generated/prisma/client";

const PRISMA_SCHEMA_REVISION = "20260811-resilient-remote-pool";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaSchemaRevision?: string };

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL belum dikonfigurasi.");
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

const databaseSchema = new URL(connectionString).searchParams.get("schema") || undefined;
const poolConfig: PoolConfig = {
  connectionString,
  max: boundedInteger(process.env.DATABASE_POOL_MAX, 4, 1, 20),
  connectionTimeoutMillis: boundedInteger(process.env.DATABASE_CONNECT_TIMEOUT_MS, 8_000, 1_000, 60_000),
  query_timeout: boundedInteger(process.env.DATABASE_QUERY_TIMEOUT_MS, 30_000, 5_000, 120_000),
  statement_timeout: boundedInteger(process.env.DATABASE_STATEMENT_TIMEOUT_MS, 30_000, 5_000, 120_000),
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
  maxLifetimeSeconds: 300,
  application_name: "snapore-web",
};
const adapter = new PrismaPg(poolConfig, { schema: databaseSchema });

export const prisma =
  (globalForPrisma.prismaSchemaRevision === PRISMA_SCHEMA_REVISION ? globalForPrisma.prisma : undefined) ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchemaRevision = PRISMA_SCHEMA_REVISION;
}
