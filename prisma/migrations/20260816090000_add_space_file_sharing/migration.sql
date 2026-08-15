ALTER TABLE "SpaceFile" ADD COLUMN "shareId" TEXT;
ALTER TABLE "SpaceFile" ADD COLUMN "shareEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SpaceFile" ADD COLUMN "sharedAt" DATETIME;

CREATE UNIQUE INDEX "SpaceFile_shareId_key" ON "SpaceFile"("shareId");
