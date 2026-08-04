-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "BoothStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('CAMERA', 'PRINTER', 'TABLET', 'KIOSK');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'PAIRING');

-- CreateEnum
CREATE TYPE "CameraKind" AS ENUM ('MEDIA_DEVICE', 'DSLR_TETHERED', 'REMOTE_TABLET');

-- CreateEnum
CREATE TYPE "PrinterKind" AS ENUM ('OS_SPOOLER', 'DNP', 'EPSON', 'ESC_POS', 'MOCK');

-- CreateEnum
CREATE TYPE "LayoutKind" AS ENUM ('GRID_2', 'GRID_4', 'GRID_6', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('CREATED', 'LAYOUT_SELECTED', 'CAPTURING', 'REVIEWING', 'COMPOSED', 'CHECKOUT', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('DISABLED', 'CASH', 'MANUAL', 'ONLINE_PROVIDER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('QUEUED', 'SPOOLING', 'PRINTING', 'PRINTED', 'RETRYING', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UploadJobStatus" AS ENUM ('WAITING_FOR_PRINT_TRIGGER', 'QUEUED', 'UPLOADING', 'SYNCED', 'RETRYING', 'FAILED_PERMANENT');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('ORIGINAL', 'THUMBNAIL', 'PREVIEW', 'COMPOSITE', 'FRAME', 'IDLE_MEDIA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booth" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "status" "BoothStatus" NOT NULL DEFAULT 'OFFLINE',
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoothSetting" (
    "id" TEXT NOT NULL,
    "boothId" TEXT NOT NULL,
    "countdownSeconds" INTEGER NOT NULL DEFAULT 3,
    "maxRetakes" INTEGER NOT NULL DEFAULT 1,
    "idleTimeoutSeconds" INTEGER NOT NULL DEFAULT 90,
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'DISABLED',
    "unprintedRetentionHours" INTEGER NOT NULL DEFAULT 24,
    "syncedRetentionDays" INTEGER NOT NULL DEFAULT 7,
    "locale" TEXT NOT NULL DEFAULT 'id-ID',
    "config" JSONB,

    CONSTRAINT "BoothSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "boothId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "type" "DeviceType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
    "preferred" BOOLEAN NOT NULL DEFAULT false,
    "driverName" TEXT,
    "firmware" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "capabilities" JSONB,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceHeartbeat" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL,
    "metrics" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraProfile" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" "CameraKind" NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 1920,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "facingMode" TEXT,
    "mirrorPreview" BOOLEAN NOT NULL DEFAULT true,
    "mirrorOutput" BOOLEAN NOT NULL DEFAULT false,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "captureConfig" JSONB,

    CONSTRAINT "CameraProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrinterProfile" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" "PrinterKind" NOT NULL,
    "mediaName" TEXT NOT NULL DEFAULT '4x6',
    "widthInches" DECIMAL(6,2) NOT NULL DEFAULT 4,
    "heightInches" DECIMAL(6,2) NOT NULL DEFAULT 6,
    "dpi" INTEGER NOT NULL DEFAULT 300,
    "orientation" TEXT NOT NULL DEFAULT 'portrait',
    "borderless" BOOLEAN NOT NULL DEFAULT true,
    "colorProfile" TEXT,
    "maxCopies" INTEGER NOT NULL DEFAULT 10,
    "fallbackDevice" TEXT,
    "printConfig" JSONB,

    CONSTRAINT "PrinterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperCounter" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "currentSheets" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 400,
    "resetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Layout" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LayoutKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayoutVersion" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "widthPx" INTEGER NOT NULL DEFAULT 1200,
    "heightPx" INTEGER NOT NULL DEFAULT 1800,
    "dpi" INTEGER NOT NULL DEFAULT 300,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LayoutVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LayoutSlot" (
    "id" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cropMode" TEXT NOT NULL DEFAULT 'cover',
    "borderRadius" INTEGER NOT NULL DEFAULT 0,
    "zIndex" INTEGER NOT NULL DEFAULT 1,
    "mask" JSONB,

    CONSTRAINT "LayoutSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Frame" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Frame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameVersion" (
    "id" TEXT NOT NULL,
    "frameId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    "assetPath" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrameVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoSession" (
    "id" TEXT NOT NULL,
    "publicCode" TEXT NOT NULL,
    "boothId" TEXT NOT NULL,
    "layoutVersionId" TEXT,
    "frameVersionId" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'CREATED',
    "localPath" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "PhotoSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapturedPhoto" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "slotIndex" INTEGER,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "source" "CameraKind" NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "CapturedPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Composition" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "frameVersionId" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "previewPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Composition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "capturedPhotoId" TEXT,
    "compositionId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "localPath" TEXT,
    "objectKey" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "boothId" TEXT,
    "name" TEXT NOT NULL,
    "layoutKind" "LayoutKind",
    "mediaName" TEXT,
    "basePrice" DECIMAL(12,2) NOT NULL,
    "additionalCopy" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerReference" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "externalId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "compositionId" TEXT NOT NULL,
    "deviceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintAttempt" (
    "id" TEXT NOT NULL,
    "printJobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "PrintJobStatus" NOT NULL,
    "spoolerId" TEXT,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PrintAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadJob" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "UploadJobStatus" NOT NULL DEFAULT 'WAITING_FOR_PRINT_TRIGGER',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "queuedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadAttempt" (
    "id" TEXT NOT NULL,
    "uploadJobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "UploadJobStatus" NOT NULL,
    "errorCode" TEXT,
    "detail" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "UploadAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gallery" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gallery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryToken" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdleMedia" (
    "id" TEXT NOT NULL,
    "boothId" TEXT,
    "title" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "assetPath" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 10000,
    "muted" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),

    CONSTRAINT "IdleMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "boothId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Booth_code_key" ON "Booth"("code");

-- CreateIndex
CREATE INDEX "Booth_status_lastHeartbeatAt_idx" ON "Booth"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoothSetting_boothId_key" ON "BoothSetting"("boothId");

-- CreateIndex
CREATE INDEX "Device_boothId_type_status_idx" ON "Device"("boothId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Device_boothId_fingerprint_key" ON "Device"("boothId", "fingerprint");

-- CreateIndex
CREATE INDEX "DeviceHeartbeat_deviceId_createdAt_idx" ON "DeviceHeartbeat"("deviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CameraProfile_deviceId_key" ON "CameraProfile"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "PrinterProfile_deviceId_key" ON "PrinterProfile"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperCounter_deviceId_key" ON "PaperCounter"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Layout_slug_key" ON "Layout"("slug");

-- CreateIndex
CREATE INDEX "Layout_active_sortOrder_idx" ON "Layout"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "LayoutVersion_layoutId_published_idx" ON "LayoutVersion"("layoutId", "published");

-- CreateIndex
CREATE UNIQUE INDEX "LayoutVersion_layoutId_version_key" ON "LayoutVersion"("layoutId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LayoutSlot_layoutVersionId_slotIndex_key" ON "LayoutSlot"("layoutVersionId", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Frame_slug_key" ON "Frame"("slug");

-- CreateIndex
CREATE INDEX "Frame_active_sortOrder_idx" ON "Frame"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FrameVersion_frameId_version_key" ON "FrameVersion"("frameId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoSession_publicCode_key" ON "PhotoSession"("publicCode");

-- CreateIndex
CREATE INDEX "PhotoSession_boothId_startedAt_idx" ON "PhotoSession"("boothId", "startedAt");

-- CreateIndex
CREATE INDEX "PhotoSession_status_startedAt_idx" ON "PhotoSession"("status", "startedAt");

-- CreateIndex
CREATE INDEX "CapturedPhoto_sessionId_capturedAt_idx" ON "CapturedPhoto"("sessionId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CapturedPhoto_sessionId_checksum_key" ON "CapturedPhoto"("sessionId", "checksum");

-- CreateIndex
CREATE INDEX "Composition_sessionId_createdAt_idx" ON "Composition"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_sessionId_syncedAt_idx" ON "Asset"("sessionId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_sessionId_checksum_kind_key" ON "Asset"("sessionId", "checksum", "kind");

-- CreateIndex
CREATE INDEX "PricingRule_boothId_active_idx" ON "PricingRule"("boothId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Order_sessionId_key" ON "Order"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerReference_key" ON "Payment"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_externalId_key" ON "PaymentEvent"("externalId");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentId_createdAt_idx" ON "PaymentEvent"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_idempotencyKey_key" ON "PrintJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrintJob_status_queuedAt_idx" ON "PrintJob"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "PrintJob_deviceId_status_idx" ON "PrintJob"("deviceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PrintAttempt_printJobId_attempt_key" ON "PrintAttempt"("printJobId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadJob_idempotencyKey_key" ON "UploadJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UploadJob_status_nextRetryAt_idx" ON "UploadJob"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadAttempt_uploadJobId_attempt_key" ON "UploadAttempt"("uploadJobId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "Gallery_sessionId_key" ON "Gallery"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryToken_tokenHash_key" ON "GalleryToken"("tokenHash");

-- CreateIndex
CREATE INDEX "GalleryToken_galleryId_expiresAt_idx" ON "GalleryToken"("galleryId", "expiresAt");

-- CreateIndex
CREATE INDEX "IdleMedia_boothId_active_sortOrder_idx" ON "IdleMedia"("boothId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "AuditLog_boothId_createdAt_idx" ON "AuditLog"("boothId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "BoothSetting" ADD CONSTRAINT "BoothSetting_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceHeartbeat" ADD CONSTRAINT "DeviceHeartbeat_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraProfile" ADD CONSTRAINT "CameraProfile_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrinterProfile" ADD CONSTRAINT "PrinterProfile_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperCounter" ADD CONSTRAINT "PaperCounter_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayoutVersion" ADD CONSTRAINT "LayoutVersion_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LayoutSlot" ADD CONSTRAINT "LayoutSlot_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameVersion" ADD CONSTRAINT "FrameVersion_frameId_fkey" FOREIGN KEY ("frameId") REFERENCES "Frame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_frameVersionId_fkey" FOREIGN KEY ("frameVersionId") REFERENCES "FrameVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapturedPhoto" ADD CONSTRAINT "CapturedPhoto_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhotoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Composition" ADD CONSTRAINT "Composition_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhotoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Composition" ADD CONSTRAINT "Composition_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "LayoutVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Composition" ADD CONSTRAINT "Composition_frameVersionId_fkey" FOREIGN KEY ("frameVersionId") REFERENCES "FrameVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhotoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_capturedPhotoId_fkey" FOREIGN KEY ("capturedPhotoId") REFERENCES "CapturedPhoto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhotoSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintAttempt" ADD CONSTRAINT "PrintAttempt_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadJob" ADD CONSTRAINT "UploadJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhotoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadAttempt" ADD CONSTRAINT "UploadAttempt_uploadJobId_fkey" FOREIGN KEY ("uploadJobId") REFERENCES "UploadJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gallery" ADD CONSTRAINT "Gallery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhotoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryToken" ADD CONSTRAINT "GalleryToken_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdleMedia" ADD CONSTRAINT "IdleMedia_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE SET NULL ON UPDATE CASCADE;
