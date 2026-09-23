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
    db.exec('CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "started_at" DATETIME, "finished_at" DATETIME, "rolled_back_at" DATETIME)');
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
    db.exec('CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "started_at" DATETIME, "finished_at" DATETIME, "rolled_back_at" DATETIME)');
    const result = inspectKnownMigrationRepair(db);
    assert.equal(result.action, 'manual');
    assert.deepEqual(result.missing, ['column:User.imageModelEnabled']);
  } finally {
    db.close();
  }
});

test('detects a personal assistant migration whose full schema already exists', () => {
  const db = baselineDatabase();
  try {
    db.exec(`
      CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "started_at" DATETIME, "finished_at" DATETIME, "rolled_back_at" DATETIME);
      CREATE TABLE "Conversation" ("id" TEXT PRIMARY KEY, "userId" TEXT, "kind" TEXT, "updatedAt" TEXT);
      CREATE TABLE "PersonalAssistantProfile" ("userId" TEXT, "conversationId" TEXT, "name" TEXT, "avatar" TEXT, "identity" TEXT, "soul" TEXT, "greeting" TEXT, "createdAt" TEXT, "updatedAt" TEXT);
      CREATE TABLE "AssistantMemoryItem" ("id" TEXT, "userId" TEXT, "category" TEXT, "content" TEXT, "status" TEXT, "sourceMessageId" TEXT, "occurrenceCount" INTEGER, "createdAt" TEXT, "updatedAt" TEXT);
      CREATE INDEX "Conversation_userId_kind_updatedAt_idx" ON "Conversation"("userId", "kind", "updatedAt");
      CREATE UNIQUE INDEX "PersonalAssistantProfile_conversationId_key" ON "PersonalAssistantProfile"("conversationId");
      CREATE INDEX "AssistantMemoryItem_userId_status_updatedAt_idx" ON "AssistantMemoryItem"("userId", "status", "updatedAt");
    `);
    db.prepare('INSERT INTO "_prisma_migrations" ("migration_name", "finished_at", "rolled_back_at") VALUES (?, ?, NULL)')
      .run('20260902150000_add_image_model_settings', '2026-09-02T15:00:00.000Z');
    assert.deepEqual(inspectKnownMigrationRepair(db), {
      action: 'resolve',
      migration: '20260902183000_add_personal_assistant',
      reason: 'schema-present-without-migration-history',
    });
  } finally {
    db.close();
  }
});

test('detects a proactive reminders migration whose full schema already exists', () => {
  const db = baselineDatabase();
  try {
    db.exec(`
      CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "started_at" DATETIME, "finished_at" DATETIME, "rolled_back_at" DATETIME);
      CREATE TABLE "PersonalAssistantProfile" ("userId" TEXT, "conversationId" TEXT, "proactiveEnabled" INTEGER);
      CREATE TABLE "AssistantReminder" ("id" TEXT, "userId" TEXT, "content" TEXT, "dueTime" TEXT, "status" TEXT, "sourceMessageId" TEXT, "createdAt" TEXT, "updatedAt" TEXT);
      CREATE TABLE "AssistantProactiveDelivery" ("id" TEXT, "userId" TEXT, "sourceKey" TEXT, "greeting" TEXT, "status" TEXT, "messageId" TEXT, "createdAt" TEXT, "openedAt" TEXT);
      CREATE INDEX "AssistantReminder_userId_status_dueTime_idx" ON "AssistantReminder"("userId", "status", "dueTime");
      CREATE UNIQUE INDEX "AssistantProactiveDelivery_userId_sourceKey_key" ON "AssistantProactiveDelivery"("userId", "sourceKey");
      CREATE INDEX "AssistantProactiveDelivery_userId_createdAt_idx" ON "AssistantProactiveDelivery"("userId", "createdAt");
    `);
    db.prepare('INSERT INTO "_prisma_migrations" ("migration_name", "started_at", "finished_at", "rolled_back_at") VALUES (?, ?, ?, NULL)')
      .run('20260902150000_add_image_model_settings', '2026-09-02T15:00:00.000Z', '2026-09-02T15:00:01.000Z');
    db.prepare('INSERT INTO "_prisma_migrations" ("migration_name", "started_at", "finished_at", "rolled_back_at") VALUES (?, ?, ?, NULL)')
      .run('20260902183000_add_personal_assistant', '2026-09-02T18:30:00.000Z', '2026-09-02T18:30:01.000Z');
    assert.deepEqual(inspectKnownMigrationRepair(db), {
      action: 'resolve',
      migration: '20260903170000_add_assistant_proactive_reminders',
      reason: 'schema-present-without-migration-history',
    });
  } finally {
    db.close();
  }
});

