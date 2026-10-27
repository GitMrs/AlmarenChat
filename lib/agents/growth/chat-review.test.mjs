import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as cognition from './cognition.mjs';
import { randomUUID } from 'node:crypto';

async function setup() {
  const experience = { id: 'e', userId: 'u', agentId: 'a', spaceId: null, sourceType: 'CHAT', outcome: 'ACCEPTED', status: 'ACTIVE', title: '聊天归档', summary: '用户纠正了过时状态', tags: ['message:m'] };
  const events = [];
  const db = {
    agentExperience: {
      async findUnique() { return experience; },
      async update({ data }) { Object.assign(experience, data); },
    },
    agentGrowthEvent: {
      async findMany({ where }) { assert.equal(where.scope, 'PERSONAL'); assert.equal(where.spaceId, null); return events; },
      async upsert({ create }) { events.push(create); },
    },
    message: { async findMany({ where }) {
      assert.equal(where.conversation.userId, 'u'); assert.equal(where.conversation.agentMode, 'MAIN');
      return [{ id: 'm', role: 'user', content: '昨天的不舒服已经好了，请不要一直把旧状态当作现在。', createdAt: '2026-10-27' }];
    } },
    async $transaction(fn) { return fn(db); },
  };
  const modules = {
    '@/app/api/_lib/db': { default: db },
    '@/lib/core/model-client': {}, '@/app/api/_lib/agent-model': {},
    './cognition.mjs': cognition, 'node:crypto': { randomUUID },
  };
  const source = await readFile(new URL('./chat-review.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, console, require(name) { assert.ok(name in modules, name); return modules[name]; } });
  return { experience, events, review: exports.reviewAgentChatArchive };
}
const decision = { changed: true, type: 'REFLECTION', title: '历史状态', content: '即时状态需要结合时间和后续证据判断', beliefKey: '即时状态', behaviorChange: '描述旧状态时使用过去时', evidenceRefs: [{ type: 'experience', id: 'e' }], evidence: '昨天的不舒服已经好了，请不要一直把旧状态当作现在。' };
test('chat review without change is idempotent and does not create growth', async () => {
  const s = await setup(); let calls = 0;
  const complete = async () => { calls++; return '{"changed":false}'; };
  await s.review('e', complete); await s.review('e', complete);
  assert.equal(calls, 1); assert.equal(s.events.length, 0);
});
test('chat review requires original quote and persists personal growth once', async () => {
  const s = await setup();
  await assert.rejects(s.review('e', async () => JSON.stringify({ ...decision, evidence: '没有发生的对话与凭空编造的原文证据' })));
  assert.equal(s.events.length, 0); assert.equal(s.experience.tags.length, 1);
  await s.review('e', async () => JSON.stringify(decision));
  await s.review('e', async () => { assert.fail('already reviewed'); });
  assert.equal(s.events.length, 1); assert.equal(s.events[0].scope, 'PERSONAL');
  assert.equal(s.events[0].sourceType, 'CHAT_REVIEW'); assert.equal(s.events[0].payload.evidenceRefs[0].id, 'e');
});
test('space and disabled archives are excluded; failed model leaves archive intact', async () => {
  const s = await setup(); let calls = 0;
  const complete = async () => { calls++; throw new Error('model unavailable'); };
  s.experience.spaceId = 'space'; await s.review('e', complete);
  s.experience.spaceId = null; s.experience.status = 'DISABLED'; await s.review('e', complete);
  assert.equal(calls, 0);
  s.experience.status = 'ACTIVE'; await assert.rejects(s.review('e', complete));
  assert.equal(s.experience.summary, '用户纠正了过时状态'); assert.equal(s.experience.tags.length, 1);
});
test('archive changed during review cannot produce stale judgment', async () => {
  const s = await setup();
  // Prisma reads return detached snapshots.
  // Mutating status is enough to simulate an explicit disable while the model runs.
  await s.review('e', async () => { s.experience.status = 'DISABLED'; return JSON.stringify(decision); });
  assert.equal(s.events.length, 0);
});
