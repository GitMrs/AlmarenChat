const Database = require('better-sqlite3');
const db = new Database('data/dev.db');

db.exec(`
CREATE TABLE IF NOT EXISTS KnowledgeDocument (
  id TEXT PRIMARY KEY NOT NULL,
  agentId TEXT NOT NULL,
  fileName TEXT NOT NULL,
  mimeType TEXT,
  size INTEGER,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT KnowledgeDocument_agentId_fkey
    FOREIGN KEY (agentId) REFERENCES Agent(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS KnowledgeChunk (
  id TEXT PRIMARY KEY NOT NULL,
  documentId TEXT NOT NULL,
  agentId TEXT NOT NULL,
  chunkIndex INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding JSONB NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT KnowledgeChunk_documentId_fkey
    FOREIGN KEY (documentId) REFERENCES KnowledgeDocument(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS KnowledgeDocument_agentId_idx ON KnowledgeDocument(agentId);
CREATE INDEX IF NOT EXISTS KnowledgeChunk_agentId_idx ON KnowledgeChunk(agentId);
CREATE INDEX IF NOT EXISTS KnowledgeChunk_documentId_idx ON KnowledgeChunk(documentId);
`);

console.log('knowledge tables ready');