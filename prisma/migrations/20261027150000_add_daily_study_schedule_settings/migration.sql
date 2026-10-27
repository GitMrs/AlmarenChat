ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyStartHour" INTEGER;
ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyWindowEndHour" INTEGER;
ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyMaxAttempts" INTEGER;
ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyRetryBackoffMinutes" INTEGER;
