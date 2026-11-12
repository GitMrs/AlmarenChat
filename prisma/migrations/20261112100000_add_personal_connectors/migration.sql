CREATE TABLE IF NOT EXISTS "PersonalConnector" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "toolId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "catalogId" TEXT,
  "headersCiphertext" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PersonalConnector_userId_toolId_key" ON "PersonalConnector"("userId", "toolId");
CREATE UNIQUE INDEX IF NOT EXISTS "PersonalConnector_userId_catalogId_key" ON "PersonalConnector"("userId", "catalogId");
CREATE TABLE IF NOT EXISTS "ConnectorBinding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectorId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("connectorId") REFERENCES "PersonalConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectorBinding_userId_scope_scopeId_connectorId_key" ON "ConnectorBinding"("userId", "scope", "scopeId", "connectorId");
