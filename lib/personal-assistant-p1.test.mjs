import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

function assertAssistantSchema(db) {
  const profileColumns = db.prepare('PRAGMA table_info("PersonalAssistantProfile")').all();
  const reminderTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'AssistantReminder'").get();
  const reminderIndex = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'AssistantReminder_userId_status_dueTime_idx'").get();
  const deliveryTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'AssistantProactiveDelivery'").get();
  const deliveryIndex = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'AssistantProactiveDelivery_userId_sourceKey_key'").get();

  assert.ok(profileColumns.some((column) => column.name === 'proactiveEnabled'));
  assert.equal(reminderTable?.name, 'AssistantReminder');
  assert.equal(reminderIndex?.name, 'AssistantReminder_userId_status_dueTime_idx');
  assert.equal(deliveryTable?.name, 'AssistantProactiveDelivery');
  assert.equal(deliveryIndex?.name, 'AssistantProactiveDelivery_userId_sourceKey_key');
}

function assertCurrentAssistantSchema(db) {
  assertAssistantSchema(db);
  const profileColumns = db.prepare('PRAGMA table_info("PersonalAssistantProfile")').all();
  const reminderColumns = db.prepare('PRAGMA table_info("AssistantReminder")').all();
  const deliveryColumns = db.prepare('PRAGMA table_info("AssistantProactiveDelivery")').all();
  const qqBindingColumns = db.prepare('PRAGMA table_info("AssistantQQBinding")').all();
  const reminderIdempotencyIndex = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'AssistantReminder_userId_idempotencyKey_key'").get();
  const deliveryActiveIndex = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'AssistantProactiveDelivery_userId_activeKey_key'").get();

  for (const column of ['includeSpaceContext', 'includeTaskContext', 'includeChatContext']) {
    assert.ok(profileColumns.some((item) => item.name === column));
  }
  assert.ok(reminderColumns.some((item) => item.name === 'idempotencyKey'));
  assert.ok(deliveryColumns.some((item) => item.name === 'activeKey'));
  for (const column of ['qqDeliveredAt', 'qqMessageId', 'qqDeliveryAttempts', 'qqNextAttemptAt', 'qqDeliveryError']) {
    assert.ok(reminderColumns.some((item) => item.name === column));
  }
  for (const column of ['appId', 'appSecretCiphertext', 'qqOpenId', 'conversationId']) {
    assert.ok(qqBindingColumns.some((item) => item.name === column));
  }
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'AssistantQQEvent'").get()?.name, 'AssistantQQEvent');
  assert.equal(reminderIdempotencyIndex?.name, 'AssistantReminder_userId_idempotencyKey_key');
  assert.equal(deliveryActiveIndex?.name, 'AssistantProactiveDelivery_userId_activeKey_key');
}

test('conversation memory extraction is scoped to the authenticated user', async () => {
  const source = await readFile(
    path.join(projectRoot, 'app/api/assistant/memories/extract/route.ts'),
    'utf8'
  );

  assert.match(source, /where:\s*\{ id: conversationId, userId, kind: 'PERSONAL_ASSISTANT' \}/);
  assert.match(source, /if \(!conversation\) return NextResponse\.json\(\{ error: '会话不存在' \}, \{ status: 404 \}\)/);
});

test('assistant migrations upgrade the previous personal assistant schema', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'assistant-migration-'));
  const databasePath = path.join(tempRoot, 'migration.db');
  const db = new Database(databasePath);
  try {
    db.exec(`
      CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "Conversation" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "PersonalAssistantProfile" (
        "userId" TEXT NOT NULL PRIMARY KEY,
        "conversationId" TEXT NOT NULL,
        "name" TEXT NOT NULL DEFAULT '小伴',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );
    `);
    for (const migrationName of [
      '20260903170000_add_assistant_proactive_reminders',
      '20260904150000_add_assistant_reminder_idempotency',
      '20260904170000_add_assistant_context_preferences',
      '20260904190000_add_assistant_proactive_active_key',
      '20260904210000_add_assistant_qq_binding',
    ]) {
      const migration = await readFile(path.join(projectRoot, 'prisma/migrations', migrationName, 'migration.sql'), 'utf8');
      db.exec(migration);
    }
    assertCurrentAssistantSchema(db);
  } finally {
    db.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('compatibility upgrade creates the assistant reminder schema', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'assistant-upgrade-'));
  const databasePath = path.join(tempRoot, 'upgrade.db');
  const db = new Database(databasePath);
  try {
    db.exec(`
      CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "Agent" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "Conversation" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "updatedAt" DATETIME NOT NULL
      );
    `);
  } finally {
    db.close();
  }

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await execFileAsync(process.execPath, ['scripts/upgrade-agent-runtime.mjs'], {
        cwd: projectRoot,
        env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      });
    }
    const upgraded = new Database(databasePath);
    try {
      assertCurrentAssistantSchema(upgraded);
    } finally {
      upgraded.close();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
