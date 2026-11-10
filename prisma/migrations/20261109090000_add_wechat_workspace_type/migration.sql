ALTER TABLE "Space" ADD COLUMN "workspaceType" TEXT NOT NULL DEFAULT 'GENERAL';
UPDATE "Space" SET "workspaceType" = 'WECHAT' WHERE "templateId" = 'wechat-article';
