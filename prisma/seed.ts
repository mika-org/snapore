import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, LayoutKind, PrinterKind, CameraKind, DeviceType, DeviceStatus, BoothStatus, PaymentMode, UserRole } from "../src/generated/prisma/client";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashPassword } from "../src/lib/security";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL is required");

const databaseSchema = new URL(connectionString).searchParams.get("schema") || undefined;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema: databaseSchema }) });

function createSlots(count: 2 | 4 | 6 | 8) {
  const columns = count === 2 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const gap = 34;
  const width = (1200 - 72 * 2 - gap * (columns - 1)) / columns;
  const height = (1800 - 122 - 186 - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, slotIndex) => ({
    slotIndex,
    x: Math.round(72 + (slotIndex % columns) * (width + gap)),
    y: Math.round(122 + Math.floor(slotIndex / columns) * (height + gap)),
    width: Math.round(width),
    height: Math.round(height),
  }));
}

const slotPresets = { GRID_2: createSlots(2), GRID_4: createSlots(4), GRID_6: createSlots(6), GRID_8: createSlots(8) } as const;

const frameDefinitions = [
  { slug: "sunset-punch", name: "Sunset Punch", description: "Frame coral dengan aksen matahari dan tipografi Snapore." },
  { slug: "electric-mint", name: "Electric Mint", description: "Frame hijau mint dengan aksen biru elektrik." },
  { slug: "blue-hour", name: "Blue Hour", description: "Frame biru elektrik dengan tipografi terang dan aksen coral." },
] as const;

const frameLayouts = [
  { count: 2, kind: LayoutKind.GRID_2 },
  { count: 4, kind: LayoutKind.GRID_4 },
  { count: 6, kind: LayoutKind.GRID_6 },
  { count: 8, kind: LayoutKind.GRID_8 },
] as const;

