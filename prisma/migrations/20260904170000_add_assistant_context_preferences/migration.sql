ALTER TABLE "PersonalAssistantProfile" ADD COLUMN "includeSpaceContext" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PersonalAssistantProfile" ADD COLUMN "includeTaskContext" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PersonalAssistantProfile" ADD COLUMN "includeChatContext" BOOLEAN NOT NULL DEFAULT true;
