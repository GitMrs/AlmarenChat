CREATE TABLE "AgentExperience" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "spaceId" TEXT,
  "runId" TEXT,
  "taskId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "tags" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AgentExperience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentExperience_userId_agentId_taskId_key" ON "AgentExperience"("userId", "agentId", "taskId");
CREATE INDEX "AgentExperience_userId_agentId_createdAt_idx" ON "AgentExperience"("userId", "agentId", "createdAt");

CREATE TABLE "AgentMemoryRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "instruction" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "evidenceCount" INTEGER NOT NULL DEFAULT 1,
  "sourceIds" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AgentMemoryRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentMemoryRule_userId_agentId_key_key" ON "AgentMemoryRule"("userId", "agentId", "key");
CREATE INDEX "AgentMemoryRule_userId_agentId_status_updatedAt_idx" ON "AgentMemoryRule"("userId", "agentId", "status", "updatedAt");
