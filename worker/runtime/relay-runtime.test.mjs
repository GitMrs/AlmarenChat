import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createCollaborationState } from '../../lib/relay/collaboration.mjs';
import { createGomokuState } from '../../lib/relay/gomoku.mjs';
import { createRelayRuntime } from './relay-runtime.mjs';

function fixture({ action = { row: 8, column: 8, comment: '占据中心' }, runLoop, completeMessage } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "Space" ("id" TEXT PRIMARY KEY, "updatedAt" TEXT);
    CREATE TABLE "SpaceMessage" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "role" TEXT, "speakerAgentId" TEXT,
      "content" TEXT, "attachments" TEXT, "createdAt" TEXT
    );
    CREATE TABLE "SpaceFile" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "fileName" TEXT, "mimeType" TEXT,
      "size" INTEGER, "relativePath" TEXT, "status" TEXT, "createdAt" TEXT, "updatedAt" TEXT
    );
    CREATE TABLE "SpaceRelay" (
      "id" TEXT PRIMARY KEY, "spaceId" TEXT, "userId" TEXT, "kind" TEXT, "goal" TEXT,
      "participantIds" TEXT, "approvalMode" TEXT, "status" TEXT, "currentIndex" INTEGER,
      "turnCount" INTEGER, "maxTurns" INTEGER, "state" TEXT, "transcript" TEXT,
      "pendingAction" TEXT, "result" TEXT, "error" TEXT, "createdAt" TEXT,
      "updatedAt" TEXT, "startedAt" TEXT, "completedAt" TEXT
    );
    INSERT INTO "Space" VALUES ('space-1', 'before');
  `);
  const writes = [];
  const agents = [
    { id: 'black', name: '黑方', description: '稳健棋手' },
    { id: 'white', name: '白方', description: '进攻棋手' },
  ];
  const runtime = createRelayRuntime({
    db,
    projectRoot: 'C:/workspace',
    completeMessage: completeMessage || (async () => ({ content: '' })),
    loadRunContext: () => ({ agents, model: {} }),
    now: () => '2026-09-07T00:00:00.000Z',
    runLoop: runLoop || (async ({ executeTool }) => {
      await executeTool('submit_relay_action', action);
    }),
    executeWorkspace: async (_options, name, args) => {
      writes.push({ name, ...args });
    },
    describeArtifact: async (_options, relativePath) => ({
      id: `file-${relativePath}`,
      relativePath,
      fileName: relativePath.split('/').at(-1),
      mimeType: relativePath.endsWith('.html') ? 'text/html' : 'application/json',
      size: 100,
    }),
  });
  return { db, runtime, writes };
}

function insertRelay(db, overrides = {}) {
  const relay = {
    id: 'relay-1', spaceId: 'space-1', userId: 'user-1', kind: 'gomoku', goal: '完成一局五子棋',
    participantIds: JSON.stringify(['black', 'white']), approvalMode: 'AUTO', status: 'RUNNING',
    currentIndex: 0, turnCount: 0, maxTurns: 60, state: JSON.stringify(createGomokuState()),
    transcript: '[]', pendingAction: null, result: null, error: null, createdAt: 'before',
    updatedAt: 'before', startedAt: 'before', completedAt: null,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO "SpaceRelay" ("id", "spaceId", "userId", "kind", "goal", "participantIds",
      "approvalMode", "status", "currentIndex", "turnCount", "maxTurns", "state", "transcript",
      "pendingAction", "result", "error", "createdAt", "updatedAt", "startedAt", "completedAt")
    VALUES (@id, @spaceId, @userId, @kind, @goal, @participantIds, @approvalMode, @status,
      @currentIndex, @turnCount, @maxTurns, @state, @transcript, @pendingAction, @result,
      @error, @createdAt, @updatedAt, @startedAt, @completedAt)
  `).run(relay);
  return db.prepare('SELECT * FROM "SpaceRelay" WHERE "id" = ?').get(relay.id);
}

