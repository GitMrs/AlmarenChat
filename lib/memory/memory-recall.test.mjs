import test from 'node:test';
import assert from 'node:assert/strict';
import { recallExperiences, memoryIntentTypes, memorySearchTerms, rankMemoryRecords, memoryCandidateWhere } from './memory-recall.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as recall from './memory-recall.mjs';
import * as personalMemory from '../agents/memory/agent-personal-memory.mjs';
const compiled = ts.transpileModule(await readFile(new URL('../personal-assistant/user-memory.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: name => name.includes('memory-recall') ? recall : name.includes('agent-personal-memory') ? personalMemory : { default: {} } });
const { selectRelevantUserMemories } = exports;
import { selectPersonalMemories } from '../agents/memory/agent-personal-memory.mjs';

// Load the TS fact selector without loading the application's database.

const archive = (id, summary, date = '2026-10-30T12:00:00Z') => ({ id, summary, startAt: date, endAt: date });

test('both fact selectors share relevance, active filtering, deduplication and no unrelated fallback', () => {
  const facts = [
    { id: 'a', category: 'fact', content: '手机换电池预约上午11点', status: 'ACTIVE' },
    { id: 'b', category: 'fact', content: '手机换电池预约上午11点', status: 'ACTIVE' },
    { id: 'c', category: 'fact', content: '手机换电池费用159元', status: 'DISABLED' },
    { id: 'd', category: 'fact', content: '喜欢清淡饮食', status: 'ACTIVE' },
  ];
  assert.deepEqual([...selectRelevantUserMemories(facts, '手机换电池')].map(x => x.id), ['a']);
  assert.deepEqual(selectPersonalMemories(facts, '手机换电池').map(x => x.id), ['a']);
  assert.equal(selectRelevantUserMemories(facts, '你好').length, 0);
  assert.equal(selectPersonalMemories(facts, '你好').length, 0);
  assert.equal(rankMemoryRecords(facts, '计算房贷').length, 0);
});

test('assistant and agent separate confirmed rules from facts and exclude unverified candidates', () => {
  const memories = [
    { category: 'preference', content: '排版喜欢蓝色', status: 'ACTIVE', trustStatus: 'VERIFIED' },
    { category: 'rule', content: '排版保留标题', status: 'ACTIVE', trustStatus: 'VERIFIED' },
    { category: 'rule', content: '排版候选不能生效', status: 'ACTIVE', trustStatus: 'CANDIDATE' },
    { category: 'rule', content: '排版旧规则不能生效', status: 'SUPERSEDED', trustStatus: 'VERIFIED' },
  ];
  for (const context of [exports.buildUserMemoryContext(memories, '排版'), personalMemory.personalMemoryContext(memories, '排版')]) {
    assert.match(context, /【用户事实与偏好】\n- \[偏好习惯\] 排版喜欢蓝色/);
    assert.match(context, /【用户确认的交互约定】\n- \[交互准则\] 排版保留标题/);
    assert.doesNotMatch(context, /候选不能生效|旧规则不能生效/);
  }
});

test('both archive shapes use the same entry ranking and Beijing date interpretation', () => {
  const summary = '- [用户陈述，2026-10-30 20:00，北京时间] 手机维修预约11点。\n- [助理说法，未独立核实，2026-10-29 20:00，北京时间] 天气不错。';
  const assistant = archive('a', summary);
  const agent = { id: 'a', summary, status: 'ACTIVE', outcome: 'ACCEPTED', createdAt: '2026-10-30T12:00:00Z', tags: ['from-time:2026-10-29T12:00:00Z', 'through-time:2026-10-30T12:00:00Z'] };
  const a = recallExperiences([assistant], '昨天手机维修几点', { now: new Date('2026-10-31T12:00:00Z') });
  const b = recallExperiences([agent], '昨天手机维修几点', { now: new Date('2026-10-31T12:00:00Z') });
  assert.deepEqual(a.items.map(item => item.id), b.items.map(item => item.id));
  assert.match(a.context, /预约11点/);
  assert.doesNotMatch(a.context, /天气/);
  assert.match(a.context, /记忆存档ID：a/);
  assert.equal(recallExperiences([agent], '2026-10-28手机维修').items.length, 0);
});

test('disabled and duplicate archives, missing matches and malformed dates do not fabricate recall', () => {
  const summary = '- 用户明确预约手机维修。';
  const result = recallExperiences([archive('a', summary), archive('duplicate', summary), { ...archive('disabled', summary), status: 'DISABLED' }], '手机维修');
  assert.equal(result.items.length, 1);
  assert.equal(recallExperiences([archive('a', summary)], '你好').context, '');
  assert.equal(recallExperiences([archive('a', summary)], '计算房贷').context, '');
  assert.doesNotThrow(() => recallExperiences([archive('a', summary, 'invalid')], '手机维修'));
  const where = memoryCandidateWhere('还记得手机维修吗');
  assert.ok(where.OR.some(item => item.summary.contains === '手机'));
  assert.equal(memorySearchTerms('2026-10-30').length, 0);
  assert.equal(recallExperiences([archive('a', summary)], '2026-10-30').items.length, 1);
});

test('typed segments route recall by memory intent before searching the whole summary', () => {
  const archive = {
    id: 'typed',
    summary: '混合摘要：用户喜欢晚上聊天；用户明天要上班；一起讨论了猫咪毯子。',
    memorySegments: [
      { source: 'user', type: 'preference', occurredAt: '2026-10-30 20:00', content: '喜欢晚上聊天。' },
      { source: 'user', type: 'plan', occurredAt: '2026-10-30 20:05', content: '明天要上班。' },
      { source: 'event', type: 'event', occurredAt: '2026-10-30 20:10', content: '一起讨论了猫咪毯子。' },
    ],
    startAt: '2026-10-30T12:00:00Z',
    endAt: '2026-10-30T12:10:00Z',
  };
  assert.deepEqual(memoryIntentTypes('我之前计划做什么'), ['plan', 'unresolved']);
  assert.match(recallExperiences([archive], '我之前计划做什么').context, /明天要上班/);
  assert.doesNotMatch(recallExperiences([archive], '我之前计划做什么').context, /猫咪毯子/);
  assert.match(recallExperiences([archive], '上次发生了什么').context, /猫咪毯子/);
  assert.doesNotMatch(recallExperiences([archive], '上次发生了什么').context, /晚上聊天/);
});
