ALTER TABLE "Space" ADD COLUMN "cryptoAutonomyEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SpaceFollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "runAt" DATETIME NOT NULL,
    "nextAttemptAt" DATETIME NOT NULL,
    "networkAllowed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" DATETIME,
    "claimToken" TEXT,
    "error" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaceFollowUp_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SpaceFollowUp_sourceKey_key" ON "SpaceFollowUp"("sourceKey");
CREATE INDEX "SpaceFollowUp_status_nextAttemptAt_idx" ON "SpaceFollowUp"("status", "nextAttemptAt");
CREATE INDEX "SpaceFollowUp_spaceId_status_runAt_idx" ON "SpaceFollowUp"("spaceId", "status", "runAt");
