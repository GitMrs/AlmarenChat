ALTER TABLE "SpaceFile" ADD COLUMN "runId" TEXT;
ALTER TABLE "SpaceFile" ADD COLUMN "taskId" TEXT;
ALTER TABLE "SpaceFile" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'READY';
ALTER TABLE "SpaceFile" ADD COLUMN "updatedAt" DATETIME;

ALTER TABLE "AgentTask" ADD COLUMN "reviewFeedback" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AgentTask" ADD COLUMN "reviewedAt" DATETIME;

CREATE INDEX "SpaceFile_runId_idx" ON "SpaceFile"("runId");
CREATE INDEX "SpaceFile_taskId_idx" ON "SpaceFile"("taskId");
