import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createResearchRuntime } from './research-runtime.mjs';

function fixture(overrides = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "AgentRun" ("id" TEXT PRIMARY KEY, "retryOfId" TEXT);
    CREATE TABLE "AgentTask" ("id" TEXT PRIMARY KEY, "runId" TEXT, "sortOrder" INTEGER);
    CREATE TABLE "AgentRunEvent" ("runId" TEXT, "type" TEXT, "payload" TEXT, "createdAt" TEXT);
  `);
  const events = [];
  const runtime = createResearchRuntime({
    db,
    complete: async () => '{"queries":["官方 2026"],"officialDomains":["example.com"]}',
    addEvent: (...args) => events.push(args),
    now: () => '2026-08-17T00:00:00.000Z',
    search: async () => ({
      provider: 'tavily',
      officialDomains: ['example.com'],
      timeRange: 'year',
      resultCount: 1,
      audit: { accepted: true },
      context: '[1] 官方资料',
      sources: [{ url: 'https://example.com/source', domain: 'example.com', title: '来源' }],
    }),
    ...overrides,
  });
  return { db, events, runtime };
}

test('research recovery follows retry lineage and keeps the latest audit per task order', () => {
  const current = fixture();
  current.db.exec(`
    INSERT INTO "AgentRun" VALUES ('run-1', NULL), ('run-2', 'run-1');
    INSERT INTO "AgentTask" VALUES ('task-1', 'run-1', 0), ('task-2', 'run-2', 0);
  `);
  const insert = current.db.prepare('INSERT INTO "AgentRunEvent" VALUES (?, ?, ?, ?)');
  insert.run('run-1', 'WEB_SEARCH_COMPLETED', JSON.stringify({
    audit: { accepted: true }, context: '父运行资料', sources: [{ url: 'https://example.com' }],
  }), '2026-08-17T00:00:00.000Z');
  insert.run('run-1', 'RESEARCH_RESULT_AUDITED', JSON.stringify({ taskId: 'task-1', audit: { accepted: false } }), '2026-08-17T00:00:01.000Z');
  insert.run('run-2', 'RESEARCH_RESULT_AUDITED', JSON.stringify({ taskId: 'task-2', audit: { accepted: true } }), '2026-08-17T00:00:02.000Z');

  assert.equal(current.runtime.restoreResearchContext('run-2'), '父运行资料');
  assert.deepEqual(current.runtime.restoreResearchAudit('run-2'), { accepted: true });
  assert.deepEqual(current.runtime.restoreResearchSources('run-2'), [{ url: 'https://example.com' }]);
  assert.deepEqual(current.runtime.restoreResearchResultAudits('run-2'), [{ accepted: true, taskSortOrder: 0 }]);
});

test('research execution respects V3 authorization and records successful source context', async () => {
  const current = fixture();
  const run = { id: 'run-1', input: '搜索最新官方资料', runtimeVersion: 3 };
  const deniedContext = { authorization: { capabilities: [] }, model: {}, tavilyApiKey: 'key' };
  assert.equal(await current.runtime.buildResearchContext(run, deniedContext), '');
  assert.equal(current.events.length, 0);

  const context = {
    authorization: { capabilities: ['web_research'] },
    model: {},
    tavilyApiKey: 'key',
    researchAudit: null,
    researchSources: [],
  };
  assert.equal(await current.runtime.buildResearchContext(run, context), '[1] 官方资料');
  assert.deepEqual(context.researchAudit, { accepted: true });
  assert.deepEqual(context.researchSources, [{ url: 'https://example.com/source' }]);
  assert.deepEqual(current.events.map((event) => event[1]), ['WEB_SEARCH_STARTED', 'WEB_SEARCH_COMPLETED']);
});

test('V3 research requires the current task opt-in and respects a forbidden run policy', async () => {
  const current = fixture();
  const run = { id: 'run-1', input: '搜索最新官方资料', runtimeVersion: 3 };
  const task = { title: '整理文档', instruction: '创建 report.md', webResearchRequired: 0 };
  const context = {
    authorization: { capabilities: ['web_research'], networkPolicy: 'allowed' },
    model: {}, tavilyApiKey: 'key', researchAudit: null, researchSources: [],
  };
  assert.equal(await current.runtime.buildResearchContext(run, context, { task, researchInput: task.instruction }), '');
  assert.equal(current.events.length, 0);

  task.webResearchRequired = 1;
  context.authorization.networkPolicy = 'forbidden';
  assert.equal(await current.runtime.buildResearchContext(run, context, { task, researchInput: '联网核对官方资料' }), '');
  assert.equal(current.events.length, 0);
});

test('V3 structured task opt-in can request research without keyword inference', async () => {
  const current = fixture();
  const task = { title: '核对依据', instruction: '补齐交付所需依据', webResearchRequired: 1 };
  const context = {
    authorization: { capabilities: ['web_research'], networkPolicy: 'allowed' },
    model: {}, tavilyApiKey: 'key', researchAudit: null, researchSources: [],
  };
  assert.equal(await current.runtime.buildResearchContext(
    { id: 'run-1', input: '交付任务', runtimeVersion: 3 }, context, { task, researchInput: task.instruction }
  ), '[1] 官方资料');
});

test('research failures become explicit context and a failed source audit', async () => {
  const current = fixture({ search: async () => { throw new Error('provider unavailable'); } });
  const context = { authorization: null, model: {}, tavilyApiKey: null };
  const result = await current.runtime.buildResearchContext(
    { id: 'run-1', input: '联网调研资料', runtimeVersion: 2 },
    context
  );
  assert.match(result, /provider unavailable/);
  assert.equal(context.researchAudit.accepted, false);
  assert.match(context.researchAudit.issues[0], /provider unavailable/);
  assert.deepEqual(context.researchSources, []);
  assert.equal(current.events.at(-1)[1], 'WEB_SEARCH_FAILED');
});

test('research retries a failed source audit only once with a targeted query', async () => {
  const calls = [];
  const current = fixture({
    search: async (queries) => {
      calls.push(queries);
      return calls.length === 1
        ? {
            provider: 'tavily', officialDomains: ['example.com'], timeRange: 'day', resultCount: 1,
            audit: { accepted: false, issues: ['时效性任务缺少更新时间'] },
            context: '未通过', sources: [{ url: 'https://example.com/old' }],
          }
        : {
            provider: 'tavily', officialDomains: ['example.com'], timeRange: 'day', resultCount: 1,
            audit: { accepted: true, issues: [] },
            context: '补查通过', sources: [{ url: 'https://example.com/live' }],
          };
    },
  });
  const context = {
    authorization: { capabilities: ['web_research'] }, model: {}, tavilyApiKey: 'key',
    researchAudit: null, researchSources: [],
  };

  const result = await current.runtime.buildResearchContext(
    { id: 'run-1', input: '联网查询郑州实时天气', runtimeVersion: 3 },
    context
  );

  assert.equal(result, '补查通过');
  assert.equal(calls.length, 2);
  assert.match(calls[1].join(' '), /实况 更新时间/);
  assert.deepEqual(current.events.map((event) => event[1]), [
    'WEB_SEARCH_STARTED', 'WEB_SEARCH_RETRYING', 'WEB_SEARCH_COMPLETED',
  ]);
});
