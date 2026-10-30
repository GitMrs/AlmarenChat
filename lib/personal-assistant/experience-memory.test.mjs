import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from './experience-context-policy.mjs';
import * as historyContext from './history-context.mjs';

const source = await readFile(new URL('./experience-memory.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
function fixture() {
  const queries = [];
  const original = { id: 'archive', summary: '- 用户明确预约手机换电池。\n- 助理称T1已经晋级。\n- 用户修改了时间标注策略。', startAt: new Date('2026-10-30T16:00:00Z'), endAt: new Date('2026-10-30T16:10:00Z') };
  const db = {
    message: { findMany: async (query) => { queries.push(query); return [{ role: 'assistant', content: '最新回复' }, { role: 'user', content: '最新问题' }]; } },
    assistantExperience: { findMany: async (query) => { queries.push(query); return [original]; } },
  };
  const exports = {};
  vm.runInNewContext(output, { exports, require(name) {
    if (name === 'node:crypto') return { randomUUID };
    if (name.includes('experience-context-policy')) return policy;
    if (name.includes('history-context')) return historyContext;
    return db;
  } });
  return { ...exports, queries, original };
}

test('memory loader applies relevance policy without rewriting stored archives', async () => {
  const f = fixture();
  const before = f.original.summary;
  const result = await f.loadAssistantMemoryContext({ userId: 'u', conversationId: 'c', query: '还记得手机换电池吗', historyLimit: 40, includeExperiences: true });
  assert.match(result.experienceContext, /手机换电池/);
  assert.doesNotMatch(result.experienceContext, /T1|时间标注策略/);
  assert.equal(f.original.summary, before);
  assert.equal(result.history[0].role, 'user');
  assert.equal(f.queries[1].where.userId, 'u');
  assert.equal(f.queries[1].where.conversationId, 'c');
});

test('temporary chats skip archive queries and new archive prompts require provenance', async () => {
  const f = fixture();
  const result = await f.loadAssistantMemoryContext({ userId: 'u', conversationId: 'c', query: '还记得手机换电池吗', historyLimit: 40, includeExperiences: false });
  assert.equal(f.queries.length, 1);
  assert.equal(result.experienceContext, '');
  const prompt = f.buildExperiencePrompt([]);
  assert.match(prompt, /助理说法，未独立核实/);
  assert.match(prompt, /是否完成待确认/);
  assert.match(prompt, /不能作为现行规则/);
});
