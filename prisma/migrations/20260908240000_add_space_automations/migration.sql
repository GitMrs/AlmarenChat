CREATE TABLE "SpaceAutomation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "scheduleType" TEXT NOT NULL DEFAULT 'INTERVAL',
  "intervalMinutes" INTEGER NOT NULL DEFAULT 1440,
  "workStrategy" TEXT NOT NULL DEFAULT 'NEW_WORK',
  "networkPolicy" TEXT NOT NULL DEFAULT 'forbidden',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "nextRunAt" DATETIME NOT NULL,
  "lastRunAt" DATETIME,
  "lastRunId" TEXT,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SpaceAutomation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SpaceAutomationExecution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "automationId" TEXT NOT NULL,
  "scheduledFor" DATETIME NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'TRIGGERED',
  "runId" TEXT,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SpaceAutomationExecution_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "SpaceAutomation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpaceAutomationExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "SpaceAutomation_enabled_nextRunAt_idx" ON "SpaceAutomation"("enabled", "nextRunAt");
CREATE INDEX "SpaceAutomation_spaceId_updatedAt_idx" ON "SpaceAutomation"("spaceId", "updatedAt");
CREATE UNIQUE INDEX "SpaceAutomationExecution_runId_key" ON "SpaceAutomationExecution"("runId");
CREATE UNIQUE INDEX "SpaceAutomationExecution_automationId_scheduledFor_key" ON "SpaceAutomationExecution"("automationId", "scheduledFor");
CREATE INDEX "SpaceAutomationExecution_automationId_createdAt_idx" ON "SpaceAutomationExecution"("automationId", "createdAt");
CREATE INDEX "SpaceAutomationExecution_status_createdAt_idx" ON "SpaceAutomationExecution"("status", "createdAt");
