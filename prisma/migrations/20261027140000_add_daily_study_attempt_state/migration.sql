ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyAttemptDate" TEXT;
ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyAttemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyNextAttemptAt" DATETIME;
