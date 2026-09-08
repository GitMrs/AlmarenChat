ALTER TABLE "Agent" ADD COLUMN "agentType" TEXT NOT NULL DEFAULT 'BASIC';

UPDATE "Agent"
SET "agentType" = 'EMPLOYEE'
WHERE "systemPrompt" LIKE '%# ROLE%'
   OR "systemPrompt" LIKE '%SOUL%'
   OR "systemPrompt" LIKE '%BLUE-TEAM REBUTTAL PROTOCOL%'
   OR "systemPrompt" LIKE '%SOP: WORKFLOW & CHECKLIST%';
