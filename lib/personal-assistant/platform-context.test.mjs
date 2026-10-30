import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from './platform-context-policy.mjs';
import * as activity from './activity-query.mjs';

const allowed = { spaces: true, tasks: true, chats: true };
const source = await readFile(new URL('./platform-context.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
function fixture() {
  const queries = [];
  const db = {};
  for (const name of ['space', 'agentRun', 'conversation', 'message', 'spaceMessage', 'spaceFile']) {
    db[name] = { findMany: async (query) => {
      queries.push({ name, query });
      if (name === 'agentRun') return [{ id: 'run', spaceId: 'space', work: { title: '制作网页' }, input: '旧执行指令'.repeat(1000), error: '旧错误'.repeat(1000), status: 'FAILED', updatedAt: new Date() }];
      return [];
    } };
  }
  const exports = {};
  vm.runInNewContext(output, { exports, Date, require(name) {
    if (name.includes('platform-context-policy')) return policy;
    if (name.includes('activity-query')) return activity;
    return db;
  } });
  return { ...exports, queries };
}

test('casual conversation does not query or inject platform records', async () => {
  const f = fixture();
  assert.equal(await f.buildAssistantPlatformContext('user', allowed, '晚上好，今天有点累'), null);
  assert.equal(f.queries.length, 0);
});

test('task overview fetches only task metadata and excludes old failures by default', async () => {
  const f = fixture();
  const result = JSON.parse(await f.buildAssistantPlatformContext('user', allowed, '看看我的任务'));
  assert.equal(f.queries.length, 1);
  const { name, query } = f.queries[0];
  assert.equal(name, 'agentRun');
  assert.equal(query.where.userId, 'user');
  assert.equal(query.select.input, false);
  assert.equal(query.select.error, false);
  assert.equal(query.where.OR[0].status.in.includes('FAILED'), false);
  assert.ok(query.where.OR[1].updatedAt.gte instanceof Date);
  assert.equal(result.recentTasks[0].goalExcerpt, undefined);
  assert.equal(result.recentTasks[0].errorExcerpt, undefined);
  assert.equal(result.recentSpaces, undefined);
  assert.equal(result.recentAgentChats, undefined);
});

test('explicit task search retrieves bounded details and preserves user scope', async () => {
  const f = fixture();
  const result = JSON.parse(await f.buildAssistantPlatformContext('user', allowed, '任务“鹈鹕骑单车”为什么失败？'));
  const query = f.queries[0].query;
  assert.equal(query.where.userId, 'user');
  assert.equal(query.where.OR[0].input.contains, '鹈鹕骑单车');
  assert.equal(query.select.input, true);
  assert.equal(result.recentTasks[0].goalExcerpt.length, 240);
  assert.equal(result.recentTasks[0].errorExcerpt.length, 240);
});

test('disabled context sources remain disabled even for explicit queries', async () => {
  const f = fixture();
  assert.equal(await f.buildAssistantPlatformContext('user', { ...allowed, tasks: false }, '任务“网页”为什么失败'), null);
  assert.equal(f.queries.length, 0);
});

test('date activity uses dedicated evidence and loads only the requested source', async () => {
  const f = fixture();
  assert.equal(await f.buildAssistantPlatformContext('user', allowed, '昨天完成了什么任务？'), null);
  assert.equal(f.queries.length, 0);
  const result = JSON.parse(await f.buildAssistantActivityContext('user', '昨天完成了什么任务？', allowed));
  assert.equal(f.queries.length, 1);
  assert.equal(f.queries[0].name, 'agentRun');
  assert.equal(result.enabledSources.chats, false);
});

test('context budget removes whole records, reports omissions and leaves input unchanged', () => {
  const input = { runs: Array.from({ length: 20 }, (_, i) => ({ id: i, input: '旧任务目标'.repeat(100) })), enabledSources: allowed };
  const text = policy.serializePlatformContext(input);
  assert.ok(text.length <= 6000);
  const result = JSON.parse(text);
  assert.ok(result.omitted.runs > 0);
  assert.equal(result.runs.length + result.omitted.runs, 20);
  assert.equal(input.runs.length, 20);
});
