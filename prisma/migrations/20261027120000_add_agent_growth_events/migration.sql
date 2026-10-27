CREATE TABLE "AgentGrowthEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "spaceId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'PERSONAL',
    "type" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'CHAT',
    "sourceId" TEXT,
    "eventKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentGrowthEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentGrowthEvent_eventKey_key" ON "AgentGrowthEvent"("eventKey");
CREATE INDEX "AgentGrowthEvent_userId_agentId_createdAt_idx" ON "AgentGrowthEvent"("userId", "agentId", "createdAt");
CREATE INDEX "AgentGrowthEvent_userId_agentId_scope_createdAt_idx" ON "AgentGrowthEvent"("userId", "agentId", "scope", "createdAt");
CREATE INDEX "AgentGrowthEvent_userId_agentId_spaceId_createdAt_idx" ON "AgentGrowthEvent"("userId", "agentId", "spaceId", "createdAt");
