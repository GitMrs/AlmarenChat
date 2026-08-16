import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { buildRuntimeReport, classifyFailure, parseReportArgs, renderRuntimeReport } from './v3-runtime-report.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "name" TEXT);
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "runtimeVersion" INTEGER, "status" TEXT,
      "result" TEXT, "error" TEXT, "completionId" TEXT, "modelRequestCount" INTEGER,
      "createdAt" TEXT, "startedAt" TEXT, "completedAt" TEXT
    );
    CREATE TABLE "AgentTask" ("id" TEXT PRIMARY KEY, "runId" TEXT, "attempt" INTEGER);
    CREATE TABLE "AgentRunEvent" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "type" TEXT, "payload" TEXT,
      "message" TEXT, "sequence" INTEGER
    );
    CREATE TABLE "AgentRunOutbox" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "status" TEXT, "attempts" INTEGER,
      "lastError" TEXT, "deliveredAt" TEXT
    );
    CREATE TABLE "SpaceMessage" ("id" TEXT PRIMARY KEY, "sourceKey" TEXT);
  `);
  db.prepare('INSERT INTO "Space" ("id", "name") VALUES (?, ?)').run('space-1', '灰度空间');
  const insertRun = db.prepare(
    `INSERT INTO "AgentRun"
     ("id", "spaceId", "runtimeVersion", "status", "result", "error", "completionId",
      "modelRequestCount", "createdAt", "startedAt", "completedAt")
     VALUES (?, 'space-1', 3, ?, NULL, ?, ?, ?, ?, ?, ?)`
  );
  insertRun.run('run-ok', 'COMPLETED', null, 'run-completion:run-ok', 4, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z', '2026-08-15T00:02:00.000Z');
  insertRun.run('run-failed', 'FAILED_VALIDATION', '验收失败', 'run-completion:run-failed', 6, '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z', '2026-08-14T00:04:00.000Z');
  insertRun.run('run-active', 'RUNNING', null, null, 2, '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z', null);
  db.exec(`
    INSERT INTO "AgentTask" VALUES ('task-ok', 'run-ok', 1);
    INSERT INTO "AgentTask" VALUES ('task-failed', 'run-failed', 2);
    INSERT INTO "AgentRunEvent" VALUES ('event-ok', 'run-ok', 'RUN_ACCEPTANCE_COMPLETED', '{"accepted":true,"evidence":{"coveredRequirements":2,"requirementCount":2}}', '通过', 1);
    INSERT INTO "AgentRunEvent" VALUES ('event-revision', 'run-failed', 'TASK_REVISION_REQUIRED', NULL, '返工', 1);
    INSERT INTO "AgentRunEvent" VALUES ('event-replan', 'run-failed', 'TASK_DISPATCH_REJECTED', NULL, '退回', 2);
    INSERT INTO "AgentRunEvent" VALUES ('event-failed', 'run-failed', 'RUN_ACCEPTANCE_COMPLETED', '{"accepted":false,"evidence":{"coveredRequirements":1,"requirementCount":2}}', '未通过', 3);
    INSERT INTO "AgentRunOutbox" VALUES ('outbox-ok', 'run-ok', 'DELIVERED', 1, NULL, '2026-08-15T00:02:01.000Z');
    INSERT INTO "AgentRunOutbox" VALUES ('outbox-failed', 'run-failed', 'DELIVERED', 1, NULL, '2026-08-14T00:04:01.000Z');
    INSERT INTO "SpaceMessage" VALUES ('message-ok', 'run-completion:run-ok');
    INSERT INTO "SpaceMessage" VALUES ('message-failed', 'run-completion:run-failed');
  `);
  return db;
}

test('report arguments are bounded and support yarn-style options', () => {
  assert.deepEqual(parseReportArgs(['--days', '30', '--limit=5', '--json']), {
    days: 30, limit: 5, json: true,
  });
  assert.throws(() => parseReportArgs(['--days', '0']), /1 到 3650/);
  assert.throws(() => parseReportArgs(['--unknown']), /未知参数/);
});

test('runtime report separates success, one-pass, coverage and failure stages', () => {
  const db = database();
  const report = buildRuntimeReport(db, {
    days: 7,
    now: new Date('2026-08-16T00:00:00.000Z'),
  });
  db.close();

  assert.deepEqual(report.sample, { all: 3, active: 1, terminal: 2, completed: 1, cancelled: 0 });
  assert.equal(report.rates.success, 0.5);
  assert.equal(report.rates.onePass, 1);
  assert.equal(report.rates.goalCoverage, 0.75);
  assert.deepEqual(report.totals, {
    revisionCount: 1,
    replanCount: 1,
    coveredRequirements: 3,
    requirementCount: 4,
  });
  assert.equal(report.failureStages['验收'], 1);
  assert.equal(report.deliveryIssues.length, 0);
  assert.match(renderRuntimeReport(report), /目标覆盖率：75\.0%（3\/4）/);
});

test('delivery takes precedence when classifying a failed run', () => {
  assert.equal(classifyFailure(
    { status: 'FAILED' },
    [{ type: 'TASK_STARTED' }],
    { status: 'FAILED' }
  ), '投递');
});

test('normal artifact events do not turn an execution failure into a workspace failure', () => {
  assert.equal(classifyFailure(
    { status: 'FAILED', error: '模型请求超时' },
    [{ type: 'TASK_STARTED' }, { type: 'ARTIFACT_MANIFEST_RECORDED' }],
    { status: 'DELIVERED' }
  ), '执行');
});