test('automatic relay applies one action and advances to the next member', async () => {
  const current = fixture();
  await current.runtime.processRelay(insertRelay(current.db));
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'QUEUED');
  assert.equal(saved.turnCount, 1);
  assert.equal(saved.currentIndex, 1);
  assert.equal(JSON.parse(saved.state).board[7 * 15 + 7], 1);
  assert.equal(current.writes.length, 2);
  assert.equal(current.db.prepare('SELECT COUNT(*) count FROM "SpaceFile"').get().count, 2);
  current.db.close();
});

test('per-turn approval stores an action without changing game state', async () => {
  const current = fixture();
  const before = insertRelay(current.db, { approvalMode: 'EACH_TURN' });
  await current.runtime.processRelay(before);
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'WAITING_APPROVAL');
  assert.equal(saved.turnCount, 0);
  assert.equal(JSON.parse(saved.state).moves.length, 0);
  assert.equal(JSON.parse(saved.pendingAction).approved, false);
  assert.equal(current.writes.length, 0);
  current.db.close();
});

test('an approved pending action is applied once', async () => {
  const current = fixture();
  const relay = insertRelay(current.db, {
    pendingAction: JSON.stringify({
      agentId: 'black', agentName: '黑方', expectedVersion: 1,
      action: { row: 8, column: 8, comment: '' }, approved: true,
    }),
  });
  await current.runtime.processRelay(relay);
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.turnCount, 1);
  assert.equal(saved.pendingAction, null);
  assert.equal(JSON.parse(saved.state).moves.length, 1);
  current.db.close();
});

test('a rejected action is included when the same member regenerates its turn', async () => {
  const current = fixture({
    runLoop: async ({ messages, executeTool }) => {
      assert.match(messages[1].content, /拒绝了上一提议：8,8/);
      await executeTool('submit_relay_action', { row: 8, column: 9, comment: '改走相邻位置' });
    },
  });
  const relay = insertRelay(current.db, {
    pendingAction: JSON.stringify({
      agentId: 'black', agentName: '黑方', expectedVersion: 1,
      action: { row: 8, column: 8, comment: '' }, approved: false, rejected: true,
    }),
  });
  await current.runtime.processRelay(relay);
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(JSON.parse(saved.state).board[7 * 15 + 8], 1);
  current.db.close();
});

test('invalid actions fail without modifying persisted state', async () => {
  const current = fixture({ action: { row: 16, column: 1, comment: '' } });
  const original = insertRelay(current.db);
  await current.runtime.processRelay(original);
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'FAILED');
  assert.equal(saved.turnCount, 0);
  assert.equal(saved.state, original.state);
  assert.match(saved.error, /超出/);
  current.db.close();
});

test('winning action completes the relay and counts the final turn', async () => {
  const current = fixture({ action: { row: 1, column: 5, comment: '连成五子' } });
  const state = createGomokuState();
  for (let column = 1; column <= 4; column += 1) {
    state.board[column - 1] = 1;
    state.moves.push({ number: column, player: 1, agentId: 'black', agentName: '黑方', row: 1, column, comment: '' });
  }
  state.version = 5;
  const relay = insertRelay(current.db, { state: JSON.stringify(state), turnCount: 8 });
  await current.runtime.processRelay(relay);
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'COMPLETED');
  assert.equal(saved.turnCount, 9);
  assert.match(saved.result, /黑方 获胜/);
  assert.equal(current.db.prepare('SELECT COUNT(*) count FROM "SpaceMessage"').get().count, 1);
  current.db.close();
});

test('cancellation during a turn produces a terminal cancelled state', async () => {
  let db;
  const current = fixture({
    runLoop: async () => {
      db.prepare(`UPDATE "SpaceRelay" SET "status" = 'CANCEL_REQUESTED'`).run();
    },
  });
  db = current.db;
  await current.runtime.processRelay(insertRelay(current.db));
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'CANCELLED');
  assert.ok(saved.completedAt);
  current.db.close();
});

test('the maximum turn limit completes the relay after the applied action', async () => {
  const current = fixture();
  await current.runtime.processRelay(insertRelay(current.db, { maxTurns: 1 }));
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'COMPLETED');
  assert.equal(saved.turnCount, 1);
  assert.match(saved.result, /1 轮上限/);
  current.db.close();
});

