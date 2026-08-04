-- CreateTable
CREATE TABLE "SessionResetCode" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "sessionId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeEncrypted" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionResetCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionResetCode_codeHash_key" ON "SessionResetCode"("codeHash");

-- CreateIndex
CREATE INDEX "SessionResetCode_sessionId_createdAt_idx" ON "SessionResetCode"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "SessionResetCode_expiresAt_usedAt_revokedAt_idx" ON "SessionResetCode"("expiresAt", "usedAt", "revokedAt");

-- AddForeignKey
ALTER TABLE "SessionResetCode" ADD CONSTRAINT "SessionResetCode_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhotoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionResetCode" ADD CONSTRAINT "SessionResetCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
