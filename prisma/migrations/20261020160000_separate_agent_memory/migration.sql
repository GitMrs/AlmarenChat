CREATE TABLE "AgentMemoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'preference',
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentMemoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AgentMemoryItem_userId_agentId_status_updatedAt_idx" ON "AgentMemoryItem"("userId", "agentId", "status", "updatedAt");

INSERT OR IGNORE INTO "AgentMemoryItem" ("id", "userId", "agentId", "category", "content", "status", "sourceMessageId", "createdAt", "updatedAt")
SELECT "id", "userId", "agentId", "category", "content", "status", "sourceMessageId", "createdAt", "updatedAt"
FROM "AssistantMemoryItem" WHERE "agentId" IS NOT NULL AND trim("agentId") <> '';

ALTER TABLE "AgentExperience" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'TASK';
ALTER TABLE "AgentExperience" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "AgentExperience" ADD COLUMN "edited" BOOLEAN NOT NULL DEFAULT false;
