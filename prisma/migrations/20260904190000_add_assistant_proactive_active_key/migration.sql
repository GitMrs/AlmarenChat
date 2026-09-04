ALTER TABLE "AssistantProactiveDelivery" ADD COLUMN "activeKey" TEXT;

CREATE UNIQUE INDEX "AssistantProactiveDelivery_userId_activeKey_key"
ON "AssistantProactiveDelivery"("userId", "activeKey");
