import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { inspectKnownMigrationRepair, inspectPrismaBaseline } from './upgrade-agent-runtime.mjs';

function baselineDatabase() {
  const db = new Database(':memory:');
  for (const table of ['Agent', 'AgentRun', 'SpaceWebhook', 'SpaceMcpServer', 'StudioWorkspace']) {
    db.exec(`CREATE TABLE "${table}" ("id" TEXT PRIMARY KEY)`);
  }
  db.exec('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "imageModelEnabled" INTEGER, "imageModelName" TEXT, "imageModelSize" TEXT, "imageModelProtocol" TEXT, "modelContextWindow" INTEGER)');
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

test('detects an image settings migration whose columns already exist', () => {
  const db = baselineDatabase();
  try {
    db.exec('CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "finished_at" DATETIME, "rolled_back_at" DATETIME)');
    assert.deepEqual(inspectKnownMigrationRepair(db), {
      action: 'resolve',
      migration: '20260902150000_add_image_model_settings',
      reason: 'schema-present-without-migration-history',
    });
  } finally {
    db.close();
  }
});

test('does not skip an image settings migration when a column is missing', () => {
  const db = baselineDatabase();
  try {
    db.exec('ALTER TABLE "User" RENAME COLUMN "imageModelEnabled" TO "oldImageModelEnabled"');
    db.exec('CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "finished_at" DATETIME, "rolled_back_at" DATETIME)');
    const result = inspectKnownMigrationRepair(db);
    assert.equal(result.action, 'manual');
    assert.deepEqual(result.missing, ['imageModelEnabled']);
  } finally {
    db.close();
  }
});
