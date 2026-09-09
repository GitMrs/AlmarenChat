ALTER TABLE "SpaceConnectorExecution" ADD COLUMN "nextPollAt" DATETIME;
ALTER TABLE "SpaceConnectorExecution" ADD COLUMN "pollCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "SpaceConnectorExecution_status_nextPollAt_idx" ON "SpaceConnectorExecution"("status", "nextPollAt");
