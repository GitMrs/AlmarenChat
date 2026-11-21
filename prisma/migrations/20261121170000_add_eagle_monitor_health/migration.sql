ALTER TABLE "SpaceFollowUp" ADD COLUMN "watchHealth" JSONB;
CREATE TABLE "EagleRuntime" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "lastStartedAt" DATETIME,
  "lastFinishedAt" DATETIME,
  "lastSuccessAt" DATETIME,
  "lastErrorAt" DATETIME,
  "errorCode" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL
);
