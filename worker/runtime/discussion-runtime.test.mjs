import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createDiscussionRuntime } from './discussion-runtime.mjs';

function fixture(overrides = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "updatedAt" TEXT);
    CREATE TABLE "SpaceMessage" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "role" TEXT, "speakerAgentId" TEXT,
      "content" TEXT, "attachments" TEXT, "createdAt" TEXT
    );
    CREATE TABLE "SpaceDiscussion" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "userId" TEXT, "topic" TEXT,
      "participantIds" TEXT, "status" TEXT, "transcript" TEXT,
      "currentRound" INTEGER, "currentIndex" INTEGER, "maxRounds" INTEGER,
      "allowWeb" INTEGER, "webSearchCount" INTEGER, "pendingResearch" TEXT,
      "researchContext" TEXT, "result" TEXT, "error" TEXT,
      "completedAt" TEXT, "updatedAt" TEXT
    );
    INSERT INTO "Space" VALUES ('space-1', 'before');
  `);
  const memories = [];
  const agents = [
    { id: 'frontend', name: '前端', description: '前端工程师' },
    { id: 'product', name: '产品', description: '产品经理' },
  ];
  const runtime = createDiscussionRuntime({
    db,
    projectRoot: 'C:/workspace',
    completeMessage: async () => ({ content: '协调者总结' }),
    loadRunContext: () => ({
      agents,
      model: {},
      tavilyApiKey: null,
      space: { description: '', instructions: '' },
    }),
    persistSpaceMemory: (...args) => memories.push(args),
    now: () => '2026-08-17T00:00:00.000Z',
    runLoop: async () => ({ content: '成员观点' }),
    ...overrides,
  });
  return { db, memories, runtime };
}

function insertDiscussion(db, overrides = {}) {
  const discussion = {
    id: 'discussion-1',
    spaceId: 'space-1',
    userId: 'user-1',
    topic: '讨论页面方案',
    participantIds: JSON.stringify(['frontend', 'product']),
    status: 'RUNNING',
    transcript: '[]',
    currentRound: 1,
    currentIndex: 0,
    maxRounds: 2,
    allowWeb: 0,
    webSearchCount: 0,
    pendingResearch: null,
    researchContext: '',
    result: null,
    error: null,
    completedAt: null,
    updatedAt: 'before',
    ...overrides,
  };
  db.prepare(`
    INSERT INTO "SpaceDiscussion"
    ("id", "spaceId", "userId", "topic", "participantIds", "status", "transcript",
     "currentRound", "currentIndex", "maxRounds", "allowWeb", "webSearchCount",
     "pendingResearch", "researchContext", "result", "error", "completedAt", "updatedAt")
    VALUES (@id, @spaceId, @userId, @topic, @participantIds, @status, @transcript,
      @currentRound, @currentIndex, @maxRounds, @allowWeb, @webSearchCount,
      @pendingResearch, @researchContext, @result, @error, @completedAt, @updatedAt)
  `).run(discussion);
  return db.prepare('SELECT * FROM "SpaceDiscussion" WHERE "id" = ?').get(discussion.id);
}

test('discussion runtime persists one member turn and advances the sequence', async () => {
  const current = fixture();
  const discussion = insertDiscussion(current.db);
  await current.runtime.processDiscussion(discussion);

  const saved = current.db.prepare('SELECT * FROM "SpaceDiscussion"').get();
  assert.equal(saved.status, 'QUEUED');
  assert.equal(saved.currentRound, 1);
  assert.equal(saved.currentIndex, 1);
  assert.equal(JSON.parse(saved.transcript)[0].content, '成员观点');
  const message = current.db.prepare('SELECT * FROM "SpaceMessage"').get();
  assert.equal(message.speakerAgentId, 'frontend');
  assert.equal(message.content, '成员观点');
  current.db.close();
});

test('discussion runtime completes with a coordinator summary and project memory', async () => {
  const current = fixture();
  const discussion = insertDiscussion(current.db, {
    currentRound: 3,
    transcript: JSON.stringify([
      { round: 1, agentName: '前端', content: '建议 A' },
      { round: 2, agentName: '产品', content: '同意 A' },
    ]),
  });
  await current.runtime.processDiscussion(discussion);

  const saved = current.db.prepare('SELECT * FROM "SpaceDiscussion"').get();
  assert.equal(saved.status, 'COMPLETED');
  assert.equal(saved.result, '协调者总结');
  assert.equal(current.db.prepare('SELECT "speakerAgentId" FROM "SpaceMessage"').get().speakerAgentId, 'space-coordinator');
  assert.equal(current.memories.length, 1);
  current.db.close();
});

test('discussion runtime pauses for approval when a member requests web research', async () => {
  const current = fixture({
    runLoop: async ({ executeTool }) => {
      await executeTool('request_web_research', { query: '官方最新资料', reason: '核对事实' });
      return { content: '' };
    },
  });
  const discussion = insertDiscussion(current.db);
  await current.runtime.processDiscussion(discussion);

  const saved = current.db.prepare('SELECT * FROM "SpaceDiscussion"').get();
  assert.equal(saved.status, 'WAITING_RESEARCH');
  assert.deepEqual(JSON.parse(saved.pendingResearch), {
    query: '官方最新资料', reason: '核对事实', agentId: 'frontend', agentName: '前端',
  });
  assert.equal(current.db.prepare('SELECT COUNT(*) AS count FROM "SpaceMessage"').get().count, 0);
  current.db.close();
});

test('discussion runtime turns an in-flight cancellation into a terminal state', async () => {
  let db;
  const current = fixture({
    runLoop: async () => {
      db.prepare(`UPDATE "SpaceDiscussion" SET "status" = 'CANCEL_REQUESTED'`).run();
      return { content: '不应保存' };
    },
  });
  db = current.db;
  const discussion = insertDiscussion(current.db, { pendingResearch: '{"query":"待取消"}' });
  await current.runtime.processDiscussion(discussion);

  const saved = current.db.prepare('SELECT * FROM "SpaceDiscussion"').get();
  assert.equal(saved.status, 'CANCELLED');
  assert.equal(saved.pendingResearch, null);
  assert.equal(current.db.prepare('SELECT COUNT(*) AS count FROM "SpaceMessage"').get().count, 0);
  current.db.close();
});
