ALTER TABLE "AssistantQQBinding" ADD COLUMN "webhookTokenHash" TEXT;
ALTER TABLE "AssistantQQBinding" ADD COLUMN "webhookTokenCiphertext" TEXT;
ALTER TABLE "AssistantQQBinding" ADD COLUMN "webhookCreatedAt" DATETIME;
ALTER TABLE "AssistantQQBinding" ADD COLUMN "webhookLastUsedAt" DATETIME;

CREATE UNIQUE INDEX "AssistantQQBinding_webhookTokenHash_key" ON "AssistantQQBinding"("webhookTokenHash");