test('generic collaboration persists a visible member result and advances directly', async () => {
  const current = fixture({
    runLoop: async ({ executeTool }) => {
      await executeTool('submit_relay_turn', { content: '先明确首页的核心用户和首屏目标。', status: 'CONTINUE' });
    },
  });
  const relay = insertRelay(current.db, {
    kind: 'collaboration',
    goal: '共同完善首页方案',
    state: JSON.stringify(createCollaborationState(['形成一致的页面结构'])),
  });
  await current.runtime.processRelay(relay);
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'QUEUED');
  assert.equal(saved.currentIndex, 1);
  assert.equal(saved.turnCount, 1);
  const message = current.db.prepare('SELECT * FROM "SpaceMessage"').get();
  assert.equal(message.speakerAgentId, 'black');
  assert.match(message.content, /核心用户/);
  assert.equal(JSON.parse(message.attachments)[0].type, 'relay_turn');
  assert.equal(current.writes.length, 0);
  current.db.close();
});

test('generic collaboration ends with one visible coordinator summary', async () => {
  const current = fixture({
    runLoop: async ({ messages, executeTool, requiredFinalTool }) => {
      if (requiredFinalTool === 'submit_relay_review') {
        assert.match(messages[1].content, /方案已经满足完成条件/);
        await executeTool('submit_relay_review', {
          decision: 'COMPLETE', summary: '协调者验收：方案已经收敛。', instruction: '',
        });
        return;
      }
      await executeTool('submit_relay_turn', { content: '方案已经满足完成条件。', status: 'COMPLETE' });
    },
  });
  const relay = insertRelay(current.db, {
    kind: 'collaboration',
    goal: '共同完善首页方案',
    state: JSON.stringify(createCollaborationState(['形成一致的页面结构'])),
  });
  await current.runtime.processRelay(relay);
  const awaitingSummary = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(awaitingSummary.status, 'QUEUED');
  assert.equal(JSON.parse(awaitingSummary.state).phase, 'summarizing');
  current.db.prepare(`UPDATE "SpaceRelay" SET "status" = 'RUNNING'`).run();
  await current.runtime.processRelay(current.db.prepare('SELECT * FROM "SpaceRelay"').get());
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'COMPLETED');
  assert.equal(saved.turnCount, 1);
  assert.equal(saved.result, '协调者验收：方案已经收敛。');
  const messages = current.db.prepare('SELECT * FROM "SpaceMessage" ORDER BY "createdAt", "rowid"').all();
  assert.deepEqual(messages.map((message) => message.speakerAgentId), ['black', 'space-coordinator']);
  current.db.close();
});

test('coordinator can visibly continue an incomplete collaboration without adding a turn', async () => {
  const current = fixture({
    runLoop: async ({ executeTool, requiredFinalTool }) => {
      if (requiredFinalTool === 'submit_relay_review') {
        await executeTool('submit_relay_review', {
          decision: 'CONTINUE',
          summary: '协调者验收：仍缺少技术约束，继续一轮。',
          instruction: '补充移动端实现限制。',
        });
        return;
      }
      await executeTool('submit_relay_turn', { content: '当前方案初步完成。', status: 'COMPLETE' });
    },
  });
  const relay = insertRelay(current.db, {
    kind: 'collaboration',
    goal: '共同完善首页方案',
    state: JSON.stringify(createCollaborationState(['包含技术约束'])),
  });
  await current.runtime.processRelay(relay);
  current.db.prepare(`UPDATE "SpaceRelay" SET "status" = 'RUNNING'`).run();
  await current.runtime.processRelay(current.db.prepare('SELECT * FROM "SpaceRelay"').get());
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'QUEUED');
  assert.equal(saved.turnCount, 1);
  assert.equal(saved.currentIndex, 1);
  assert.equal(JSON.parse(saved.state).coordinatorInstruction, '补充移动端实现限制。');
  const coordinatorMessage = current.db.prepare(`SELECT * FROM "SpaceMessage" WHERE "speakerAgentId" = 'space-coordinator'`).get();
  assert.match(coordinatorMessage.content, /继续一轮/);
  current.db.close();
});

