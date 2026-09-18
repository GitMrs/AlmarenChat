CREATE TABLE "SpaceWebhook" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "bodyTemplate" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastError" TEXT,
  "lastUsedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SpaceWebhook_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SpaceWebhook_spaceId_name_key" ON "SpaceWebhook"("spaceId", "name");
CREATE INDEX "SpaceWebhook_spaceId_enabled_idx" ON "SpaceWebhook"("spaceId", "enabled");
