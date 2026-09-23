import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { encryptQQCredential } from '../../lib/qq-assistant/credentials.mjs';
import { renderWebhookTemplate } from '../../lib/webhook-template.mjs';
import { notifyWebhookCompletion, qqNotificationText } from './qq-webhook.mjs';

const payload = {
  event: 'space.automation.completed',
  content: { title: '每日速报', text: '今天有 3 条内容', markdown: '**每日速报**' },
  run: { status: 'COMPLETED' },
};

test('webhook JSON templates replace nested values without executing code', () => {
  assert.deepEqual(renderWebhookTemplate({
    msg_type: 'text',
    content: { text: '{{content.title}}\n{{content.text}}', status: '{{run.status}}' },
  }, payload), {
    msg_type: 'text',
    content: { text: '每日速报\n今天有 3 条内容', status: 'COMPLETED' },
  });
});

test('webhook templates keep exact object values as JSON values', () => {
  assert.deepEqual(renderWebhookTemplate({ raw: '{{content}}', missing: '{{content.unknown}}' }, payload), {
    raw: payload.content,
    missing: '',
  });
});

test('QQ notification keeps one compact message and appends the full report link', () => {
  const result = qqNotificationText('# 每日简报\n\n' + '较长内容。'.repeat(500), 'https://chat.example.com/share/abc/');
  assert.ok(result.length <= 1_800);
  assert.match(result, /^每日简报/);
  assert.match(result, /完整简报：https:\/\/chat\.example\.com\/share\/abc\/$/);
});

function notificationDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "userId" TEXT);
    CREATE TABLE "SpaceAutomation" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "name" TEXT,
      "completionAction" TEXT, "completionConfig" TEXT, "shareTheme" TEXT DEFAULT 'inherit'
    );
    CREATE TABLE "SpaceAutomationExecution" (
      "id" TEXT PRIMARY KEY, "automationId" TEXT, "runId" TEXT,
      "workId" TEXT, "scheduledFor" TEXT, "result" TEXT
    );
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "result" TEXT, "completedAt" TEXT
    );
    CREATE TABLE "SpaceWebhook" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "url" TEXT,
      "bodyTemplate" TEXT, "enabled" INTEGER, "lastUsedAt" TEXT, "lastError" TEXT
    );
    CREATE TABLE "SpaceFile" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "fileName" TEXT, "mimeType" TEXT,
      "relativePath" TEXT, "size" INTEGER, "runId" TEXT, "workId" TEXT,
      "status" TEXT, "shareId" TEXT, "shareEnabled" INTEGER DEFAULT 0,
      "shareTheme" TEXT DEFAULT 'clean',
      "sharedAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "AssistantQQBinding" (
      "userId" TEXT PRIMARY KEY, "webhookTokenCiphertext" TEXT,
      "enabled" INTEGER, "qqOpenId" TEXT
    );
  `);
  db.prepare('INSERT INTO "Space" VALUES (?, ?)').run('space-1', 'user-1');
  db.prepare('INSERT INTO "SpaceAutomation" VALUES (?, ?, ?, ?, ?, ?)').run(
    'automation-1',
    'space-1',
    '每日速报',
    'WEBHOOK_NOTIFY',
    JSON.stringify({ target: 'CUSTOM_WEBHOOK', webhookId: 'webhook-1' }),
    'inherit'
  );
  db.prepare('INSERT INTO "SpaceWebhook" VALUES (?, ?, ?, ?, ?, NULL, NULL)').run(
    'webhook-1',
    'space-1',
    'https://hooks.example.com/notify',
    JSON.stringify({ text: '{{content.text}}', execution: '{{idempotencyKey}}' }),
    1
  );
  return db;
}

test('direct script execution can send a webhook without an AgentRun', async () => {
  const db = notificationDatabase();
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return { ok: true };
  };
  try {
    db.prepare('INSERT INTO "SpaceAutomationExecution" ("id", "automationId", "runId", "scheduledFor") VALUES (?, ?, NULL, ?)').run(
      'execution-1',
      'automation-1',
      '2026-09-22T01:00:00.000Z'
    );
    const notification = await notifyWebhookCompletion(db, {
      executionId: 'execution-1',
      status: 'COMPLETED',
      result: '脚本已处理 10 条数据',
    });
    assert.equal(notification.sent, true);
    assert.equal(request.url, 'https://hooks.example.com/notify');
    assert.deepEqual(JSON.parse(request.options.body), {
      text: '脚本已处理 10 条数据',
      execution: 'space-automation:space-1:execution-1:webhook',
    });
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test('model-backed automation sends its primary text artifact instead of the completion summary', async () => {
  const db = notificationDatabase();
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-notification-'));
  const relativePath = 'workspace/works/work-1/daily-report.md';
  const target = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', relativePath);
  const originalFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true };
  };
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '# 完整日报\n\n1. 第一条内容', 'utf8');
    db.prepare('INSERT INTO "AgentRun" VALUES (?, ?, ?)').run(
      'run-artifact', '任务已完成', '2026-09-22T01:05:00.000Z'
    );
    db.prepare('INSERT INTO "SpaceAutomationExecution" ("id", "automationId", "runId", "workId", "scheduledFor", "result") VALUES (?, ?, ?, ?, ?, ?)').run(
      'execution-artifact', 'automation-1', 'run-artifact', 'work-1', '2026-09-22T01:00:00.000Z', '任务已完成'
    );
    db.prepare(`INSERT INTO "SpaceFile"
      ("id", "spaceId", "fileName", "mimeType", "relativePath", "size", "runId", "workId", "status", "createdAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'file-1', 'space-1', 'daily-report.md', 'text/markdown', relativePath, 30,
      'run-artifact', 'work-1', 'READY', '2026-09-22T01:04:00.000Z'
    );
    const notification = await notifyWebhookCompletion(db, {
      executionId: 'execution-artifact', status: 'COMPLETED', projectRoot,
    });
    assert.equal(notification.sent, true);
    assert.equal(body.text, '# 完整日报\n\n1. 第一条内容');
    assert.equal(body.execution, 'space-automation:space-1:execution-artifact:webhook');
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('personal QQ delivery uses notification.txt and shares the full Markdown artifact', async () => {
  const db = notificationDatabase();
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-qq-share-'));
  const reportPath = 'workspace/works/work-qq/daily-report.md';
  const noticePath = 'workspace/works/work-qq/notification.txt';
  const root = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1');
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.QQ_ASSISTANT_SECRET;
  const originalAppUrl = process.env.APP_URL;
  let body = null;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true };
  };
  process.env.QQ_ASSISTANT_SECRET = 'test-secret-that-is-at-least-32-characters';
  process.env.APP_URL = 'https://chat.example.com';
  try {
    await mkdir(path.dirname(path.join(root, reportPath)), { recursive: true });
    await writeFile(path.join(root, reportPath), '# 完整日报\n\n完整正文', 'utf8');
    await writeFile(path.join(root, noticePath), '今日重点\n\n1. 精简摘要', 'utf8');
    db.prepare('UPDATE "SpaceAutomation" SET "completionConfig" = ? WHERE "id" = ?').run(
      JSON.stringify({ target: 'PERSONAL_QQ' }), 'automation-1'
    );
    db.prepare('INSERT INTO "AssistantQQBinding" VALUES (?, ?, 1, ?)').run(
      'user-1', encryptQQCredential('webhook-token', process.env.QQ_ASSISTANT_SECRET), 'openid-1'
    );
    db.prepare('INSERT INTO "SpaceAutomationExecution" ("id", "automationId", "runId", "workId", "scheduledFor", "result") VALUES (?, ?, ?, ?, ?, ?)').run(
      'execution-qq', 'automation-1', 'run-qq', 'work-qq', '2026-09-22T01:00:00.000Z', '完成'
    );
    db.prepare(`INSERT INTO "SpaceFile"
      ("id", "spaceId", "fileName", "mimeType", "relativePath", "size", "runId", "workId", "status", "createdAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'READY', ?)`
    ).run('report-1', 'space-1', 'daily-report.md', 'text/markdown', reportPath, 100, 'run-qq', 'work-qq', '2026-09-22T01:01:00.000Z');
    db.prepare(`INSERT INTO "SpaceFile"
      ("id", "spaceId", "fileName", "mimeType", "relativePath", "size", "runId", "workId", "status", "createdAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'READY', ?)`
    ).run('notice-1', 'space-1', 'notification.txt', 'text/plain', noticePath, 20, 'run-qq', 'work-qq', '2026-09-22T01:02:00.000Z');

    const notification = await notifyWebhookCompletion(db, {
      executionId: 'execution-qq', status: 'COMPLETED', projectRoot,
    });
    assert.equal(notification.sent, true);
    assert.match(body.content.text, /^今日重点/);
    assert.match(body.content.text, /完整简报：https:\/\/chat\.example\.com\/share\/[a-f0-9]{32}\/$/);
    assert.doesNotMatch(body.content.text, /完整正文/);
    assert.equal(db.prepare('SELECT "shareEnabled" FROM "SpaceFile" WHERE "id" = ?').get('report-1').shareEnabled, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.QQ_ASSISTANT_SECRET;
    else process.env.QQ_ASSISTANT_SECRET = originalSecret;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    db.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('stored execution result survives a worker restart before delivery', async () => {
  const db = notificationDatabase();
  const originalFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true };
  };
  try {
    db.prepare('INSERT INTO "SpaceAutomationExecution" ("id", "automationId", "runId", "scheduledFor", "result") VALUES (?, ?, NULL, ?, ?)').run(
      'execution-restarted',
      'automation-1',
      '2026-09-22T01:00:00.000Z',
      '已持久化的推送内容'
    );
    const notification = await notifyWebhookCompletion(db, {
      executionId: 'execution-restarted',
      status: 'COMPLETED',
    });
    assert.equal(notification.sent, true);
    assert.equal(body.text, '已持久化的推送内容');
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test('model-backed automation still resolves notifications by runId', async () => {
  const db = notificationDatabase();
  const originalFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true };
  };
  try {
    db.prepare('INSERT INTO "AgentRun" VALUES (?, ?, ?)').run(
      'run-1',
      'AI 分析已完成',
      '2026-09-22T01:05:00.000Z'
    );
    db.prepare('INSERT INTO "SpaceAutomationExecution" ("id", "automationId", "runId", "scheduledFor") VALUES (?, ?, ?, ?)').run(
      'execution-2',
      'automation-1',
      'run-1',
      '2026-09-22T01:00:00.000Z'
    );
    const notification = await notifyWebhookCompletion(db, {
      runId: 'run-1',
      status: 'COMPLETED',
    });
    assert.equal(notification.sent, true);
    assert.equal(body.text, 'AI 分析已完成');
    assert.equal(body.execution, 'space-automation:space-1:execution-2:webhook');
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test('unsuccessful automation does not send a completion webhook', async () => {
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched = true;
    return { ok: true };
  };
  try {
    const notification = await notifyWebhookCompletion(null, {
      executionId: 'execution-1',
      status: 'FAILED_VALIDATION',
      result: '验收未通过',
    });
    assert.equal(notification.skipped, true);
    assert.match(notification.reason, /未成功完成/);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

