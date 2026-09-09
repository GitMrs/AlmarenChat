CREATE TABLE "SpaceActionRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "workId" TEXT,
  "runId" TEXT,
  "automationExecutionId" TEXT,
  "kind" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL DEFAULT 'HIGH',
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "result" JSONB,
  "error" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "decidedBy" TEXT,
  "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SpaceActionRequest_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpaceActionRequest_workId_fkey" FOREIGN KEY ("workId") REFERENCES "SpaceWork" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SpaceActionRequest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SpaceActionRequest_automationExecutionId_fkey" FOREIGN KEY ("automationExecutionId") REFERENCES "SpaceAutomationExecution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SpaceActionRequest_idempotencyKey_key" ON "SpaceActionRequest"("idempotencyKey");
CREATE INDEX "SpaceActionRequest_spaceId_status_createdAt_idx" ON "SpaceActionRequest"("spaceId", "status", "createdAt");
CREATE INDEX "SpaceActionRequest_workId_createdAt_idx" ON "SpaceActionRequest"("workId", "createdAt");
CREATE INDEX "SpaceActionRequest_runId_createdAt_idx" ON "SpaceActionRequest"("runId", "createdAt");