async function checksumFor(assetPath: string) {
  const bytes = await readFile(join(process.cwd(), "public", assetPath.replace(/^\//, "")));
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "snapore-default" },
    update: { name: "Snapore Default Tenant" },
    create: { slug: "snapore-default", name: "Snapore Default Tenant", taxRate: 11, defaultPrintCost: 5000 },
  });

  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL ?? "superadmin@snapore.local";
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD ?? "Snapore@2026!";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "Snapore#Admin73";
  const resetSeedPasswords = process.env.SNAPORE_RESET_SEED_PASSWORDS === "true";
  const [superAdminPasswordHash, adminPasswordHash] = await Promise.all([
    hashPassword(superAdminPassword),
    hashPassword(adminPassword),
  ]);
  const admin = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: { name: "Snapore Super Admin", role: UserRole.SUPER_ADMIN, tenantId: null, active: true, ...(resetSeedPasswords ? { passwordHash: superAdminPasswordHash } : {}) },
    create: { email: superAdminEmail, name: "Snapore Super Admin", role: UserRole.SUPER_ADMIN, passwordHash: superAdminPasswordHash },
  });

  await prisma.user.upsert({
    where: { email: "admin@snapore.local" },
    update: { tenantId: tenant.id, name: "Snapore Tenant Admin", role: UserRole.ADMIN, active: true, ...(resetSeedPasswords ? { passwordHash: adminPasswordHash } : {}) },
    create: { tenantId: tenant.id, email: "admin@snapore.local", name: "Snapore Tenant Admin", role: UserRole.ADMIN, passwordHash: adminPasswordHash },
  });

  const booth = await prisma.booth.upsert({
    where: { code: "LOCAL-001" },
    update: {
      tenantId: tenant.id,
      name: "Snapore Laptop Booth",
      location: "Laptop lokal",
      timezone: "Asia/Jakarta",
      status: BoothStatus.OFFLINE,
      setting: {
        upsert: {
          create: { countdownSeconds: 3, maxRetakes: 1, idleTimeoutSeconds: 90, paymentMode: PaymentMode.DISABLED },
          update: { paymentMode: PaymentMode.DISABLED },
        },
      },
    },
    create: {
      tenantId: tenant.id,
      code: "LOCAL-001",
      name: "Snapore Laptop Booth",
      location: "Laptop lokal",
      timezone: "Asia/Jakarta",
      status: BoothStatus.OFFLINE,
      setting: { create: { countdownSeconds: 3, maxRetakes: 1, idleTimeoutSeconds: 90, paymentMode: PaymentMode.DISABLED } },
    },
  });

  const camera = await prisma.device.upsert({
    where: { boothId_fingerprint: { boothId: booth.id, fingerprint: "browser-camera-primary" } },
    update: { name: "Kamera bawaan laptop", status: DeviceStatus.OFFLINE, preferred: true },
    create: {
      boothId: booth.id,
      fingerprint: "browser-camera-primary",
      type: DeviceType.CAMERA,
      name: "Kamera bawaan laptop",
      status: DeviceStatus.OFFLINE,
      preferred: true,
      cameraProfile: { create: { kind: CameraKind.MEDIA_DEVICE, width: 1920, height: 1080 } },
    },
  });

  const printer = await prisma.device.upsert({
    where: { boothId_fingerprint: { boothId: booth.id, fingerprint: "printer-os-spooler-primary" } },
    update: { name: "Printer sistem (belum dikonfigurasi)", status: DeviceStatus.OFFLINE, preferred: true },
    create: {
      boothId: booth.id,
      fingerprint: "printer-os-spooler-primary",
      type: DeviceType.PRINTER,
      name: "Printer sistem (belum dikonfigurasi)",
      status: DeviceStatus.OFFLINE,
      preferred: true,
      printerProfile: { create: { kind: PrinterKind.OS_SPOOLER, mediaName: "4x6", dpi: 300 } },
      paperCounter: { create: { currentSheets: 0 } },
    },
  });

  for (const kind of [LayoutKind.GRID_2, LayoutKind.GRID_4, LayoutKind.GRID_6, LayoutKind.GRID_8]) {
    const count = Number(kind.split("_")[1]);
    await prisma.layout.upsert({
      where: { slug: kind.toLowerCase().replace("_", "-") },
      update: {},
      create: {
        slug: kind.toLowerCase().replace("_", "-"),
        name: `Grid ${count}`,
        kind,
        sortOrder: count,
        versions: {
          create: {
            version: 1,
            published: true,
            publishedAt: new Date(),
            slots: { create: slotPresets[kind].map((slot) => ({ ...slot, cropMode: "cover" })) },
          },
        },
      },
    });
  }

  const frames = [];
  for (const [index, definition] of frameDefinitions.entries()) {
    const frame = await prisma.frame.upsert({
      where: { tenantId_boothId_slug: { tenantId: tenant.id, boothId: booth.id, slug: definition.slug } },
      update: { name: definition.name, description: definition.description, sortOrder: index + 1, active: true, tenantId: tenant.id, boothId: booth.id },
      create: { ...definition, tenantId: tenant.id, boothId: booth.id, sortOrder: index + 1 },
    });
    frames.push(frame);
    for (const frameLayout of frameLayouts) {
      const assetPath = `/frames/${definition.slug}-grid-${frameLayout.count}.png`;
      const checksum = await checksumFor(assetPath);
      await prisma.frameVersion.upsert({
        where: {
          frameId_version_layoutKind: { frameId: frame.id, version: 1, layoutKind: frameLayout.kind },
        },
        update: { assetPath, checksum, published: true, publishedAt: new Date() },
        create: {
          frameId: frame.id,
          version: 1,
          layoutKind: frameLayout.kind,
          widthPx: 1200,
          heightPx: 1800,
          assetPath,
          checksum,
          published: true,
          publishedAt: new Date(),
        },
      });
    }
  }

  const existingPricing = await prisma.pricingRule.findFirst({ where: { tenantId: tenant.id, boothId: booth.id, name: "Paket 4x6 standar" } });
  if (existingPricing) {
    await prisma.pricingRule.update({ where: { id: existingPricing.id }, data: { basePrice: 50000, additionalCopy: 20000, taxRate: 11 } });
  } else {
    await prisma.pricingRule.create({
      data: {
        tenantId: tenant.id,
        boothId: booth.id,
        name: "Paket 4x6 standar",
        mediaName: "4x6",
        basePrice: 50000,
        additionalCopy: 20000,
        taxRate: 11,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      boothId: booth.id,
      action: "SEED_COMPLETED",
      entityType: "SYSTEM",
      metadata: { cameraId: camera.id, printerId: printer.id, frameIds: frames.map((frame) => frame.id) },
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
