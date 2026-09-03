ALTER TABLE "PersonalAssistantProfile" ADD COLUMN "proactiveEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "AssistantReminder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "dueTime" DATETIME,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sourceMessageId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AssistantReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssistantReminder_userId_status_dueTime_idx" ON "AssistantReminder"("userId", "status", "dueTime");

CREATE TABLE "AssistantProactiveDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "greeting" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SHOWN',
  "messageId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "openedAt" DATETIME,
  CONSTRAINT "AssistantProactiveDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AssistantProactiveDelivery_userId_sourceKey_key" ON "AssistantProactiveDelivery"("userId", "sourceKey");
CREATE INDEX "AssistantProactiveDelivery_userId_createdAt_idx" ON "AssistantProactiveDelivery"("userId", "createdAt");
