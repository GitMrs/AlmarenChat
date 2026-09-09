ALTER TABLE "SpaceAutomation" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE "SpaceAutomation" ADD COLUMN "scheduleHour" INTEGER;
ALTER TABLE "SpaceAutomation" ADD COLUMN "scheduleMinute" INTEGER;
ALTER TABLE "SpaceAutomation" ADD COLUMN "weekdays" JSONB;
ALTER TABLE "SpaceAutomation" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
