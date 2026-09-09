import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { advanceWorkAfterRun, completeAutomationExecution } from './work-lifecycle-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE "SpaceWork" (
    "id" TEXT PRIMARY KEY, "title" TEXT,
    "status" TEXT NOT NULL,
    "stage" TEXT,
    "completedAt" TEXT,
    "updatedAt" TEXT NOT NULL
  )`);
  db.exec(`
    CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "templateSnapshot" TEXT);
    CREATE TABLE "AgentRun" ("id" TEXT PRIMARY KEY, "spaceId" TEXT, "workId" TEXT);
    CREATE TABLE "SpaceAutomation" (
      "id" TEXT PRIMARY KEY, "enabled" INTEGER NOT NULL, "consecutiveFailures" INTEGER NOT NULL,
      "lastError" TEXT, "updatedAt" TEXT NOT NULL, "completionAction" TEXT NOT NULL DEFAULT 'NONE',
      "completionConfig" TEXT
    );
    CREATE TABLE "SpaceAutomationExecution" (
      "id" TEXT PRIMARY KEY, "automationId" TEXT NOT NULL, "runId" TEXT,
      "status" TEXT NOT NULL, "error" TEXT, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "SpaceActionRequest" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "workId" TEXT, "runId" TEXT,
      "automationExecutionId" TEXT, "kind" TEXT, "riskLevel" TEXT, "title" TEXT,
      "status" TEXT, "payload" TEXT, "result" TEXT, "error" TEXT, "idempotencyKey" TEXT UNIQUE,
      "decidedBy" TEXT, "requestedAt" TEXT, "decidedAt" TEXT, "completedAt" TEXT,
      "createdAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "SpaceMessage" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "role" TEXT, "speakerAgentId" TEXT,
      "content" TEXT, "attachments" TEXT, "sourceKey" TEXT UNIQUE, "createdAt" TEXT
    );
  `);
  db.prepare('INSERT INTO "SpaceWork" VALUES (?, ?, ?, ?, ?, ?)').run(
    'work-1', '自动化文章', 'COMPLETED', 'ready', 'before', 'before'
  );
  return db;
}

test('a successful run moves its Work to review without declaring the whole Work complete', () => {
  const db = database();
  try {
    assert.equal(advanceWorkAfterRun(db, {
      workId: 'work-1',
      runStatus: 'COMPLETED',
      timestamp: '2026-09-08T15:00:00.000Z',
    }), true);
    assert.deepEqual(db.prepare('SELECT * FROM "SpaceWork" WHERE "id" = ?').get('work-1'), {
      id: 'work-1',
      title: '自动化文章',
      status: 'ACTIVE',
      stage: 'review',
      completedAt: null,
      updatedAt: '2026-09-08T15:00:00.000Z',
    });
  } finally {
    db.close();
  }
});

test('successful automation executions remain enabled and clear prior failures', () => {
  const db = database();
  try {
    db.prepare('INSERT INTO "SpaceAutomation" ("id", "enabled", "consecutiveFailures", "lastError", "updatedAt") VALUES (?, ?, ?, ?, ?)').run('auto-1', 1, 2, '旧错误', 'before');
    db.prepare('INSERT INTO "SpaceAutomationExecution" VALUES (?, ?, ?, ?, ?, ?)').run('exec-1', 'auto-1', 'run-1', 'TRIGGERED', null, 'before');
    assert.equal(completeAutomationExecution(db, {
      runId: 'run-1', runStatus: 'COMPLETED', error: null, timestamp: 'after',
    }), true);
    assert.deepEqual(db.prepare('SELECT "enabled", "consecutiveFailures", "lastError" FROM "SpaceAutomation"').get(), {
      enabled: 1, consecutiveFailures: 0, lastError: null,
    });
    assert.equal(db.prepare('SELECT "status" FROM "SpaceAutomationExecution"').get().status, 'COMPLETED');
  } finally {
    db.close();
  }
});

test('successful automated work requests one idempotent user finalization', () => {
  const db = database();
  try {
    db.prepare('INSERT INTO "Space" VALUES (?, ?)').run('space-1', JSON.stringify({
      completionCriteria: [{ id: 'criterion-1', label: '正文完整' }],
    }));
    db.prepare('INSERT INTO "AgentRun" VALUES (?, ?, ?)').run('run-1', 'space-1', 'work-1');
    db.prepare(`INSERT INTO "SpaceAutomation"
      ("id", "enabled", "consecutiveFailures", "lastError", "updatedAt", "completionAction", "completionConfig")
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('auto-1', 1, 0, null, 'before', 'WECHAT_CREATE_DRAFT', JSON.stringify({ themeId: 'editorial-red' }));
    db.prepare('INSERT INTO "SpaceAutomationExecution" VALUES (?, ?, ?, ?, ?, ?)').run('exec-1', 'auto-1', 'run-1', 'TRIGGERED', null, 'before');
    completeAutomationExecution(db, { runId: 'run-1', runStatus: 'COMPLETED', error: null, timestamp: 'after' });
    completeAutomationExecution(db, { runId: 'run-1', runStatus: 'COMPLETED', error: null, timestamp: 'after' });
    const action = db.prepare('SELECT * FROM "SpaceActionRequest"').get();
    assert.equal(action.kind, 'FINALIZE_WORK');
    assert.equal(action.riskLevel, 'MEDIUM');
    assert.equal(action.status, 'PENDING');
    assert.equal(JSON.parse(action.payload).completionCriteria[0].label, '正文完整');
    assert.equal(JSON.parse(action.payload).completionAction, 'WECHAT_CREATE_DRAFT');
    assert.deepEqual(JSON.parse(action.payload).completionConfig, { themeId: 'editorial-red' });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceActionRequest"').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "SpaceMessage"').get().count, 1);
  } finally {
    db.close();
  }
});

test('unsuccessful automation executions pause the rule with an auditable error', () => {
  const db = database();
  try {
    db.prepare('INSERT INTO "SpaceAutomation" ("id", "enabled", "consecutiveFailures", "lastError", "updatedAt") VALUES (?, ?, ?, ?, ?)').run('auto-1', 1, 0, null, 'before');
    db.prepare('INSERT INTO "SpaceAutomationExecution" VALUES (?, ?, ?, ?, ?, ?)').run('exec-1', 'auto-1', 'run-1', 'TRIGGERED', null, 'before');
    assert.equal(completeAutomationExecution(db, {
      runId: 'run-1', runStatus: 'FAILED_VALIDATION', error: '缺少正文', timestamp: 'after',
    }), true);
    assert.deepEqual(db.prepare('SELECT "enabled", "consecutiveFailures", "lastError" FROM "SpaceAutomation"').get(), {
      enabled: 0, consecutiveFailures: 1, lastError: '缺少正文',
    });
    assert.deepEqual(db.prepare('SELECT "status", "error" FROM "SpaceAutomationExecution"').get(), {
      status: 'FAILED_VALIDATION', error: '缺少正文',
    });
  } finally {
    db.close();
  }
});

test('failed runs do not advance the Work lifecycle', () => {
  const db = database();
  try {
    assert.equal(advanceWorkAfterRun(db, {
      workId: 'work-1',
      runStatus: 'FAILED',
      timestamp: 'after',
    }), false);
    assert.equal(db.prepare('SELECT "updatedAt" FROM "SpaceWork" WHERE "id" = ?').get('work-1').updatedAt, 'before');
  } finally {
    db.close();
  }
});
