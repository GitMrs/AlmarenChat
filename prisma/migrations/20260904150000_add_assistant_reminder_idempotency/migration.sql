ALTER TABLE "AssistantReminder" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "AssistantReminder_userId_idempotencyKey_key"
ON "AssistantReminder"("userId", "idempotencyKey");
