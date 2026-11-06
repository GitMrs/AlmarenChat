import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from './agent-memory-policy.mjs';

async function fixture() {
  const rules = [];
  const events = [];
  const tasks = [];
  const experiences = [];
  const spaces = [{ id: 'space', userId: 'owner' }];
  let revision = 0;
  const matches = (item, where) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object') return 'not' in value ? item[key] !== value.not : false;
    return (item[key] ?? null) === value;
  });
  const db = {
    agent: { findFirst: async () => ({ id: 'agent' }) },
    space: { findFirst: async ({ where }) => spaces.find(item => matches(item, where)) },
    agentTask: {
      findMany: async () => tasks,
      findFirst: async ({ where }) => tasks.find(item => item.id === where.id && item.agentId === where.agentId && item.run.spaceId === where.run.spaceId && item.run.userId === where.run.userId),
    },
    agentRunEvent: { findMany: async ({ where }) => {
      assert.equal(where.run.userId, 'owner');
      assert.equal(where.agentId, 'agent');
      return events.filter(item => item.actor === where.actor);
    } },
    agentExperience: {
      findMany: async () => experiences,
      findUnique: async () => experiences[0],
      upsert: async ({ create, update }) => {
        if (experiences.length) Object.assign(experiences[0], update);
        else experiences.push({ ...create });
      },
    },
    agentMemoryRule: {
      findFirst: async ({ where }) => rules.find(item => matches(item, where)),
      findMany: async ({ where }) => rules.filter(item => matches(item, where)),
      findUnique: async ({ where }) => rules.find(item => item.key === where.userId_agentId_key.key),
      create: async ({ data }) => {
        const item = { evidenceCount: 1, scope: 'AGENT', spaceId: null, taskId: null, updatedAt: String(++revision), ...data };
        rules.push(item); return item;
      },
      update: async ({ where, data }) => {
        const item = rules.find(rule => rule.id === where.id);
        item.evidenceCount += data.evidenceCount.increment;
        item.sourceIds = data.sourceIds;
      },
      updateMany: async ({ where, data }) => {
        if (db.failNextRuleUpdate) { db.failNextRuleUpdate = false; return { count: 0 }; }
        const item = rules.find(rule => matches(rule, where));
        if (!item) return { count: 0 };
        Object.assign(item, data, { updatedAt: String(++revision) });
        return { count: 1 };
      },
    },
  };
  db.$transaction = async callback => {
    const before = structuredClone(rules);
    try { return await callback(db); }
    catch (error) { rules.splice(0, rules.length, ...before); throw error; }
  };
  const source = await readFile(new URL('./agent-memory-service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require(name) {
    if (name === 'node:crypto') return { randomUUID };
    if (name.endsWith('/db')) return { default: db };
    if (name.endsWith('/agent-memory-policy.mjs')) return policy;
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { ...exports, db, rules, events, tasks, experiences, spaces };
}

async function managementRoute(f) {
  const source = await readFile(new URL('../../../app/api/agents/[agentId]/memory/route.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const modules = {
    'next/server': { NextResponse: { json: Response.json } }, 'node:crypto': { randomUUID },
    '@/app/api/_lib/db': { default: f.db }, '@/app/api/_lib/auth': { requireAuth: () => 'owner' },
    '@/lib/agents/memory/agent-memory-service': f,
  };
  vm.runInNewContext(output, { exports, require: name => modules[name] });
  return (action, body) => exports[action]({ json: async () => body }, { params: Promise.resolve({ agentId: 'agent' }) });
}

test('only user corrections become pending rules and repeated evidence never activates them', async () => {
  const f = await fixture();
  const event = (id, actor) => ({ id, actor, runId: 'run', taskId: 'task', run: { spaceId: 'space' }, payload: { feedback: '保留页面布局' } });
  f.events.push(event('automatic', 'assistant'));
  await f.synchronizeAgentMemory('owner', 'agent');
  assert.equal(f.rules.length, 0);
  f.events.push(event('first', 'user'));
  await f.synchronizeAgentMemory('owner', 'agent');
  assert.deepEqual([...f.rules[0].sourceIds], ['first', 'task', 'run']);
  f.events.push(event('second', 'user'));
  await f.synchronizeAgentMemory('owner', 'agent');
  await f.synchronizeAgentMemory('owner', 'agent');
  assert.equal(f.rules.length, 1);
  assert.equal(f.rules[0].status, 'PENDING');
  assert.equal(f.rules[0].evidenceCount, 2);
  assert.equal(policy.agentMemoryContext({ rules: f.rules, query: '页面布局' }), '');
  f.rules[0].status = 'DISABLED';
  await f.recordAgentCorrection(f.db, { userId: 'owner', agentId: 'agent', spaceId: 'space', taskId: 'task', runId: 'run', eventId: 'third', feedback: '保留页面布局' });
  assert.equal(f.rules[0].status, 'DISABLED');
  assert.equal(f.rules[0].evidenceCount, 3);
});

test('task synchronization retains typed episodes and never overwrites manually edited content', async () => {
  const f = await fixture();
  f.tasks.push({ id: 'task', title: '排版', result: '已完成排版', mode: 'executor', run: { id: 'run', spaceId: 'space' } });
  await f.synchronizeAgentMemory('owner', 'agent');
  const experience = f.experiences[0];
  assert.equal(experience.memoryTypes[0], 'episode');
  assert.equal(experience.memorySegments[0].content, '已完成排版');
  assert.equal(experience.spaceId, 'space');
  experience.edited = true;
  experience.summary = '用户修正后的经历';
  experience.memorySegments = [];
  f.tasks[0].result = '旧任务产生的其他结果';
  await f.synchronizeAgentMemory('owner', 'agent');
  assert.equal(experience.summary, '用户修正后的经历');
  assert.equal(experience.memorySegments.length, 0);
});

test('rule confirmation preserves task scope, edits retain history and superseded rules cannot be enabled', async () => {
  const f = await fixture();
  f.tasks.push({ id: 'task', agentId: 'agent', run: { id: 'run', userId: 'owner', spaceId: 'space' } });
  await f.recordAgentCorrection(f.db, { userId: 'owner', agentId: 'agent', spaceId: 'space', taskId: 'task', runId: 'run', eventId: 'event', feedback: '保留页面布局' });
  const id = f.rules[0].id;
  const call = await managementRoute(f);
  assert.equal((await call('PATCH', { id, action: 'enable' })).status, 400);
  assert.equal((await call('PATCH', { id, action: 'approve' })).status, 200);
  assert.equal(f.rules[0].scope, 'TASK');
  const original = f.rules[0].instruction;
  assert.equal((await call('PATCH', { id, action: 'update', scope: 'SPACE', instruction: '页面布局先征求确认' })).status, 200);
  assert.equal(f.rules.length, 2);
  assert.equal(f.rules[0].instruction, original);
  assert.equal(f.rules[0].status, 'SUPERSEDED');
  assert.equal(f.rules[0].supersededById, f.rules[1].id);
  assert.equal(f.rules[1].scope, 'SPACE');
  assert.equal(f.rules[1].taskId, null);
  assert.equal(f.rules[1].status, 'ACTIVE');
  assert.equal((await call('PATCH', { id, action: 'enable' })).status, 400);
  assert.equal((await call('PATCH', { id, action: 'approve' })).status, 400);
  assert.equal((await call('PATCH', { id: f.rules[1].id, action: 'update', instruction: original, scope: 'TASK', spaceId: 'space', taskId: 'task' })).status, 200);
  assert.equal(f.rules.length, 3);
  assert.equal(f.rules[1].supersededById, f.rules[2].id);
  await f.recordAgentCorrection(f.db, { userId: 'owner', agentId: 'agent', spaceId: 'space', taskId: 'task', runId: 'run', eventId: 'another-event', feedback: '保留页面布局' });
  assert.equal(f.rules.length, 3);
  assert.equal(f.rules[0].status, 'SUPERSEDED');
});

test('scope authorization and failed concurrent edits leave no replacement or active orphan', async () => {
  const f = await fixture();
  const call = await managementRoute(f);
  const draft = { category: 'method', title: '排版', instruction: '保留标题', scope: 'SPACE', spaceId: 'space' };
  assert.equal((await call('POST', { ...draft, spaceId: 'foreign-space' })).status, 400);
  assert.equal((await call('POST', { ...draft, scope: 'TASK', taskId: 'foreign-task' })).status, 400);
  assert.equal(f.rules.length, 0);
  assert.equal((await call('POST', draft)).status, 200);
  assert.equal((await call('POST', draft)).status, 200);
  assert.equal(f.rules.length, 1);
  const id = f.rules[0].id;
  f.db.failNextRuleUpdate = true;
  assert.equal((await call('PATCH', { id, action: 'update', instruction: '新排版要求' })).status, 400);
  assert.equal(f.rules.length, 1);
  assert.equal(f.rules[0].instruction, '保留标题');
  assert.equal(f.rules[0].status, 'ACTIVE');
  assert.equal((await call('PATCH', { id, action: 'update', scope: 'SPACE', spaceId: 'foreign-space' })).status, 400);
  assert.equal((await call('PATCH', { id, action: 'disable' })).status, 200);
  assert.equal((await call('PATCH', { id, action: 'update', instruction: '停用中的新版本' })).status, 200);
  assert.equal(f.rules[1].status, 'DISABLED');
  assert.equal(f.rules[0].status, 'SUPERSEDED');
});
