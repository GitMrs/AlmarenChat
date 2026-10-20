CREATE TABLE "AgentModelSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "modelName" TEXT,
    "apiBaseUrl" TEXT,
    "apiKey" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentModelSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentModelSetting_userId_agentId_key" ON "AgentModelSetting"("userId", "agentId");
