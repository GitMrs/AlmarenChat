ALTER TABLE "SpaceAutomationExecution" ADD COLUMN "workId" TEXT;
ALTER TABLE "SpaceAutomationExecution" ADD COLUMN "result" TEXT;
ALTER TABLE "SpaceAutomationExecution" ADD COLUMN "resultHash" TEXT;
ALTER TABLE "SpaceAutomationExecution" ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "SpaceAutomationExecution" ADD COLUMN "deliveryAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SpaceAutomationExecution" ADD COLUMN "deliveryError" TEXT;
ALTER TABLE "SpaceAutomationExecution" ADD COLUMN "deliveryNextAttemptAt" DATETIME;
ALTER TABLE "SpaceAutomationExecution" ADD COLUMN "deliveredAt" DATETIME;

CREATE INDEX "SpaceAutomationExecution_deliveryStatus_deliveryNextAttemptAt_idx"
ON "SpaceAutomationExecution"("deliveryStatus", "deliveryNextAttemptAt");
