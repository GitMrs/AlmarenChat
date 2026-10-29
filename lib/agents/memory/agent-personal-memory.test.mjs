import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { upgradeAgentMemories } from '../../../scripts/upgrade-agent-runtime.mjs';
import { personalMemoryContext, selectPersonalMemories, buildSpaceExperience } from './agent-personal-memory.mjs';

test('migration copies only Agent facts and repeated upgrades preserve edits and forgetting', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
    INSERT INTO "User" VALUES ('user-a');
    CREATE TABLE "AssistantMemoryItem" (
      "id" TEXT PRIMARY KEY, "userId" TEXT, "agentId" TEXT, "category" TEXT,
      "content" TEXT, "status" TEXT, "sourceMessageId" TEXT, "createdAt" TEXT, "updatedAt" TEXT
    );
    INSERT INTO "AssistantMemoryItem" VALUES ('assistant', 'user-a', NULL, 'fact', '小伴独立记录', 'ACTIVE', NULL, 'now', 'now');
    INSERT INTO "AssistantMemoryItem" VALUES ('agent', 'user-a', 'builtin-a', 'fact', 'Agent旧事实', 'ACTIVE', NULL, 'now', 'now');
    CREATE TABLE "AgentExperience" ("id" TEXT PRIMARY KEY);
  `);
  const original = db.prepare('SELECT * FROM "AssistantMemoryItem" ORDER BY "id"').all();
  db.exec(readFileSync(new URL('../../../prisma/migrations/20261020160000_separate_agent_memory/migration.sql', import.meta.url), 'utf8'));
  assert.equal(db.prepare('SELECT COUNT(*) count FROM "AgentMemoryItem"').get().count, 1);
  db.prepare(`UPDATE "AgentMemoryItem" SET "content" = '用户纠正', "status" = 'DELETED' WHERE "id" = 'agent'`).run();
  upgradeAgentMemories(db);
  upgradeAgentMemories(db);
  assert.deepEqual(db.prepare('SELECT * FROM "AssistantMemoryItem" ORDER BY "id"').all(), original);
  assert.deepEqual(db.prepare('SELECT "content", "status" FROM "AgentMemoryItem"').get(), { content: '用户纠正', status: 'DELETED' });
  assert.deepEqual(db.prepare('PRAGMA table_info("AgentExperience")').all().map(row => row.name), ['id', 'sourceType', 'status', 'edited']);
  db.close();
});

test('fact retrieval ranks related facts, limits the prompt and excludes inactive entries', () => {
  const facts = [
    { id: 'recent', content: '喜欢蓝色', status: 'ACTIVE' },
    { id: 'match', category: 'preference', content: '喝咖啡不加糖', status: 'ACTIVE' },
    { id: 'deleted', content: '咖啡加糖', status: 'DELETED' },
    { id: 'disabled', content: '咖啡加牛奶', status: 'DISABLED' },
  ];
  assert.deepEqual(selectPersonalMemories(facts, '咖啡').map(item => item.id), ['match']);
  assert.doesNotMatch(personalMemoryContext(facts, '咖啡'), /加牛奶|咖啡加糖/);
  assert.ok(selectPersonalMemories(Array.from({ length: 20 }, () => facts[1]), '咖啡').length <= 6);
});

test('space experience requires actual participation and retains scene boundaries', () => {
  const input = { spaceId: 'space-a', sourceType: 'GAME', sourceId: 'game-a', topic: '狼人杀', summary: '游戏结束', entries: [{ agentId: 'a', agentName: '甲', content: '游戏中扮演狼人' }] };
  assert.equal(buildSpaceExperience({ ...input, agentId: 'absent' }), null);
  const experience = buildSpaceExperience({ ...input, agentId: 'a' });
  assert.match(experience.summary, /游戏身份只在该局适用/);
  assert.notEqual(experience.taskId, buildSpaceExperience({ ...input, spaceId: 'space-b', agentId: 'a' }).taskId);
});

test('legacy study skills never enter personal memory context, even on matching queries', () => {
  const memories = [
    { id: 'skill', category: 'skill', content: '缓存失效后按步骤排查', status: 'ACTIVE' },
    { id: 'preference', category: 'preference', content: '用户希望回答简短', status: 'ACTIVE' },
  ];
  assert.deepEqual(selectPersonalMemories(memories, '天气怎么样'), []);
  const context = personalMemoryContext(memories, '缓存失效怎么办');
  assert.equal(context, '');
  assert.doesNotMatch(context, /缓存失效|研习技能/);
  assert.equal(personalMemoryContext([memories[0]], '缓存失效'), '');
});
