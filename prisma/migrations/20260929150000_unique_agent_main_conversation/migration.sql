CREATE UNIQUE INDEX "Conversation_agent_main_user_agent_key"
ON "Conversation"("userId", "agentId")
WHERE "kind" = 'AGENT' AND "agentMode" = 'MAIN' AND "agentId" IS NOT NULL;
