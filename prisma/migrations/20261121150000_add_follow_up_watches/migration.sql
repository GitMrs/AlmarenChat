ALTER TABLE "SpaceFollowUp" ADD COLUMN "watchConditions" JSONB;
ALTER TABLE "SpaceFollowUp" ADD COLUMN "watchState" JSONB;
ALTER TABLE "SpaceFollowUp" ADD COLUMN "watchEvent" JSONB;
ALTER TABLE "SpaceFollowUp" ADD COLUMN "watchTriggeredAt" DATETIME;
CREATE INDEX "SpaceFollowUp_domain_status_watchTriggeredAt_idx" ON "SpaceFollowUp"("domain", "status", "watchTriggeredAt");
