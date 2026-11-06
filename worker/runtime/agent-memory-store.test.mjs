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
      "memoryTypes" TEXT, "memorySegments" TEXT,
      "sourceType" TEXT NOT NULL DEFAULT 'TASK', "status" TEXT NOT NULL DEFAULT 'ACTIVE', "edited" INTEGER NOT NULL DEFAULT 0,
      UNIQUE("userId", "agentId", "taskId")
    );
    CREATE TABLE "AgentMemoryRule" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "category" TEXT NOT NULL,
      "title" TEXT NOT NULL, "instruction" TEXT NOT NULL, "status" TEXT NOT NULL,
      "evidenceCount" INTEGER NOT NULL, "updatedAt" TEXT NOT NULL,
      "scope" TEXT NOT NULL DEFAULT 'AGENT', "spaceId" TEXT, "taskId" TEXT
    );
    CREATE TABLE "AgentMemoryItem" (
      "id" TEXT PRIMARY KEY, "userId" TEXT, "agentId" TEXT, "category" TEXT,
      "content" TEXT, "status" TEXT, "updatedAt" TEXT, "trustStatus" TEXT NOT NULL DEFAULT 'VERIFIED'
    );
  `);
  return db;
}

test('worker finds Monday plans for Friday schedules and retains cancellation evidence', () => {
  const db = database();
  try {
    const insert = db.prepare(`INSERT INTO "AgentExperience" ("id", "userId", "agentId", "taskId", "title", "summary", "outcome", "sourceType", "createdAt", "updatedAt") VALUES (?, 'u', 'a', ?, '出行', ?, 'ACCEPTED', 'CHAT', ?, ?)`);
    for (let i = 0; i < 130; i++) insert.run(`noise-${i}`, `chat:main:noise-${i}`, '普通闲聊', '2026-11-06', '2026-11-06');
    insert.run('plan', 'chat:main:plan', '- [用户陈述，2026-11-02 09:00，北京时间，类型：plan] 周五要坐火车', '2026-11-02', '2026-11-02');
    insert.run('cancel', 'chat:main:cancel', '- [用户陈述，2026-11-05 09:00，北京时间，类型：plan] 火车取消了，不去了', '2026-11-05', '2026-11-05');
    const context = loadAgentMemoryContextSync(db, { userId: 'u', agentId: 'a', conversationId: 'main', query: '2026-11-06有什么安排' });
    assert.match(context, /周五要坐火车/);
    assert.match(context, /火车取消了/);
    assert.doesNotMatch(loadAgentMemoryContextSync(db, { userId: 'u', agentId: 'a', conversationId: 'other', query: '2026-11-06有什么安排' }), /坐火车/);
  } finally { db.close(); }
});

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
  assert.match(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', spaceId: 'space-a', query: '文章' }), /完成终稿/);
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-2', agentId: 'writer', query: '文章' }), '');
  db.close();
});

test('only active rules enter worker memory context', () => {
  const db = database();
  db.prepare(`INSERT INTO "Agent" ("id", "agentType") VALUES ('writer', 'EMPLOYEE')`).run();
  const insert = db.prepare(`INSERT INTO "AgentMemoryRule" ("id", "userId", "agentId", "category", "title", "instruction", "status", "evidenceCount", "updatedAt") VALUES (?, 'user-1', 'writer', 'correction', ?, ?, ?, 1, 'now')`);
  insert.run('active', '已确认', '先确认受众', 'ACTIVE');
  insert.run('pending', '待确认', '泄露到上下文', 'PENDING');
  const context = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', query: '受众' });
  assert.match(context, /先确认受众/);
  assert.doesNotMatch(context, /泄露到上下文/);
  db.close();
});

test('worker personal rules require verified trust and cannot revive superseded rules', () => {
  const db = database();
  const insert = db.prepare(`INSERT INTO "AgentMemoryItem" ("id", "userId", "agentId", "category", "content", "status", "updatedAt", "trustStatus") VALUES (?, 'user-1', 'helper', 'rule', ?, ?, 'now', ?)`);
  insert.run('confirmed', '排版保留标题', 'ACTIVE', 'VERIFIED');
  insert.run('candidate', '排版未经确认的规则', 'ACTIVE', 'CANDIDATE');
  insert.run('old', '排版已被替代的规则', 'SUPERSEDED', 'VERIFIED');
  insert.run('disabled', '排版已停用的规则', 'DISABLED', 'VERIFIED');
  const context = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'helper', query: '排版' });
  assert.match(context, /用户确认的交互约定/);
  assert.match(context, /排版保留标题/);
  assert.doesNotMatch(context, /未经确认|已被替代|已停用/);
  db.close();
});

test('worker filters rule scopes before candidate limits and separates tasks from ordinary chat', () => {
  const db = database();
  db.prepare(`INSERT INTO "Agent" ("id", "agentType") VALUES ('writer', 'EMPLOYEE')`).run();
  const insert = db.prepare(`INSERT INTO "AgentMemoryRule" ("id", "userId", "agentId", "category", "title", "instruction", "status", "evidenceCount", "updatedAt", "scope", "spaceId", "taskId") VALUES (?, 'user-1', 'writer', 'method', '排版', ?, 'ACTIVE', 1, ?, ?, ?, ?)`);
  insert.run('global', '通用排版规范', '2020', 'AGENT', null, null);
  insert.run('space', '来源空间排版规范', '2020', 'SPACE', 'space-a', null);
  insert.run('task', '原任务排版规范', '2020', 'TASK', 'space-a', 'task-a');
  for (let i = 0; i < 70; i++) insert.run(`other-${i}`, '其他空间排版规范', '2026', 'SPACE', 'space-b', null);
  const load = context => loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', query: '排版', ...context });
  const chat = load({});
  assert.match(chat, /通用排版规范/);
  assert.doesNotMatch(chat, /来源空间排版|原任务排版|其他空间排版/);
  const space = load({ spaceId: 'space-a' });
  assert.match(space, /来源空间排版规范/);
  assert.doesNotMatch(space, /原任务排版|其他空间排版/);
  const task = load({ spaceId: 'space-a', taskId: 'task-a' });
  assert.match(task, /原任务排版规范/);
  assert.doesNotMatch(task, /其他空间排版/);
  assert.doesNotMatch(load({ spaceId: 'space-a', taskId: 'task-b' }), /原任务排版/);
  db.close();
});

test('basic agents retain accepted experiences without inheriting employee rules', () => {
  const db = database();
  db.prepare(`INSERT INTO "Agent" ("id", "agentType") VALUES ('helper', 'BASIC')`).run();
  db.prepare(`INSERT INTO "AgentMemoryRule" ("id", "userId", "agentId", "category", "title", "instruction", "status", "evidenceCount", "updatedAt") VALUES ('rule', 'user-1', 'helper', 'method', '旧规则', '不应进入上下文', 'ACTIVE', 1, 'now')`).run();

  recordAcceptedAgentExperiences(db, {
    run: { id: 'run-1', userId: 'user-1', spaceId: 'space-a' },
    tasks: [{ id: 'task-1', agentId: 'helper', title: '普通问答', result: '已回答', status: 'COMPLETED', mode: 'advisor' }],
    accepted: true,
    timestamp: '2026-09-08T00:00:00.000Z',
  });

  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'helper', spaceId: 'space-a', query: '旧规则' }), '');
  assert.match(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'helper', spaceId: 'space-a', query: '普通问答' }), /已回答/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "AgentExperience"').get().count, 1);
  db.close();
});

test('builtin agent brings its own facts into space, and receives only its actual participation', () => {
  const db = database();
  db.prepare(`INSERT INTO "AgentMemoryItem" ("id", "userId", "agentId", "category", "content", "status", "updatedAt") VALUES (?, ?, ?, 'preference', ?, 'ACTIVE', 'now')`).run('fact-a', 'user-1', 'builtin-a', '用户喜欢清淡饮食');
  db.prepare(`INSERT INTO "AgentMemoryItem" ("id", "userId", "agentId", "category", "content", "status", "updatedAt") VALUES (?, ?, ?, 'preference', ?, 'ACTIVE', 'now')`).run('fact-b', 'user-2', 'builtin-a', '另一个用户喜欢辣椒');
  assert.match(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'builtin-a', spaceId: 'space-a', query: '饮食' }), /清淡饮食/);
  const input = { userId: 'user-1', spaceId: 'space-a', sourceType: 'DISCUSSION', sourceId: 'event-1', topic: '周末野餐', summary: '讨论了清淡便当', entries: [{ agentId: 'builtin-a', agentName: '甲', content: '我建议制作清淡便当' }], timestamp: '2026-10-20T00:00:00Z' };
  recordSpaceAgentExperiences(db, input);
  recordSpaceAgentExperiences(db, input);
  const memory = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'builtin-a', spaceId: 'space-a', query: '野餐' });
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
  db.exec(`UPDATE "AgentExperience" SET "memorySegments" = '[]', "memoryTypes" = '[]'`);
  db.prepare(`UPDATE "AgentExperience" SET "edited" = 1, "summary" = '用户纠正：实际为平局', "status" = 'DISABLED'`).run();
  recordSpaceAgentExperiences(db, input);
  assert.equal(db.prepare('SELECT "summary" FROM "AgentExperience"').get().summary, '用户纠正：实际为平局');
  assert.equal(db.prepare('SELECT "memorySegments" FROM "AgentExperience"').get().memorySegments, '[]');
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'builtin-a', spaceId: 'space-a', query: '五子棋' }), '');
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
  assert.equal(loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'builtin-a', spaceId: 'space-a', query: '退款' }), '');
  db.close();
});

test('worker recalls personal and current-space activities without leaking other spaces', () => {
  const db = database();
  for (const [id, spaceId, result] of [['personal', null, '个人资料整理'], ['a', 'space-a', '甲空间资料整理'], ['b', 'space-b', '乙空间资料整理']]) {
    recordAcceptedAgentExperiences(db, {
      run: { id, userId: 'user-1', spaceId },
      tasks: [{ id, agentId: 'writer', title: '资料整理', result, status: 'COMPLETED' }],
      accepted: true, timestamp: '2026-10-27T00:00:00Z',
    });
  }
  const personal = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', query: '资料整理' });
  assert.match(personal, /个人资料整理/);
  assert.doesNotMatch(personal, /甲空间|乙空间/);
  const scoped = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', spaceId: 'space-a', query: '资料整理' });
  assert.match(scoped, /个人资料整理/);
  assert.match(scoped, /甲空间资料整理/);
  assert.doesNotMatch(scoped, /乙空间/);
  db.close();
});

test('task acceptance alone does not invent cognitive change', () => {
  const db = database();
  db.exec(`CREATE TABLE "AgentGrowthEvent" (
    "id" TEXT, "userId" TEXT, "agentId" TEXT, "spaceId" TEXT, "scope" TEXT, "type" TEXT,
    "sourceType" TEXT, "sourceId" TEXT, "eventKey" TEXT UNIQUE, "payload" TEXT, "createdAt" TEXT
  )`);
  recordAcceptedAgentExperiences(db, {
    run: { id: 'run-1', userId: 'user-1', spaceId: 'space-a' },
    tasks: [{ id: 'task-1', agentId: 'writer', title: '写文章', result: '文章已交付', status: 'COMPLETED' }],
    accepted: true, timestamp: '2026-10-27T00:00:00Z',
  });
  recordAcceptedAgentExperiences(db, {
    run: { id: 'run-1', userId: 'user-1', spaceId: 'space-a' },
    tasks: [{ id: 'task-1', agentId: 'writer', title: '写文章', result: '文章已交付', status: 'COMPLETED' }],
    accepted: true, timestamp: '2026-10-27T00:00:00Z',
  });
  assert.equal(db.prepare('SELECT COUNT(*) count FROM "AgentExperience"').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM "AgentGrowthEvent"').get().count, 0);
  db.close();
});

test('private archives stay out of spaces and have a candidate budget separate from tasks', () => {
  const db = database();
  const insert = db.prepare(`INSERT INTO AgentExperience (id, userId, agentId, spaceId, taskId, title, summary, outcome, sourceType, createdAt, updatedAt) VALUES (?, 'user-1', 'writer', ?, ?, '资料整理', ?, 'ACCEPTED', ?, '2026-10-27T00:00:00Z', ?)`);
  insert.run('task', null, 'task', '任务资料整理的交付结果', 'TASK', '2026-10-26');
  for (let index = 0; index < 130; index++) insert.run(`chat-${index}`, null, `chat:main:${index}`, '- [用户陈述，2026-10-27 08:00，北京时间] 私人资料整理原话。', 'CHAT', '2026-10-28');
  insert.run('other-conversation', null, 'chat:temporary:1', '- [用户陈述，2026-10-27 08:00，北京时间] 其他会话资料整理私密原话。', 'CHAT', '2026-10-29');
  insert.run('space-task', 'space-a', 'space-task', '空间资料整理的交付结果', 'TASK', '2026-10-27');
  const personal = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', conversationId: 'main', query: '资料整理' });
  assert.match(personal, /任务资料整理的交付结果/);
  assert.match(personal, /私人资料整理原话/);
  assert.doesNotMatch(personal, /其他会话|空间资料整理/);
  const space = loadAgentMemoryContextSync(db, { userId: 'user-1', agentId: 'writer', spaceId: 'space-a', query: '资料整理' });
  assert.match(space, /空间资料整理的交付结果/);
  assert.match(space, /任务资料整理的交付结果/);
  assert.doesNotMatch(space, /私人资料整理原话|其他会话/);
  db.close();
});
