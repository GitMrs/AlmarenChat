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
  const conversationColumns = db.prepare('PRAGMA table_info("Conversation")').all();
  const messageColumns = db.prepare('PRAGMA table_info("Message")').all();
  const experienceTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'AssistantExperience'").get();
  const experienceIndex = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'AssistantExperience_conversationId_endAt_idx'").get();
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
  assert.ok(conversationColumns.some((item) => item.name === 'assistantMode'));
  if (messageColumns.length) assert.ok(messageColumns.some((item) => item.name === 'source'));
  if (messageColumns.length) assert.ok(messageColumns.some((item) => item.name === 'assistantExperienceId'));
  assert.equal(experienceTable?.name, 'AssistantExperience');
  assert.equal(experienceIndex?.name, 'AssistantExperience_conversationId_endAt_idx');
}

test('conversation memory extraction is scoped to the authenticated user', async () => {
  const source = await readFile(
    path.join(projectRoot, 'app/api/assistant/memories/extract/route.ts'),
    'utf8'
  );

  assert.match(source, /where:\s*\{ id: conversationId, userId, kind: 'PERSONAL_ASSISTANT', assistantMode: 'MAIN' \}/);
  assert.match(source, /if \(!conversation\) return NextResponse\.json\(\{ error: '会话不存在' \}, \{ status: 404 \}\)/);
});

test('assistant migrations upgrade the previous personal assistant schema', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'assistant-migration-'));
  const databasePath = path.join(tempRoot, 'migration.db');
  const db = new Database(databasePath);
  try {
    db.exec(`
      CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY);
      CREATE TABLE "Conversation" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "kind" TEXT NOT NULL DEFAULT 'AGENT',
        "title" TEXT,
        "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "Message" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "conversationId" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL
      );
      CREATE TABLE "PersonalAssistantProfile" (
        "userId" TEXT NOT NULL PRIMARY KEY,
        "conversationId" TEXT NOT NULL,
        "name" TEXT NOT NULL DEFAULT '小伴',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );
      INSERT INTO "User" ("id") VALUES ('user-1');
      INSERT INTO "Conversation" ("id", "userId", "kind", "title", "updatedAt")
      VALUES ('web-main', 'user-1', 'PERSONAL_ASSISTANT', '我的助理', CURRENT_TIMESTAMP),
             ('old-qq', 'user-1', 'PERSONAL_ASSISTANT', 'QQ 小伴', CURRENT_TIMESTAMP);
      INSERT INTO "Message" ("id", "conversationId", "role", "content", "createdAt")
      VALUES ('qq-message', 'old-qq', 'user', 'QQ旧消息', CURRENT_TIMESTAMP);
      INSERT INTO "PersonalAssistantProfile" ("userId", "conversationId", "updatedAt")
      VALUES ('user-1', 'web-main', CURRENT_TIMESTAMP);
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
    db.prepare(`
      INSERT INTO "AssistantQQBinding"
      ("userId", "conversationId", "appId", "appSecretCiphertext", "updatedAt")
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run('user-1', 'old-qq', 'app-1', 'secret');
    const mainChatMigration = await readFile(
      path.join(projectRoot, 'prisma/migrations/20260905090000_add_assistant_main_and_temporary_chats/migration.sql'),
      'utf8'
    );
    db.exec(mainChatMigration);
    const experienceMigration = await readFile(
      path.join(projectRoot, 'prisma/migrations/20260905120000_add_assistant_experiences/migration.sql'),
      'utf8'
    );
    db.exec(experienceMigration);
    assertCurrentAssistantSchema(db);
    assert.equal(db.prepare('SELECT "assistantMode" FROM "Conversation" WHERE "id" = ?').get('web-main').assistantMode, 'MAIN');
    assert.equal(db.prepare('SELECT "assistantMode" FROM "Conversation" WHERE "id" = ?').get('old-qq').assistantMode, 'TEMPORARY');
    assert.equal(db.prepare('SELECT "conversationId" FROM "AssistantQQBinding" WHERE "userId" = ?').get('user-1').conversationId, 'web-main');
    assert.equal(db.prepare('SELECT "source" FROM "Message" WHERE "id" = ?').get('qq-message').source, 'QQ');
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
