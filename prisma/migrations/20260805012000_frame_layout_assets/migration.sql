-- Associate each transparent frame asset with its supported photo-grid layout.
ALTER TABLE "FrameVersion"
ADD COLUMN "layoutKind" "LayoutKind" NOT NULL DEFAULT 'GRID_4';

DROP INDEX "FrameVersion_frameId_version_key";

CREATE UNIQUE INDEX "FrameVersion_frameId_version_layoutKind_key"
ON "FrameVersion"("frameId", "version", "layoutKind");

CREATE INDEX "FrameVersion_layoutKind_published_idx"
ON "FrameVersion"("layoutKind", "published");
