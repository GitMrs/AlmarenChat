ALTER TABLE "SpaceFollowUp" ADD COLUMN "domain" TEXT NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "SpaceFollowUp" ADD COLUMN "sourceMessageId" TEXT;
ALTER TABLE "SpaceFollowUp" ADD COLUMN "workId" TEXT REFERENCES "SpaceWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SpaceFollowUp" ADD COLUMN "workTitle" TEXT;
CREATE INDEX "SpaceFollowUp_spaceId_workId_runAt_idx" ON "SpaceFollowUp"("spaceId", "workId", "runAt");

UPDATE "SpaceFollowUp" SET "domain" = 'CRYPTO'
WHERE "spaceId" IN (SELECT "id" FROM "Space" WHERE "templateId" = 'crypto-contract-trading');

CREATE TABLE "SpaceFollowUpReport" (
  "taskId" TEXT NOT NULL PRIMARY KEY,
  "summary" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpaceFollowUpReport_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "SpaceFollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "SpaceFollowUpReport" ("taskId", "summary", "content", "createdAt")
SELECT f."id", substr(m."content", 1, 240), m."content", m."createdAt"
FROM "SpaceFollowUp" f JOIN "SpaceMessage" m ON m."spaceId" = f."spaceId" AND m."sourceKey" = 'space-follow-up:' || f."id";
