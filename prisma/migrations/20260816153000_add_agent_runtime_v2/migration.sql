ALTER TABLE "AgentRun" ADD COLUMN "runtimeVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AgentRun" ADD COLUMN "eventSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentRun" ADD COLUMN "coordinatorState" JSONB;

ALTER TABLE "AgentTask" ADD COLUMN "acceptanceCriteria" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'legacy_plan';
ALTER TABLE "AgentTask" ADD COLUMN "parentTaskId" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN "proposedAt" DATETIME;
ALTER TABLE "AgentTask" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "AgentTask" ADD COLUMN "submittedAt" DATETIME;
ALTER TABLE "AgentTask" ADD COLUMN "reviewDecision" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN "reviewSummary" TEXT;

ALTER TABLE "AgentRunEvent" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentRunEvent" ADD COLUMN "taskId" TEXT;
ALTER TABLE "AgentRunEvent" ADD COLUMN "agentId" TEXT;
ALTER TABLE "AgentRunEvent" ADD COLUMN "attempt" INTEGER;
ALTER TABLE "AgentRunEvent" ADD COLUMN "actor" TEXT;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "runId" ORDER BY "createdAt", "id") AS "nextSequence"
  FROM "AgentRunEvent"
)
UPDATE "AgentRunEvent"
SET "sequence" = (SELECT "nextSequence" FROM ranked WHERE ranked."id" = "AgentRunEvent"."id");

UPDATE "AgentRun"
SET "eventSequence" = COALESCE((
  SELECT MAX("sequence") FROM "AgentRunEvent" WHERE "AgentRunEvent"."runId" = "AgentRun"."id"
), 0);

CREATE TABLE "AgentSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IDLE',
  "currentTaskId" TEXT,
  "worklog" TEXT,
  "summary" TEXT,
  "lastActiveAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AgentCoordinatorTurn" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "triggerEventId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "inputSnapshot" JSONB,
  "action" JSONB,
  "error" TEXT,
  "modelRequestCount" INTEGER NOT NULL DEFAULT 0,
  "claimedBy" TEXT,
  "claimedAt" DATETIME,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AgentCoordinatorTurn_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentTaskCompletion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "workerId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "report" TEXT NOT NULL,
  "evidence" JSONB,
  "artifacts" JSONB,
  "validation" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentTaskCompletion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentTaskCompletion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentRuntimeOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
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
  CONSTRAINT "AgentRuntimeOutbox_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentSession_spaceId_agentId_key" ON "AgentSession"("spaceId", "agentId");
CREATE INDEX "AgentSession_spaceId_status_idx" ON "AgentSession"("spaceId", "status");
CREATE INDEX "AgentSession_currentTaskId_idx" ON "AgentSession"("currentTaskId");
CREATE UNIQUE INDEX "AgentCoordinatorTurn_runId_triggerEventId_key" ON "AgentCoordinatorTurn"("runId", "triggerEventId");
CREATE INDEX "AgentCoordinatorTurn_status_createdAt_idx" ON "AgentCoordinatorTurn"("status", "createdAt");
CREATE INDEX "AgentCoordinatorTurn_claimedBy_claimedAt_idx" ON "AgentCoordinatorTurn"("claimedBy", "claimedAt");
CREATE UNIQUE INDEX "AgentTaskCompletion_taskId_attempt_key" ON "AgentTaskCompletion"("taskId", "attempt");
CREATE UNIQUE INDEX "AgentTaskCompletion_idempotencyKey_key" ON "AgentTaskCompletion"("idempotencyKey");
CREATE INDEX "AgentTaskCompletion_runId_createdAt_idx" ON "AgentTaskCompletion"("runId", "createdAt");
CREATE INDEX "AgentTaskCompletion_taskId_active_idx" ON "AgentTaskCompletion"("taskId", "active");
CREATE UNIQUE INDEX "AgentRunEvent_runId_sequence_key" ON "AgentRunEvent"("runId", "sequence");
CREATE INDEX "AgentRunEvent_runId_taskId_sequence_idx" ON "AgentRunEvent"("runId", "taskId", "sequence");
CREATE UNIQUE INDEX "AgentRuntimeOutbox_idempotencyKey_key" ON "AgentRuntimeOutbox"("idempotencyKey");
CREATE INDEX "AgentRuntimeOutbox_status_availableAt_idx" ON "AgentRuntimeOutbox"("status", "availableAt");
CREATE INDEX "AgentRuntimeOutbox_runId_kind_createdAt_idx" ON "AgentRuntimeOutbox"("runId", "kind", "createdAt");
CREATE INDEX "AgentRuntimeOutbox_claimedBy_claimedAt_idx" ON "AgentRuntimeOutbox"("claimedBy", "claimedAt");
