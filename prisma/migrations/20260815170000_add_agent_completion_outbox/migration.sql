ALTER TABLE "AgentRun" ADD COLUMN "completionId" TEXT;
ALTER TABLE "AgentRunEvent" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "SpaceMessage" ADD COLUMN "sourceKey" TEXT;

CREATE TABLE "AgentRunOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedBy" TEXT,
  "claimedAt" DATETIME,
  "deliveredAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AgentRunOutbox_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentRun_completionId_key" ON "AgentRun"("completionId");
CREATE UNIQUE INDEX "AgentRunEvent_idempotencyKey_key" ON "AgentRunEvent"("idempotencyKey");
CREATE UNIQUE INDEX "SpaceMessage_sourceKey_key" ON "SpaceMessage"("sourceKey");
CREATE UNIQUE INDEX "AgentRunOutbox_runId_key" ON "AgentRunOutbox"("runId");
CREATE UNIQUE INDEX "AgentRunOutbox_idempotencyKey_key" ON "AgentRunOutbox"("idempotencyKey");
CREATE INDEX "AgentRunOutbox_status_availableAt_idx" ON "AgentRunOutbox"("status", "availableAt");
CREATE INDEX "AgentRunOutbox_claimedBy_claimedAt_idx" ON "AgentRunOutbox"("claimedBy", "claimedAt");
