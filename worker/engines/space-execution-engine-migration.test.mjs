import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('space engine migration preserves Native spaces and maps legacy Pi spaces', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "runtimeType" TEXT NOT NULL DEFAULT 'NATIVE')`);
    db.prepare(`INSERT INTO "Space" ("id", "runtimeType") VALUES (?, ?), (?, ?)`).run(
      'native-space', 'NATIVE', 'legacy-pi-space', 'PI_CODING'
    );
    const migration = await readFile(
      path.join(projectRoot, 'prisma/migrations/20260908220000_add_space_execution_engine/migration.sql'),
      'utf8'
    );

    db.exec(migration);

    assert.deepEqual(
      db.prepare(`SELECT "id", "executionEngine" FROM "Space" ORDER BY "id"`).all(),
      [
        { id: 'legacy-pi-space', executionEngine: 'pi' },
        { id: 'native-space', executionEngine: 'native' },
      ]
    );
  } finally {
    db.close();
  }
});
