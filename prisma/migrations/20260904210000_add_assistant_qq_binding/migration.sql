ALTER TABLE "AssistantReminder" ADD COLUMN "qqDeliveredAt" DATETIME;
ALTER TABLE "AssistantReminder" ADD COLUMN "qqMessageId" TEXT;
ALTER TABLE "AssistantReminder" ADD COLUMN "qqDeliveryAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AssistantReminder" ADD COLUMN "qqNextAttemptAt" DATETIME;
ALTER TABLE "AssistantReminder" ADD COLUMN "qqDeliveryError" TEXT;

CREATE TABLE "AssistantQQBinding" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "appSecretCiphertext" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "qqOpenId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lastError" TEXT,
  "connectedAt" DATETIME,
  "lastInboundAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AssistantQQBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssistantQQBinding_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AssistantQQBinding_conversationId_key" ON "AssistantQQBinding"("conversationId");
CREATE UNIQUE INDEX "AssistantQQBinding_appId_key" ON "AssistantQQBinding"("appId");
CREATE INDEX "AssistantQQBinding_enabled_status_idx" ON "AssistantQQBinding"("enabled", "status");

CREATE TABLE "AssistantQQEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantQQEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssistantQQEvent_userId_createdAt_idx" ON "AssistantQQEvent"("userId", "createdAt");
