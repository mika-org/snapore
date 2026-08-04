CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Convert every persisted primary key to UUID text. Existing foreign keys use
-- ON UPDATE CASCADE, so references are preserved without deleting user data.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'User', 'Booth', 'BoothSetting', 'Device', 'DeviceHeartbeat',
    'CameraProfile', 'PrinterProfile', 'PaperCounter', 'Layout',
    'LayoutVersion', 'LayoutSlot', 'Frame', 'FrameVersion', 'PhotoSession',
    'CapturedPhoto', 'Composition', 'Asset', 'PricingRule', 'Order',
    'Payment', 'PaymentEvent', 'PrintJob', 'PrintAttempt', 'UploadJob',
    'UploadAttempt', 'Gallery', 'GalleryToken', 'IdleMedia', 'AuditLog'
  ]
  LOOP
    EXECUTE format('UPDATE %I SET id = gen_random_uuid()::text', table_name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT gen_random_uuid()::text', table_name);
  END LOOP;
END $$;

CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "XenditEnvironment" AS ENUM ('TEST', 'LIVE');
ALTER TYPE "LayoutKind" ADD VALUE IF NOT EXISTS 'GRID_8';

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 11,
  "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true,
  "defaultPrintCost" DECIMAL(12,2) NOT NULL DEFAULT 5000,
  "paymentFeeRate" DECIMAL(5,2) NOT NULL DEFAULT 0.7,
  "paymentFeeFixed" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Tenant" ("slug", "name")
VALUES ('snapore-default', 'Snapore Default Tenant');

ALTER TABLE "User"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "tenantId" TEXT;

ALTER TABLE "Booth"
  ADD COLUMN "kioskEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tenantId" TEXT;

ALTER TABLE "Frame"
  ADD COLUMN "boothId" TEXT,
  ADD COLUMN "tenantId" TEXT;

ALTER TABLE "PricingRule"
  ADD COLUMN "tenantId" TEXT;

UPDATE "Booth"
SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "slug" = 'snapore-default');

UPDATE "Frame"
SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "slug" = 'snapore-default'),
    "boothId" = (SELECT "id" FROM "Booth" ORDER BY "createdAt" LIMIT 1);

UPDATE "PricingRule"
SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "slug" = 'snapore-default');

UPDATE "User"
SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "slug" = 'snapore-default')
WHERE "role" <> 'SUPER_ADMIN';

ALTER TABLE "Booth" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Frame" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "PricingRule" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "FrameVersion" ALTER COLUMN "layoutKind" DROP DEFAULT;

ALTER TABLE "Order"
  ADD COLUMN "netProfit" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paymentFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "printCost" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "TenantPaymentConfig" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'XENDIT',
  "environment" "XenditEnvironment" NOT NULL DEFAULT 'TEST',
  "apiKeyEncrypted" TEXT,
  "apiKeyLastFour" TEXT,
  "webhookTokenEncrypted" TEXT,
  "webhookTokenLastFour" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantPaymentConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

DROP INDEX "Frame_slug_key";

CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE INDEX "Tenant_status_name_idx" ON "Tenant"("status", "name");
CREATE UNIQUE INDEX "TenantPaymentConfig_tenantId_key" ON "TenantPaymentConfig"("tenantId");
CREATE UNIQUE INDEX "WebhookEvent_providerEventId_key" ON "WebhookEvent"("providerEventId");
CREATE INDEX "WebhookEvent_provider_eventType_createdAt_idx" ON "WebhookEvent"("provider", "eventType", "createdAt");
CREATE INDEX "Booth_tenantId_status_idx" ON "Booth"("tenantId", "status");
CREATE INDEX "Frame_tenantId_boothId_active_sortOrder_idx" ON "Frame"("tenantId", "boothId", "active", "sortOrder");
CREATE UNIQUE INDEX "Frame_tenantId_boothId_slug_key" ON "Frame"("tenantId", "boothId", "slug");
CREATE INDEX "PricingRule_tenantId_active_idx" ON "PricingRule"("tenantId", "active");
CREATE INDEX "User_tenantId_role_active_idx" ON "User"("tenantId", "role", "active");

ALTER TABLE "TenantPaymentConfig" ADD CONSTRAINT "TenantPaymentConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booth" ADD CONSTRAINT "Booth_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Frame" ADD CONSTRAINT "Frame_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Frame" ADD CONSTRAINT "Frame_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
