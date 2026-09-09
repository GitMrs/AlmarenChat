ALTER TABLE "SpaceAutomation" ADD COLUMN "completionAction" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "SpaceAutomation" ADD COLUMN "completionConfig" JSONB;
