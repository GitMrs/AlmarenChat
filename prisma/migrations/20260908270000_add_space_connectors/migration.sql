CREATE TABLE "SpaceConnector" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'CONFIGURED',
  "publicConfig" JSONB,
  "credentialCiphertext" TEXT NOT NULL,
  "accessTokenCiphertext" TEXT,
  "accessTokenExpiresAt" DATETIME,
  "lastCheckedAt" DATETIME,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SpaceConnector_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SpaceConnector_spaceId_provider_key" ON "SpaceConnector"("spaceId", "provider");
CREATE INDEX "SpaceConnector_spaceId_enabled_idx" ON "SpaceConnector"("spaceId", "enabled");
CREATE INDEX "SpaceConnector_provider_status_idx" ON "SpaceConnector"("provider", "status");

CREATE TABLE "SpaceConnectorExecution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectorId" TEXT NOT NULL,
  "actionRequestId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "requestSummary" JSONB,
  "responseSummary" JSONB,
  "externalId" TEXT,
  "externalUrl" TEXT,
  "error" TEXT,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SpaceConnectorExecution_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "SpaceConnector" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpaceConnectorExecution_actionRequestId_fkey" FOREIGN KEY ("actionRequestId") REFERENCES "SpaceActionRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SpaceConnectorExecution_actionRequestId_key" ON "SpaceConnectorExecution"("actionRequestId");
CREATE INDEX "SpaceConnectorExecution_connectorId_createdAt_idx" ON "SpaceConnectorExecution"("connectorId", "createdAt");
CREATE INDEX "SpaceConnectorExecution_status_createdAt_idx" ON "SpaceConnectorExecution"("status", "createdAt");
