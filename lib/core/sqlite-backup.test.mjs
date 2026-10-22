import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { backupSqliteDatabase, resolveSqliteDatabasePath } from './sqlite-backup.mjs';

test('SQLite backup resolves file URLs and preserves committed WAL data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'almaren-db-backup-'));
  const databasePath = path.join(directory, 'data', 'dev.db');
  await mkdir(path.dirname(databasePath), { recursive: true });
  const source = new Database(databasePath);
  try {
    source.pragma('journal_mode = WAL');
    source.exec('CREATE TABLE Item (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    source.prepare('INSERT INTO Item VALUES (?, ?)').run('item-1', 'before-upgrade');
    const result = await backupSqliteDatabase({
      databaseUrl: 'file:./data/dev.db',
      cwd: directory,
      now: () => new Date('2026-09-09T12:34:56.789Z'),
    });
    assert.equal(result.skipped, false);
    assert.equal(resolveSqliteDatabasePath('file:./data/dev.db?connection_limit=1', directory), databasePath);
    const backup = new Database(result.backupPath, { readonly: true });
    try {
      assert.deepEqual(backup.prepare('SELECT * FROM Item').get(), { id: 'item-1', value: 'before-upgrade' });
    } finally {
      backup.close();
    }
  } finally {
    source.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('SQLite backup skips a database that has not been created yet', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'almaren-db-backup-empty-'));
  try {
    const result = await backupSqliteDatabase({ databaseUrl: 'file:./data/dev.db', cwd: directory });
    assert.equal(result.skipped, true);
    assert.equal(result.backupPath, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
