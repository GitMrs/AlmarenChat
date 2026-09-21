import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { triggerNextDueAutomation } from './space-automation-runtime.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "Space" (
      "id" TEXT PRIMARY KEY, "userId" TEXT, "templateId" TEXT, "templateSnapshot" TEXT,
      "executionEngine" TEXT, "runtimeType" TEXT, "activeWorkId" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "SpaceMember" ("id" TEXT PRIMARY KEY, "spaceId" TEXT);
    CREATE TABLE "SpaceWork" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "title" TEXT, "kind" TEXT, "status" TEXT,
      "stage" TEXT, "objective" TEXT, "completedAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "SpaceAutomation" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "name" TEXT, "prompt" TEXT,
      "scheduleType" TEXT, "intervalMinutes" INTEGER, "workStrategy" TEXT,
      "networkPolicy" TEXT, "executionMode" TEXT DEFAULT 'PROMPT', "scriptPath" TEXT,
      "enabled" INTEGER, "nextRunAt" TEXT, "lastRunAt" TEXT,
      "lastRunId" TEXT, "lastError" TEXT, "deletedAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "SpaceAutomationExecution" (
      "id" TEXT PRIMARY KEY, "automationId" TEXT, "scheduledFor" TEXT, "status" TEXT,
      "runId" TEXT UNIQUE, "error" TEXT, "createdAt" TEXT, "updatedAt" TEXT,
      UNIQUE("automationId", "scheduledFor")
    );
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "userId" TEXT, "input" TEXT, "status" TEXT,
      "workId" TEXT, "attempt" INTEGER, "modelRequestCount" INTEGER, "modelRequestLimit" INTEGER,
      "executionEngine" TEXT, "engineVersion" TEXT, "runtimeVersion" INTEGER, "eventSequence" INTEGER,
      "coordinatorState" TEXT, "createdAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "AgentRunEvent" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "type" TEXT, "message" TEXT, "payload" TEXT,
      "idempotencyKey" TEXT UNIQUE, "sequence" INTEGER, "actor" TEXT, "createdAt" TEXT
    );
    CREATE TABLE "SpaceMessage" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "role" TEXT, "speakerAgentId" TEXT,
      "content" TEXT, "attachments" TEXT, "sourceKey" TEXT UNIQUE, "createdAt" TEXT
    );
    CREATE TABLE "SpaceRelay" ("id" TEXT PRIMARY KEY, "spaceId" TEXT, "status" TEXT);
  `);
  db.prepare('INSERT INTO "Space" VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'space-1', 'user-1', 'wechat-article', JSON.stringify({ deliverables: ['article.md'] }),
    'pi', 'NATIVE', null, 'before'
  );
  db.prepare('INSERT INTO "SpaceMember" VALUES (?, ?)').run('member-1', 'space-1');
  return db;
}

function insertAutomation(db, overrides = {}) {
  db.prepare(`INSERT INTO "SpaceAutomation" VALUES (
    @id, 'space-1', @name, @prompt, 'INTERVAL', @intervalMinutes, @workStrategy,
    @networkPolicy, @executionMode, @scriptPath, 1, @nextRunAt, NULL, NULL, NULL, NULL, @createdAt, @createdAt
  )`).run({
    id: 'automation-1',
    name: '每日文章',
    prompt: '创建一篇可以发布的文章',
    intervalMinutes: 1440,
    workStrategy: 'NEW_WORK',
    networkPolicy: 'forbidden',
    executionMode: 'PROMPT',
    scriptPath: null,
    nextRunAt: '2026-09-08T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  });
}

test('a due automation atomically creates one governed V3 run and advances its schedule', () => {
  const db = database();
  try {
    insertAutomation(db);
    const triggered = triggerNextDueAutomation(db, '2026-09-08T00:00:01.000Z');
    assert.equal(triggered.status, 'TRIGGERED');
    const run = db.prepare('SELECT * FROM "AgentRun"').get();
    assert.equal(run.status, 'QUEUED');
    assert.equal(run.executionEngine, 'pi');
    assert.equal(run.runtimeVersion, 3);
    assert.equal(JSON.parse(run.coordinatorState).automated, true);
    assert.equal(JSON.parse(run.coordinatorState).authorization.networkPolicy, 'forbidden');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceWork"').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceAutomationExecution"').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceMessage"').get().count, 1);
    assert.equal(db.prepare('SELECT "nextRunAt" FROM "SpaceAutomation"').get().nextRunAt, '2026-09-09T00:00:00.000Z');
    assert.equal(triggerNextDueAutomation(db, '2026-09-08T00:00:02.000Z'), null);
  } finally {
    db.close();
  }
});

test('soft-deleted automations never trigger', () => {
  const db = database();
  try {
    insertAutomation(db);
    db.prepare(`UPDATE "SpaceAutomation" SET "deletedAt" = '2026-09-07T00:00:00.000Z' WHERE "id" = 'automation-1'`).run();
    assert.equal(triggerNextDueAutomation(db, '2026-09-08T00:00:01.000Z'), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentRun"').get().count, 0);
  } finally {
    db.close();
  }
});

test('a due automation waits while its space already has active work', () => {
  const db = database();
  try {
    insertAutomation(db);
    db.prepare(`INSERT INTO "AgentRun" (
      "id", "spaceId", "userId", "input", "status", "attempt", "modelRequestCount", "modelRequestLimit",
      "executionEngine", "engineVersion", "runtimeVersion", "eventSequence", "createdAt", "updatedAt"
    ) VALUES ('existing', 'space-1', 'user-1', '任务', 'RUNNING', 1, 0, 48, 'native', '1', 3, 0, 'before', 'before')`).run();
    assert.equal(triggerNextDueAutomation(db, '2026-09-08T00:00:01.000Z'), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceAutomationExecution"').get().count, 0);
    assert.equal(db.prepare('SELECT "nextRunAt" FROM "SpaceAutomation"').get().nextRunAt, '2026-09-08T00:00:00.000Z');
  } finally {
    db.close();
  }
});

test('SCRIPT_ANALYSIS mode executes script and prepends output to AgentRun input', async () => {
  const db = database();
  const tmpRoot = path.join(os.tmpdir(), `almaren-test-${Date.now()}`);
  const workspaceDir = path.join(tmpRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace', 'shared');
  try {
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(
      path.join(workspaceDir, 'fetch.mjs'),
      'console.log(JSON.stringify([{ id: "hot-123", title: "测试推文" }]));\n'
    );

    insertAutomation(db, {
      executionMode: 'SCRIPT_ANALYSIS',
      scriptPath: 'shared/fetch.mjs',
    });

    const triggered = triggerNextDueAutomation(db, '2026-09-08T00:00:01.000Z', { projectRoot: tmpRoot });
    assert.equal(triggered.status, 'TRIGGERED');

    const run = db.prepare('SELECT * FROM "AgentRun"').get();
    assert.equal(run.status, 'QUEUED');
    assert.match(run.input, /【前置脚本执行采集的数据 \(shared\/fetch\.mjs\)】/);
    assert.match(run.input, /hot-123/);

    const execution = db.prepare('SELECT * FROM "SpaceAutomationExecution"').get();
    assert.equal(execution.status, 'TRIGGERED');
    assert.equal(execution.runId, run.id);
  } finally {
    db.close();
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test('SCRIPT_DIRECT mode executes script and completes work directly without AgentRun', async () => {
  const db = database();
  const tmpRoot = path.join(os.tmpdir(), `almaren-test-${Date.now()}`);
  const workspaceDir = path.join(tmpRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace', 'shared');
  try {
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(
      path.join(workspaceDir, 'direct.mjs'),
      'console.log("direct output: processed 10 items");\n'
    );

    insertAutomation(db, {
      executionMode: 'SCRIPT_DIRECT',
      scriptPath: 'shared/direct.mjs',
    });

    const triggered = triggerNextDueAutomation(db, '2026-09-08T00:00:01.000Z', { projectRoot: tmpRoot });
    assert.equal(triggered.status, 'COMPLETED');

    // 不应创建 AgentRun
    const runsCount = db.prepare('SELECT COUNT(*) AS count FROM "AgentRun"').get().count;
    assert.equal(runsCount, 0);

    // SpaceWork 应直接完成
    const work = db.prepare('SELECT * FROM "SpaceWork"').get();
    assert.equal(work.status, 'COMPLETED');
    assert.match(work.objective, /direct output: processed 10 items/);

    // 自动化执行记录应为 COMPLETED
    const execution = db.prepare('SELECT * FROM "SpaceAutomationExecution"').get();
    assert.equal(execution.status, 'COMPLETED');

    // 自动化日程已推进
    assert.equal(db.prepare('SELECT "nextRunAt" FROM "SpaceAutomation"').get().nextRunAt, '2026-09-09T00:00:00.000Z');
  } finally {
    db.close();
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});

test('SCRIPT_ANALYSIS gracefully handles script failure', async () => {
  const db = database();
  const tmpRoot = path.join(os.tmpdir(), `almaren-test-${Date.now()}`);
  const workspaceDir = path.join(tmpRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace', 'shared');
  try {
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(
      path.join(workspaceDir, 'bad.mjs'),
      'console.error("network error 500"); process.exit(1);\n'
    );

    insertAutomation(db, {
      executionMode: 'SCRIPT_ANALYSIS',
      scriptPath: 'shared/bad.mjs',
    });

    const triggered = triggerNextDueAutomation(db, '2026-09-08T00:00:01.000Z', { projectRoot: tmpRoot });
    assert.equal(triggered.status, 'FAILED');
    assert.equal(triggered.reason, 'SCRIPT_ERROR');

    // 不应创建 AgentRun
    const runsCount = db.prepare('SELECT COUNT(*) AS count FROM "AgentRun"').get().count;
    assert.equal(runsCount, 0);

    // 记录错误
    const execution = db.prepare('SELECT * FROM "SpaceAutomationExecution"').get();
    assert.equal(execution.status, 'FAILED');
    assert.match(execution.error, /network error 500/);

    const auto = db.prepare('SELECT * FROM "SpaceAutomation"').get();
    assert.match(auto.lastError, /network error 500/);
    assert.equal(auto.nextRunAt, '2026-09-09T00:00:00.000Z');
  } finally {
    db.close();
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
});

