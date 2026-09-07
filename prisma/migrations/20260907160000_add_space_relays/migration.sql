CREATE TABLE "SpaceRelay" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "participantIds" JSONB NOT NULL,
  "approvalMode" TEXT NOT NULL DEFAULT 'AUTO',
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "currentIndex" INTEGER NOT NULL DEFAULT 0,
  "turnCount" INTEGER NOT NULL DEFAULT 0,
  "maxTurns" INTEGER NOT NULL DEFAULT 60,
  "state" JSONB NOT NULL,
  "transcript" JSONB,
  "pendingAction" JSONB,
  "result" TEXT,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "startedAt" DATETIME,
  "completedAt" DATETIME,
  CONSTRAINT "SpaceRelay_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpaceRelay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SpaceRelay_spaceId_createdAt_idx" ON "SpaceRelay"("spaceId", "createdAt");
CREATE INDEX "SpaceRelay_userId_createdAt_idx" ON "SpaceRelay"("userId", "createdAt");
CREATE INDEX "SpaceRelay_status_createdAt_idx" ON "SpaceRelay"("status", "createdAt");
