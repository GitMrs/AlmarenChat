ALTER TABLE "Conversation" ADD COLUMN "assistantMode" TEXT;
ALTER TABLE "Message" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'WEB';

UPDATE "Conversation"
SET "assistantMode" = 'TEMPORARY'
WHERE "kind" = 'PERSONAL_ASSISTANT';

UPDATE "Conversation"
SET
  "assistantMode" = 'MAIN',
  "title" = CASE WHEN "title" = '我的助理' THEN '主聊天' ELSE "title" END
WHERE "id" IN (SELECT "conversationId" FROM "PersonalAssistantProfile");

UPDATE "Message"
SET "source" = 'QQ'
WHERE "conversationId" IN (
  SELECT binding."conversationId"
  FROM "AssistantQQBinding" binding
  JOIN "PersonalAssistantProfile" profile ON profile."userId" = binding."userId"
  WHERE binding."conversationId" <> profile."conversationId"
);

UPDATE "AssistantQQBinding"
SET "conversationId" = (
  SELECT profile."conversationId"
  FROM "PersonalAssistantProfile" profile
  WHERE profile."userId" = "AssistantQQBinding"."userId"
)
WHERE EXISTS (
  SELECT 1
  FROM "PersonalAssistantProfile" profile
  WHERE profile."userId" = "AssistantQQBinding"."userId"
);

CREATE INDEX "Conversation_userId_kind_assistantMode_updatedAt_idx"
ON "Conversation"("userId", "kind", "assistantMode", "updatedAt");

CREATE UNIQUE INDEX "Conversation_personalAssistant_main_key"
ON "Conversation"("userId")
WHERE "kind" = 'PERSONAL_ASSISTANT' AND "assistantMode" = 'MAIN';
