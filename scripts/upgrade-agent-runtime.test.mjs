import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { inspectPrismaBaseline } from './upgrade-agent-runtime.mjs';

function baselineDatabase() {
  const db = new Database(':memory:');
  for (const table of ['Agent', 'AgentRun', 'SpaceWebhook', 'SpaceMcpServer', 'StudioWorkspace']) {
    db.exec(`CREATE TABLE "${table}" ("id" TEXT PRIMARY KEY)`);
  }
  db.exec('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "imageModelEnabled" INTEGER, "imageModelProtocol" TEXT, "modelContextWindow" INTEGER)');
  db.exec('CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "runtimeType" TEXT, "executionEngine" TEXT, "activeWorkId" TEXT)');
  db.exec('CREATE TABLE "SpaceAutomation" ("id" TEXT PRIMARY KEY, "executionMode" TEXT, "scriptPath" TEXT, "completionAction" TEXT, "deletedAt" TEXT)');
  return db;
}

test('an empty database is left for migrate deploy', () => {
  const db = new Database(':memory:');
  try {
    assert.deepEqual(inspectPrismaBaseline(db), { action: 'none', reason: 'empty-database' });
  } finally {
    db.close();
  }
});

test('an existing migration table prevents repeated baselining', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY)');
    assert.deepEqual(inspectPrismaBaseline(db), { action: 'none', reason: 'migration-history-exists' });
  } finally {
    db.close();
  }
});

test('a compatible legacy database can be baselined', () => {
  const db = baselineDatabase();
  try {
    assert.deepEqual(inspectPrismaBaseline(db), { action: 'baseline', reason: 'existing-database-without-history' });
  } finally {
    db.close();
  }
});

test('an incomplete legacy database stops instead of hiding missing migrations', () => {
  const db = baselineDatabase();
  try {
    db.exec('DROP TABLE "SpaceWebhook"');
    assert.throws(() => inspectPrismaBaseline(db), /table:SpaceWebhook/);
  } finally {
    db.close();
  }
});
