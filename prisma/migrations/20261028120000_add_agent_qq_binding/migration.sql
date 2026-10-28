-- CreateTable
CREATE TABLE "QqBotAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "appId" TEXT NOT NULL,
    "appSecretCiphertext" TEXT NOT NULL,
    "label" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DEDICATED',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "connectedAt" DATETIME,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QqBotAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QqUserIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "qqOpenId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QqUserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QqUserIdentity_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "QqBotAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentQQBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "botAccountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "routeKey" TEXT,
    "webhookTokenHash" TEXT,
    "webhookTokenCiphertext" TEXT,
    "webhookCreatedAt" DATETIME,
    "webhookLastUsedAt" DATETIME,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastInboundAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentQQBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentQQBinding_botAccountId_fkey" FOREIGN KEY ("botAccountId") REFERENCES "QqBotAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentQQBinding_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QqBotAccount_appId_key" ON "QqBotAccount"("appId");

-- CreateIndex
CREATE INDEX "QqBotAccount_userId_enabled_idx" ON "QqBotAccount"("userId", "enabled");

-- CreateIndex
CREATE INDEX "QqBotAccount_enabled_status_idx" ON "QqBotAccount"("enabled", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QqUserIdentity_botAccountId_qqOpenId_key" ON "QqUserIdentity"("botAccountId", "qqOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "QqUserIdentity_userId_botAccountId_key" ON "QqUserIdentity"("userId", "botAccountId");

-- CreateIndex
CREATE INDEX "QqUserIdentity_userId_idx" ON "QqUserIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentQQBinding_conversationId_key" ON "AgentQQBinding"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentQQBinding_webhookTokenHash_key" ON "AgentQQBinding"("webhookTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AgentQQBinding_userId_agentId_key" ON "AgentQQBinding"("userId", "agentId");

-- CreateIndex
CREATE INDEX "AgentQQBinding_botAccountId_routeKey_idx" ON "AgentQQBinding"("botAccountId", "routeKey");

-- CreateIndex
CREATE INDEX "AgentQQBinding_botAccountId_enabled_idx" ON "AgentQQBinding"("botAccountId", "enabled");

-- CreateIndex
CREATE INDEX "AgentQQBinding_userId_updatedAt_idx" ON "AgentQQBinding"("userId", "updatedAt");
