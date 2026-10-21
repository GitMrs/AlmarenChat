-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'USER_UPLOAD';
ALTER TABLE "KnowledgeDocument" ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "summary" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "tags" JSON;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "KnowledgeDocument_sourceKey_idx" ON "KnowledgeDocument"("sourceKey");
