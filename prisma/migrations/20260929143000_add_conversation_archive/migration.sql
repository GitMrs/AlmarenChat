ALTER TABLE "Conversation" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Conversation_userId_agentId_agentMode_archived_idx"
ON "Conversation"("userId", "agentId", "agentMode", "archived");
