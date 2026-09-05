import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createTaskLifecycleRuntime } from './task-lifecycle-runtime.mjs';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "input" TEXT, "status" TEXT,
      "workerId" TEXT, "heartbeatAt" TEXT, "completionId" TEXT, "error" TEXT,
      "completedAt" TEXT, "eventSequence" INTEGER NOT NULL DEFAULT 0, "updatedAt" TEXT
    );
    CREATE TABLE "AgentTask" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "agentId" TEXT, "agentName" TEXT,
      "attempt" INTEGER, "status" TEXT, "waitQuestion" TEXT, "waitReason" TEXT,
      "waitAnswer" TEXT, "waitingAt" TEXT, "completedAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "SpaceFile" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "taskId" TEXT, "status" TEXT
    );
    CREATE TABLE "AgentSession" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "status" TEXT,
      "currentTaskId" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "AgentRunEvent" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "type" TEXT, "message" TEXT,
      "payload" TEXT, "idempotencyKey" TEXT UNIQUE, "sequence" INTEGER,
      "taskId" TEXT, "agentId" TEXT, "attempt" INTEGER, "actor" TEXT, "createdAt" TEXT,
      UNIQUE("runId", "sequence")
    );
    CREATE TABLE "AgentRunOutbox" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "idempotencyKey" TEXT UNIQUE,
      "payload" TEXT, "status" TEXT, "attempts" INTEGER,
      "availableAt" TEXT, "createdAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "AgentArtifactManifest" (
      "id" TEXT PRIMARY KEY, "runId" TEXT, "entries" TEXT, "validation" TEXT
    );
  `);
  const discarded = [];
  const events = [];
  const memories = [];
  const completions = [];
  const runtime = createTaskLifecycleRuntime({
    db,
    addEvent: (...args) => events.push(args),
    stageCompletion: (...args) => completions.push(args),
    discardTaskWorkspace: (...args) => discarded.push(args),
    persistSpaceMemory: (...args) => memories.push(args),
    now: () => '2026-08-17T00:00:00.000Z',
  });
  return { completions, db, discarded, events, memories, runtime };
}

function insertRunningWork(db, runId = 'run-1', taskId = 'task-1') {
  db.prepare(`
    INSERT INTO "AgentRun" ("id", "spaceId", "input", "status", "workerId", "updatedAt")
    VALUES (?, 'space-1', '完成页面', 'RUNNING', 'worker-1', 'before')
  `).run(runId);
  db.prepare(`
    INSERT INTO "AgentTask"
    ("id", "runId", "agentId", "agentName", "attempt", "status", "updatedAt")
    VALUES (?, ?, 'frontend', '前端', 1, 'RUNNING', 'before')
  `).run(taskId, runId);
  db.prepare(`INSERT INTO "AgentSession" VALUES ('session-1', 'space-1', 'WORKING', ?, 'before')`).run(taskId);
}

test('task lifecycle pauses a running task for one validated user question', () => {
  const current = fixture();
  insertRunningWork(current.db);
  const result = current.runtime.waitTaskForUserInput(
    { id: 'run-1' },
    { id: 'task-1', agentId: 'frontend', agentName: '前端', attempt: 1 },
    { question: '请选择还款方式', reason: '计算方法取决于该选择' }
  );
  assert.deepEqual(result, { ok: true, pause: true });
  assert.equal(current.db.prepare('SELECT "status" FROM "AgentTask"').get().status, 'WAITING');
  assert.equal(current.db.prepare('SELECT "status" FROM "AgentRun"').get().status, 'WAITING');
  assert.equal(current.events[0][1], 'TASK_WAITING_FOR_INPUT');
  current.db.close();
});

test('task lifecycle pauses at the productive iteration limit without failing the run', () => {
  const current = fixture();
  insertRunningWork(current.db);
  const result = current.runtime.waitTaskForExecutionContinuation(
    { id: 'run-1' },
    { id: 'task-1', agentId: 'frontend', agentName: '前端', attempt: 1 }
  );
  assert.equal(result, true);
  const task = current.db.prepare('SELECT * FROM "AgentTask"').get();
  assert.equal(task.status, 'WAITING');
  assert.equal(task.waitReason, 'execution_iteration_budget');
  assert.match(task.waitQuestion, /继续/);
  assert.equal(current.db.prepare('SELECT "status" FROM "AgentRun"').get().status, 'WAITING');
  assert.equal(current.events[0][1], 'TASK_WAITING_FOR_CONTINUATION');
  assert.deepEqual(current.discarded, []);
  current.db.close();
});

test('task lifecycle records which model budget caused the continuation wait', () => {
  const current = fixture();
  insertRunningWork(current.db);
  current.runtime.waitTaskForExecutionContinuation(
    { id: 'run-1' },
    { id: 'task-1', agentId: 'frontend', agentName: '前端', attempt: 1 },
    { budgetScope: 'run', modelRequestCount: 48, modelRequestLimit: 48 }
  );
  assert.deepEqual(current.events[0][3], {
    taskId: 'task-1',
    agentId: 'frontend',
    iterationLimitReached: true,
    checkpointAvailable: true,
    budgetScope: 'run',
    modelRequestCount: 48,
    modelRequestLimit: 48,
    attempt: 1,
  });
  current.db.close();
});

test('run lifecycle pauses coordinator work when the outer model budget is exhausted', () => {
  const current = fixture();
  current.db.prepare(`
    INSERT INTO "AgentRun" ("id", "spaceId", "input", "status", "workerId", "updatedAt")
    VALUES ('run-1', 'space-1', '完成页面', 'SUMMARIZING', 'worker-1', 'before')
  `).run();
  current.runtime.waitRunForExecutionContinuation(
    { id: 'run-1' },
    { scope: 'run', count: 48, limit: 48 }
  );
  const run = current.db.prepare('SELECT * FROM "AgentRun"').get();
  assert.equal(run.status, 'WAITING');
  assert.equal(run.error, 'run_model_request_budget');
  assert.equal(run.workerId, null);
  assert.equal(current.events[0][1], 'RUN_WAITING_FOR_CONTINUATION');
  assert.deepEqual(current.events[0][3], {
    budgetScope: 'run', modelRequestCount: 48, modelRequestLimit: 48,
  });
  current.db.close();
});

test('task lifecycle cancels one task and releases its staged workspace', () => {
  const current = fixture();
  insertRunningWork(current.db);
  current.db.prepare(`INSERT INTO "SpaceFile" VALUES ('file-1', 'run-1', 'task-1', 'GENERATING')`).run();
  current.runtime.cancelTask('task-1', 'run-1', '前端');
  assert.equal(current.db.prepare('SELECT "status" FROM "AgentTask"').get().status, 'CANCELLED');
  assert.equal(current.db.prepare('SELECT COUNT(*) AS count FROM "SpaceFile"').get().count, 0);
  assert.deepEqual(current.discarded, [['run-1', 'task-1']]);
  assert.equal(current.events[0][1], 'TASK_CANCELLED');
  current.db.close();
});

test('task lifecycle cancels a whole run and records memory after durable cancellation', () => {
  const current = fixture();
  insertRunningWork(current.db);
  current.runtime.cancelRun('run-1');
  assert.equal(current.db.prepare('SELECT "status" FROM "AgentRun"').get().status, 'CANCELLED');
  assert.equal(current.db.prepare('SELECT COUNT(*) AS count FROM "AgentRunOutbox"').get().count, 1);
  assert.deepEqual(current.discarded, [['run-1', 'task-1']]);
  assert.equal(current.memories.length, 1);
  current.db.close();
});

test('task lifecycle fails the run, stages completion and cleans every task workspace', () => {
  const current = fixture();
  insertRunningWork(current.db);
  current.runtime.failRun('run-1', new Error('provider unavailable'));
  const run = current.db.prepare('SELECT * FROM "AgentRun"').get();
  assert.equal(run.status, 'FAILED');
  assert.equal(run.error, 'provider unavailable');
  assert.equal(current.db.prepare('SELECT "status" FROM "AgentTask"').get().status, 'CANCELLED');
  assert.equal(current.completions.length, 1);
  assert.match(current.completions[0][4], /暂存变更 0 项/);
  assert.match(current.memories[0][1][0].summary, /原工作区文件/);
  assert.deepEqual(current.discarded, [['run-1', 'task-1']]);
  assert.equal(current.memories.length, 1);
  current.db.close();
});

test('task lifecycle preserves the failed task workspace for a targeted retry', () => {
  const current = fixture();
  insertRunningWork(current.db);
  current.db.prepare(`UPDATE "AgentTask" SET "status" = 'FAILED' WHERE "id" = 'task-1'`).run();

  current.runtime.failRun('run-1', new Error('tool loop limit'));

  assert.equal(current.db.prepare('SELECT "status" FROM "AgentTask"').get().status, 'FAILED');
  assert.deepEqual(current.discarded, []);
  current.db.close();
});
