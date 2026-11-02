ALTER TABLE "AssistantMemoryItem" ADD COLUMN "trustStatus" TEXT NOT NULL DEFAULT 'VERIFIED';
ALTER TABLE "AssistantMemoryItem" ADD COLUMN "confidence" REAL NOT NULL DEFAULT 1;
ALTER TABLE "AssistantMemoryItem" ADD COLUMN "factKey" TEXT;
ALTER TABLE "AssistantMemoryItem" ADD COLUMN "supersededById" TEXT;
ALTER TABLE "AssistantMemoryItem" ADD COLUMN "evidenceQuote" TEXT;

CREATE INDEX "AssistantMemoryItem_userId_agentId_factKey_status_idx" ON "AssistantMemoryItem" ("userId", "agentId", "factKey", "status");

ALTER TABLE "AgentMemoryItem" ADD COLUMN "trustStatus" TEXT NOT NULL DEFAULT 'VERIFIED';
ALTER TABLE "AgentMemoryItem" ADD COLUMN "confidence" REAL NOT NULL DEFAULT 1;
ALTER TABLE "AgentMemoryItem" ADD COLUMN "factKey" TEXT;
ALTER TABLE "AgentMemoryItem" ADD COLUMN "supersededById" TEXT;
ALTER TABLE "AgentMemoryItem" ADD COLUMN "evidenceQuote" TEXT;

CREATE INDEX "AgentMemoryItem_userId_agentId_factKey_status_idx" ON "AgentMemoryItem" ("userId", "agentId", "factKey", "status");
