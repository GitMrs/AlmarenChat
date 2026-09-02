ALTER TABLE "Conversation" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'AGENT';

CREATE TABLE "PersonalAssistantProfile" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '小伴',
  "avatar" TEXT,
  "identity" TEXT,
  "soul" TEXT,
  "greeting" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PersonalAssistantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PersonalAssistantProfile_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AssistantMemoryItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'preference',
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "sourceMessageId" TEXT,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AssistantMemoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Conversation_userId_kind_updatedAt_idx" ON "Conversation"("userId", "kind", "updatedAt");
CREATE UNIQUE INDEX "PersonalAssistantProfile_conversationId_key" ON "PersonalAssistantProfile"("conversationId");
CREATE INDEX "AssistantMemoryItem_userId_status_updatedAt_idx" ON "AssistantMemoryItem"("userId", "status", "updatedAt");
