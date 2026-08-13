UPDATE "Space"
SET "hostAgentId" = 'space-coordinator'
WHERE "hostAgentId" IS NULL OR "hostAgentId" != 'space-coordinator';
