import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { loadAgentMemoryContextSync, recordAcceptedAgentExperiences, recordSpaceAgentExperiences } from './agent-memory-store.mjs';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "Agent" (
      "id" TEXT PRIMARY KEY, "agentType" TEXT NOT NULL DEFAULT 'BASIC'
    );
    CREATE TABLE "AgentExperience" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "spaceId" TEXT,
      "runId" TEXT, "taskId" TEXT NOT NULL, "title" TEXT NOT NULL, "summary" TEXT NOT NULL,
      "outcome" TEXT NOT NULL, "tags" TEXT, "createdAt" TEXT NOT NULL, "updatedAt" TEXT NOT NULL,
      "sourceType" TEXT NOT NULL DEFAULT 'TASK', "status" TEXT NOT NULL DEFAULT 'ACTIVE', "edited" INTEGER NOT NULL DEFAULT 0,
      UNIQUE("userId", "agentId", "taskId")
    );
    CREATE TABLE "AgentMemoryRule" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "category" TEXT NOT NULL,
      "title" TEXT NOT NULL, "instruction" TEXT NOT NULL, "status" TEXT NOT NULL,
      "evidenceCount" INTEGER NOT NULL, "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "AgentMemoryItem" (
      "id" TEXT PRIMARY KEY, "userId" TEXT, "agentId" TEXT, "category" TEXT,
      "content" TEXT, "status" TEXT, "updatedAt" TEXT
    );
  `);
  return db;
}

test('accepted task experience is idempotent and isolated per user and agent', () => {
  const db = database();
  db.prepare(`INSERT INTO "Agent" ("id", "agentType") VALUES ('writer', 'EMPLOYEE')`).run();
  const input = {
    run: { id: 'run-1', userId: 'user-1', spaceId: 'space-a' },
    tasks: [{ id: 'task-1', agentId: 'writer', title: '写文章', result: '完成初稿', status: 'COMPLETED', mode: 'executor' }],
    accepted: true,
    timestamp: '2026-09-07T00:00:00.000Z',
  };
  recordAcceptedAgentExperiences(db, input);
  recordAcceptedAgentExperiences(db, { ...input, tasks: [{ ...input.tasks[0], result: '完成终稿' }] });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentExperience"').get().count, 1);
  assert.equal(db.prepare('SELECT "summary" FROM "AgentExperience"').get().summary, '完成终稿');
  assert.match(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', query: '文章' }), /完成终稿/);
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-2', agentId: 'writer', query: '文章' }), '');
  db.close();
});

test('only active rules enter worker memory context', () => {
  const db = database();
  db.prepare(`INSERT INTO "Agent" ("id", "agentType") VALUES ('writer', 'EMPLOYEE')`).run();
  const insert = db.prepare(`INSERT INTO "AgentMemoryRule" VALUES (?, 'user-1', 'writer', 'correction', ?, ?, ?, 1, 'now')`);
  insert.run('active', '已确认', '先确认受众', 'ACTIVE');
  insert.run('pending', '待确认', '泄露到上下文', 'PENDING');
  const context = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', query: '受众' });
  assert.match(context, /先确认受众/);
  assert.doesNotMatch(context, /泄露到上下文/);
  db.close();
});

test('basic agents retain accepted experiences without inheriting employee rules', () => {
  const db = database();
  db.prepare(`INSERT INTO "Agent" ("id", "agentType") VALUES ('helper', 'BASIC')`).run();
  db.prepare(`INSERT INTO "AgentMemoryRule" VALUES ('rule', 'user-1', 'helper', 'method', '旧规则', '不应进入上下文', 'ACTIVE', 1, 'now')`).run();

  recordAcceptedAgentExperiences(db, {
    run: { id: 'run-1', userId: 'user-1', spaceId: 'space-a' },
    tasks: [{ id: 'task-1', agentId: 'helper', title: '普通问答', result: '已回答', status: 'COMPLETED', mode: 'advisor' }],
    accepted: true,
    timestamp: '2026-09-08T00:00:00.000Z',
  });

  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'helper', query: '旧规则' }), '');
  assert.match(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'helper', query: '普通问答' }), /已回答/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentExperience"').get().count, 1);
  db.close();
});

test('builtin agent brings its own facts into space, and receives only its actual participation', () => {
  const db = database();
  db.prepare(`INSERT INTO "AgentMemoryItem" VALUES (?, ?, ?, 'preference', ?, 'ACTIVE', 'now')`).run('fact-a', 'user-1', 'builtin-a', '用户喜欢清淡饮食');
  db.prepare(`INSERT INTO "AgentMemoryItem" VALUES (?, ?, ?, 'preference', ?, 'ACTIVE', 'now')`).run('fact-b', 'user-2', 'builtin-a', '另一个用户喜欢辣椒');
  assert.match(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'builtin-a', query: '饮食' }), /清淡饮食/);
  const input = { userId: 'user-1', spaceId: 'space-a', sourceType: 'DISCUSSION', sourceId: 'event-1', topic: '周末野餐', summary: '讨论了清淡便当', entries: [{ agentId: 'builtin-a', agentName: '甲', content: '我建议制作清淡便当' }], timestamp: '2026-10-20T00:00:00Z' };
  recordSpaceAgentExperiences(db, input);
  recordSpaceAgentExperiences(db, input);
  const memory = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'builtin-a', query: '野餐' });
  assert.match(memory, /建议制作清淡便当/);
  assert.match(memory, /来源空间：space-a/);
  assert.doesNotMatch(memory, /辣椒/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentExperience"').get().count, 1);
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'builtin-b', query: '野餐' }), '');
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-2', agentId: 'builtin-a', query: '野餐' }).includes('清淡便当'), false);
  db.close();
});

test('corrected, disabled and deleted episodes survive repeat synchronization', () => {
  const db = database();
  const input = { userId: 'user-1', spaceId: 'space-a', sourceType: 'GAME', sourceId: 'game-1', topic: '五子棋', summary: '黑方获胜', entries: [{ agentId: 'builtin-a', content: '落子' }], timestamp: '2026-10-20T00:00:00Z' };
  recordSpaceAgentExperiences(db, input);
  db.prepare(`UPDATE "AgentExperience" SET "edited" = 1, "summary" = '用户纠正：实际为平局', "status" = 'DISABLED'`).run();
  recordSpaceAgentExperiences(db, input);
  assert.equal(db.prepare('SELECT "summary" FROM "AgentExperience"').get().summary, '用户纠正：实际为平局');
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'builtin-a', query: '五子棋' }), '');
  db.prepare(`UPDATE "AgentExperience" SET "status" = 'DELETED'`).run();
  recordSpaceAgentExperiences(db, input);
  assert.equal(db.prepare('SELECT "status" FROM "AgentExperience"').get().status, 'DELETED');
  const task = { run: { id: 'run-a', userId: 'user-1', spaceId: 'space-a' }, tasks: [{ id: 'task-a', agentId: 'builtin-a', result: '任务成果', status: 'COMPLETED', title: '任务' }], accepted: true, timestamp: input.timestamp };
  recordAcceptedAgentExperiences(db, task);
  db.prepare(`UPDATE "AgentExperience" SET "edited" = 1, "summary" = '已纠正', "status" = 'DELETED' WHERE "taskId" = 'task-a'`).run();
  recordAcceptedAgentExperiences(db, task);
  assert.deepEqual(db.prepare(`SELECT "summary", "status" FROM "AgentExperience" WHERE "taskId" = 'task-a'`).get(), { summary: '已纠正', status: 'DELETED' });
  db.close();
});

test('unaccepted task output never becomes an accepted personal experience', () => {
  const db = database();
  recordAcceptedAgentExperiences(db, { run: { id: 'run-a', userId: 'user-1', spaceId: 'space-a' }, tasks: [{ id: 'task-a', agentId: 'builtin-a', title: '退款', result: '退款已完成', status: 'COMPLETED' }], accepted: false, timestamp: 'now' });
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'builtin-a', query: '退款' }), '');
  db.close();
});
