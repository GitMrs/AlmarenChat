ALTER TABLE "AgentExperience" ADD COLUMN "memoryTypes" JSONB;
ALTER TABLE "AssistantExperience" ADD COLUMN "memoryTypes" JSONB;
ALTER TABLE "AgentExperience" ADD COLUMN "memorySegments" JSONB;
ALTER TABLE "AssistantExperience" ADD COLUMN "memorySegments" JSONB;
