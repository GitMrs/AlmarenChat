CREATE TABLE "AssistantExperience" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "messageCount" INTEGER NOT NULL,
  "startAt" DATETIME NOT NULL,
  "endAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AssistantExperience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssistantExperience_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "Message" ADD COLUMN "assistantExperienceId" TEXT REFERENCES "AssistantExperience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Message_assistantExperienceId_idx" ON "Message"("assistantExperienceId");
CREATE INDEX "AssistantExperience_userId_endAt_idx" ON "AssistantExperience"("userId", "endAt");
CREATE INDEX "AssistantExperience_conversationId_endAt_idx" ON "AssistantExperience"("conversationId", "endAt");
