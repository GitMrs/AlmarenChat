ALTER TABLE "Conversation" ADD COLUMN "agentMode" TEXT NOT NULL DEFAULT 'MAIN';

UPDATE "Conversation"
SET "agentMode" = 'TEMPORARY'
WHERE "kind" = 'AGENT';

UPDATE "Conversation"
SET "agentMode" = 'MAIN'
WHERE "kind" = 'AGENT'
  AND "id" IN (
    SELECT "id"
    FROM (
      SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "userId", "agentId"
        ORDER BY "createdAt" ASC, "id" ASC
      ) AS "rowNumber"
      FROM "Conversation"
      WHERE "kind" = 'AGENT'
    )
    WHERE "rowNumber" = 1
  );

CREATE INDEX "Conversation_userId_agentId_agentMode_idx"
ON "Conversation"("userId", "agentId", "agentMode");
