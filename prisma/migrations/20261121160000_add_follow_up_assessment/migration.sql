ALTER TABLE "SpaceFollowUp" ADD COLUMN "rootPrompt" TEXT;
ALTER TABLE "SpaceFollowUpReport" ADD COLUMN "assessment" JSONB;
WITH RECURSIVE roots(id, original) AS (
  SELECT "id", "prompt" FROM "SpaceFollowUp" WHERE "parentId" IS NULL
  UNION ALL
  SELECT child."id", roots.original FROM "SpaceFollowUp" child JOIN roots ON child."parentId" = roots.id
)
UPDATE "SpaceFollowUp" SET "rootPrompt" = (SELECT original FROM roots WHERE roots.id = "SpaceFollowUp"."id");
UPDATE "SpaceFollowUp" SET "rootPrompt" = "prompt" WHERE "rootPrompt" IS NULL;
