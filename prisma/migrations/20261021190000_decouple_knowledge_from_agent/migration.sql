-- 知识库与 Agent 表解耦：agentId 不再作为外键，新增 userId 作为知识归属
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_KnowledgeDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "agentId" TEXT,
    "spaceId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" TEXT NOT NULL DEFAULT 'USER_UPLOAD',
    "sourceKey" TEXT,
    "sourceUrl" TEXT,
    "summary" TEXT,
    "tags" JSON,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "KnowledgeDocument_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_KnowledgeDocument" (
    "id", "agentId", "spaceId", "fileName", "mimeType", "size", "createdAt",
    "sourceType", "sourceKey", "sourceUrl", "summary", "tags", "status"
)
SELECT
    "id", "agentId", "spaceId", "fileName", "mimeType", "size", "createdAt",
    "sourceType", "sourceKey", "sourceUrl", "summary", "tags", "status"
FROM "KnowledgeDocument";

DROP TABLE "KnowledgeDocument";
ALTER TABLE "new_KnowledgeDocument" RENAME TO "KnowledgeDocument";

CREATE INDEX "KnowledgeDocument_agentId_idx" ON "KnowledgeDocument"("agentId");
CREATE INDEX "KnowledgeDocument_spaceId_idx" ON "KnowledgeDocument"("spaceId");
CREATE INDEX "KnowledgeDocument_sourceKey_idx" ON "KnowledgeDocument"("sourceKey");
CREATE INDEX "KnowledgeDocument_userId_agentId_idx" ON "KnowledgeDocument"("userId", "agentId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
