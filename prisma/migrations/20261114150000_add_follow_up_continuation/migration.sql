ALTER TABLE "SpaceFollowUp" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'USER_REQUEST';
ALTER TABLE "SpaceFollowUp" ADD COLUMN "parentId" TEXT;
ALTER TABLE "SpaceFollowUp" ADD COLUMN "chainDepth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SpaceFollowUp" ADD COLUMN "chainEndsAt" DATETIME;
ALTER TABLE "SpaceFollowUp" ADD COLUMN "reason" TEXT;
CREATE UNIQUE INDEX "SpaceFollowUp_parentId_key" ON "SpaceFollowUp"("parentId");
