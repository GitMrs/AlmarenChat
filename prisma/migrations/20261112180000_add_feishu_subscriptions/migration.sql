CREATE TABLE IF NOT EXISTS "ConnectorSubscription" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectorId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "identity" TEXT NOT NULL DEFAULT 'bot',
  "params" TEXT NOT NULL DEFAULT '{}',
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "lastError" TEXT,
  "leaseOwner" TEXT,
  "leaseUntil" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("connectorId") REFERENCES "PersonalConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectorSubscription_target_key" ON "ConnectorSubscription"("connectorId", "scope", "scopeId", "eventKey");
CREATE TABLE IF NOT EXISTS "ConnectorInboxEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "subscriptionId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "payloadCiphertext" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("subscriptionId") REFERENCES "ConnectorSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectorInboxEvent_source_key" ON "ConnectorInboxEvent"("subscriptionId", "sourceKey");
