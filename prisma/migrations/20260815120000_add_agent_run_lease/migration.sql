ALTER TABLE "AgentRun" ADD COLUMN "workerId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN "heartbeatAt" DATETIME;

CREATE INDEX "AgentRun_workerId_heartbeatAt_idx" ON "AgentRun"("workerId", "heartbeatAt");
