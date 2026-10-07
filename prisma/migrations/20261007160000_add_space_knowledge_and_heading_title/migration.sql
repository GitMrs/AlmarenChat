-- RedefineTables
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_KnowledgeDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT,
    "spaceId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeDocument_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDocument_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_KnowledgeDocument" ("id", "agentId", "fileName", "mimeType", "size", "createdAt")
SELECT "id", "agentId", "fileName", "mimeType", "size", "createdAt" FROM "KnowledgeDocument";

DROP TABLE "KnowledgeDocument";
ALTER TABLE "new_KnowledgeDocument" RENAME TO "KnowledgeDocument";

CREATE INDEX "KnowledgeDocument_agentId_idx" ON "KnowledgeDocument"("agentId");
CREATE INDEX "KnowledgeDocument_spaceId_idx" ON "KnowledgeDocument"("spaceId");

CREATE TABLE "new_KnowledgeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "agentId" TEXT,
    "spaceId" TEXT,
    "chunkIndex" INTEGER NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_KnowledgeChunk" ("id", "documentId", "agentId", "chunkIndex", "content", "embedding", "createdAt")
SELECT "id", "documentId", "agentId", "chunkIndex", "content", "embedding", "createdAt" FROM "KnowledgeChunk";

DROP TABLE "KnowledgeChunk";
ALTER TABLE "new_KnowledgeChunk" RENAME TO "KnowledgeChunk";

CREATE INDEX "KnowledgeChunk_agentId_idx" ON "KnowledgeChunk"("agentId");
CREATE INDEX "KnowledgeChunk_spaceId_idx" ON "KnowledgeChunk"("spaceId");
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk"("documentId");

PRAGMA foreign_keys=ON;
