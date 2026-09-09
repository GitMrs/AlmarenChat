ALTER TABLE "SpaceAutomation" ADD COLUMN "deletedAt" DATETIME;
CREATE INDEX "SpaceAutomation_spaceId_deletedAt_idx" ON "SpaceAutomation"("spaceId", "deletedAt");
