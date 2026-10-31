import test from 'node:test';
import assert from 'node:assert/strict';
import { recallExperiences, memorySearchTerms, rankMemoryRecords, memoryCandidateWhere } from './memory-recall.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as recall from './memory-recall.mjs';
const compiled = ts.transpileModule(await readFile(new URL('../personal-assistant/user-memory.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: name => name.includes('memory-recall') ? recall : { default: {} } });
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