test('failed coordinator summary retries from persisted member output', async () => {
  let reviewing = false;
  const current = fixture({
    runLoop: async ({ executeTool, requiredFinalTool }) => {
      if (requiredFinalTool === 'submit_relay_review') {
        reviewing = true;
        throw new Error('temporary provider failure');
      }
      await executeTool('submit_relay_turn', { content: '已经形成可验收成果。', status: 'COMPLETE' });
    },
  });
  await current.runtime.processRelay(insertRelay(current.db, {
    kind: 'collaboration',
    state: JSON.stringify(createCollaborationState(['形成可验收成果'])),
  }));
  current.db.prepare(`UPDATE "SpaceRelay" SET "status" = 'RUNNING'`).run();
  await current.runtime.processRelay(current.db.prepare('SELECT * FROM "SpaceRelay"').get());
  assert.equal(reviewing, true);
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'QUEUED');
  assert.equal(saved.turnCount, 1);
  assert.equal(JSON.parse(saved.state).summaryAttempts, 1);
  assert.equal(current.db.prepare(`SELECT COUNT(*) count FROM "SpaceMessage" WHERE "speakerAgentId" = 'black'`).get().count, 1);
  current.db.close();
});

test('per-turn mode waits before coordinator-requested extension calls another member', async () => {
  const current = fixture({
    runLoop: async ({ executeTool, requiredFinalTool }) => {
      assert.equal(requiredFinalTool, 'submit_relay_review');
      await executeTool('submit_relay_review', {
        decision: 'CONTINUE',
        summary: '协调者验收：还缺一个关键约束。',
        instruction: '补充性能限制。',
      });
    },
  });
  const state = { ...createCollaborationState(['包含性能限制']), phase: 'summarizing', completionReason: '成员申请完成' };
  const relay = insertRelay(current.db, {
    kind: 'collaboration',
    approvalMode: 'EACH_TURN',
    turnCount: 1,
    state: JSON.stringify(state),
    transcript: JSON.stringify([{ turn: 1, agentId: 'black', agentName: '黑方', action: { content: '初步方案', status: 'COMPLETE' } }]),
  });
  await current.runtime.processRelay(relay);
  const waiting = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(waiting.status, 'WAITING_APPROVAL');
  assert.equal(waiting.turnCount, 1);
  assert.equal(JSON.parse(waiting.pendingAction).type, 'coordinator_continue');

  current.db.prepare(`UPDATE "SpaceRelay" SET "status" = 'RUNNING', "pendingAction" = ?`).run(JSON.stringify({
    ...JSON.parse(waiting.pendingAction), approved: true, decision: 'continue',
  }));
  await current.runtime.processRelay(current.db.prepare('SELECT * FROM "SpaceRelay"').get());
  const continued = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(continued.status, 'QUEUED');
  assert.equal(continued.currentIndex, 1);
  assert.equal(JSON.parse(continued.state).coordinatorInstruction, '补充性能限制。');
  current.db.close();
});

test('user can end a coordinator-requested extension without another model call', async () => {
  const current = fixture({ runLoop: async () => { throw new Error('model should not be called'); } });
  const state = { ...createCollaborationState(['形成结论']), phase: 'summarizing' };
  const relay = insertRelay(current.db, {
    kind: 'collaboration',
    turnCount: 2,
    state: JSON.stringify(state),
    transcript: JSON.stringify([{ turn: 2, agentId: 'white', agentName: '白方', action: { content: '现有结论', status: 'COMPLETE' } }]),
    pendingAction: JSON.stringify({
      type: 'coordinator_continue', approved: true, decision: 'stop',
      summary: '协调者认为仍可继续改进。', instruction: '补充更多细节。',
    }),
  });
  await current.runtime.processRelay(relay);
  const saved = current.db.prepare('SELECT * FROM "SpaceRelay"').get();
  assert.equal(saved.status, 'COMPLETED');
  assert.equal(saved.turnCount, 2);
  assert.match(saved.result, /用户选择结束接力/);
  current.db.close();
});
