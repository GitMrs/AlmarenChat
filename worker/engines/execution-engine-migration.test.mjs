import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('execution engine migration pins existing runs to native version 1', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE "AgentRun" ("id" TEXT NOT NULL PRIMARY KEY, "status" TEXT NOT NULL)`);
    db.prepare(`INSERT INTO "AgentRun" ("id", "status") VALUES (?, ?)`).run('run-1', 'COMPLETED');
    const migration = await readFile(
      path.join(projectRoot, 'prisma/migrations/20260908210000_add_agent_execution_engine/migration.sql'),
      'utf8'
    );

    db.exec(migration);

    assert.deepEqual(db.prepare(`SELECT "executionEngine", "engineVersion" FROM "AgentRun" WHERE "id" = ?`).get('run-1'), {
      executionEngine: 'native',
      engineVersion: '1',
    });
  } finally {
    db.close();
  }
});
