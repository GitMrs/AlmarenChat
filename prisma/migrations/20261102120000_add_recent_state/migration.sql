CREATE TABLE "RecentState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
  "mentionedAt" DATETIME NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "sourceMessageId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RecentState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RecentState_conversationId_status_expiresAt_idx" ON "RecentState" ("conversationId", "status", "expiresAt");
CREATE INDEX "RecentState_conversationId_mentionedAt_idx" ON "RecentState" ("conversationId", "mentionedAt");
