CREATE TABLE "ConversationContextState" (
  "conversationId" TEXT NOT NULL PRIMARY KEY,
  "summary" TEXT NOT NULL DEFAULT '',
  "throughMessageId" TEXT,
  "throughCreatedAt" DATETIME,
  "sourceCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "lastRequest" JSONB,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ConversationContextState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
