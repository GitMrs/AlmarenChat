ALTER TABLE "SpaceWork" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "SpaceWork" ADD COLUMN "stage" TEXT;
ALTER TABLE "SpaceWork" ADD COLUMN "objective" TEXT;
ALTER TABLE "SpaceWork" ADD COLUMN "metadata" JSONB;
ALTER TABLE "SpaceWork" ADD COLUMN "completedAt" DATETIME;

CREATE INDEX "SpaceWork_spaceId_status_updatedAt_idx" ON "SpaceWork"("spaceId", "status", "updatedAt");
