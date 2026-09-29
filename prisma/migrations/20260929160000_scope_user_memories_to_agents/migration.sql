ALTER TABLE "AssistantMemoryItem" ADD COLUMN "agentId" TEXT;

CREATE INDEX "AssistantMemoryItem_userId_agentId_status_updatedAt_idx"
ON "AssistantMemoryItem"("userId", "agentId", "status", "updatedAt");
