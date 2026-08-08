import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const PRISMA_SCHEMA_REVISION = "20260805-schema-aware-adapter";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaSchemaRevision?: string };

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL belum dikonfigurasi.");
}

const databaseSchema = new URL(connectionString).searchParams.get("schema") || undefined;
const adapter = new PrismaPg({ connectionString }, { schema: databaseSchema });

export const prisma =
  (globalForPrisma.prismaSchemaRevision === PRISMA_SCHEMA_REVISION ? globalForPrisma.prisma : undefined) ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchemaRevision = PRISMA_SCHEMA_REVISION;
}
