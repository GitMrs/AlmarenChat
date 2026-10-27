ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyBilibiliCredentialCiphertext" TEXT;
ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyBilibiliProfile" JSONB;
ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyBilibiliLastCheckedAt" DATETIME;
ALTER TABLE "AgentModelSetting" ADD COLUMN "dailyStudyBilibiliLastError" TEXT;
