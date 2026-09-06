CREATE TABLE "SpaceWork" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SpaceWork_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "AgentRun" ADD COLUMN "workId" TEXT REFERENCES "SpaceWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SpaceFile" ADD COLUMN "workId" TEXT REFERENCES "SpaceWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SpaceWork_spaceId_updatedAt_idx" ON "SpaceWork"("spaceId", "updatedAt");
CREATE INDEX "AgentRun_workId_createdAt_idx" ON "AgentRun"("workId", "createdAt");
CREATE INDEX "SpaceFile_workId_idx" ON "SpaceFile"("workId");