test('detects an external dependencies migration whose column already exists', () => {
  const db = baselineDatabase();
  try {
    db.exec(`
      CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "started_at" DATETIME, "finished_at" DATETIME, "rolled_back_at" DATETIME);
      CREATE TABLE "SpaceFile" ("id" TEXT, "externalDependencies" INTEGER);
    `);
    for (const migration of [
      '20260902150000_add_image_model_settings',
      '20260902183000_add_personal_assistant',
      '20260903170000_add_assistant_proactive_reminders',
    ]) {
      db.prepare('INSERT INTO "_prisma_migrations" ("migration_name", "started_at", "finished_at", "rolled_back_at") VALUES (?, ?, ?, NULL)')
        .run(migration, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:01.000Z');
    }
    assert.deepEqual(inspectKnownMigrationRepair(db), {
      action: 'resolve',
      migration: '20260904120000_add_space_file_external_dependencies',
      reason: 'schema-present-without-migration-history',
    });
  } finally {
    db.close();
  }
});

test('detects a reminder idempotency migration whose schema already exists', () => {
  const db = baselineDatabase();
  try {
    db.exec(`
      CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "started_at" DATETIME, "finished_at" DATETIME, "rolled_back_at" DATETIME);
      CREATE TABLE "AssistantReminder" ("id" TEXT, "userId" TEXT, "idempotencyKey" TEXT);
      CREATE UNIQUE INDEX "AssistantReminder_userId_idempotencyKey_key" ON "AssistantReminder"("userId", "idempotencyKey");
    `);
    for (const migration of [
      '20260902150000_add_image_model_settings',
      '20260902183000_add_personal_assistant',
      '20260903170000_add_assistant_proactive_reminders',
      '20260904120000_add_space_file_external_dependencies',
    ]) {
      db.prepare('INSERT INTO "_prisma_migrations" ("migration_name", "started_at", "finished_at", "rolled_back_at") VALUES (?, ?, ?, NULL)')
        .run(migration, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:01.000Z');
    }
    assert.deepEqual(inspectKnownMigrationRepair(db), {
      action: 'resolve',
      migration: '20260904150000_add_assistant_reminder_idempotency',
      reason: 'schema-present-without-migration-history',
    });
  } finally {
    db.close();
  }
});

test('detects an assistant context preferences migration whose columns already exist', () => {
  const db = baselineDatabase();
  try {
    db.exec(`
      CREATE TABLE "_prisma_migrations" ("migration_name" TEXT, "started_at" DATETIME, "finished_at" DATETIME, "rolled_back_at" DATETIME);
      CREATE TABLE "PersonalAssistantProfile" ("userId" TEXT, "includeSpaceContext" INTEGER, "includeTaskContext" INTEGER, "includeChatContext" INTEGER);
    `);
    for (const migration of [
      '20260902150000_add_image_model_settings',
      '20260902183000_add_personal_assistant',
      '20260903170000_add_assistant_proactive_reminders',
      '20260904120000_add_space_file_external_dependencies',
      '20260904150000_add_assistant_reminder_idempotency',
    ]) {
      db.prepare('INSERT INTO "_prisma_migrations" ("migration_name", "started_at", "finished_at", "rolled_back_at") VALUES (?, ?, ?, NULL)')
        .run(migration, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:01.000Z');
    }
    assert.deepEqual(inspectKnownMigrationRepair(db), {
      action: 'resolve',
      migration: '20260904170000_add_assistant_context_preferences',
      reason: 'schema-present-without-migration-history',
    });
  } finally {
    db.close();
  }
});
