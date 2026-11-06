ALTER TABLE "AgentMemoryRule" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'AGENT';
ALTER TABLE "AgentMemoryRule" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "AgentMemoryRule" ADD COLUMN "taskId" TEXT;
ALTER TABLE "AgentMemoryRule" ADD COLUMN "supersededById" TEXT;
