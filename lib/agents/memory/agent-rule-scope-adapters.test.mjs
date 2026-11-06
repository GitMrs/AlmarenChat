import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as recall from '../../memory/memory-recall.mjs';
import * as policy from './agent-memory-policy.mjs';
import * as personal from './agent-personal-memory.mjs';

test('Prisma memory loading applies scope before candidate limits and passes context to the renderer', async () => {
  const rules = [
    ...Array.from({ length: 70 }, (_, index) => ({ id: `foreign-${index}`, scope: 'SPACE', spaceId: 'space-b', taskId: null, instruction: '其他空间排版规范' })),
    { id: 'global', scope: 'AGENT', spaceId: null, taskId: null, instruction: '通用排版规范' },
    { id: 'space', scope: 'SPACE', spaceId: 'space-a', taskId: null, instruction: '来源空间排版规范' },
    { id: 'task', scope: 'TASK', spaceId: 'space-a', taskId: 'task-a', instruction: '原任务排版规范' },
  ].map(rule => ({ ...rule, userId: 'owner', agentId: 'agent', status: 'ACTIVE', category: 'method' }));
  const matches = (item, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(condition => matches(item, condition));
    if (key === 'OR') return value.some(condition => matches(item, condition));
    if (value && typeof value === 'object') {
      if ('not' in value) return item[key] !== value.not;
      if ('startsWith' in value) return String(item[key] || '').startsWith(value.startsWith);
      return String(item[key] || '').includes(value.contains);
    }
    return item[key] === value;
  });
  const experiences = [];
  const db = {
    agent: { findFirst: async () => ({ id: 'agent', agentType: 'EMPLOYEE' }) },
    agentMemoryItem: { findMany: async () => [] },
    agentMemoryRule: { findMany: async ({ where, take }) => rules.filter(rule => matches(rule, where)).slice(0, take) },
    agentExperience: { findMany: async ({ where, take }) => experiences.filter(item => matches(item, where)).slice(0, take) },
  };
  const source = await readFile(new URL('./agent-memory.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const modules = {
    '@/lib/memory/memory-recall.mjs': recall, '@/lib/memory/memory-store': { recallOriginalDetails: async () => '' },
    '@/app/api/_lib/db': { default: db }, '@/lib/agents/memory/agent-memory-policy.mjs': policy,
    '@/lib/agents/memory/agent-personal-memory.mjs': personal, '@/lib/agents/growth/agent-growth': { loadAgentGrowthContext: async () => '' },
  };
  vm.runInNewContext(output, { exports, require: name => modules[name] });
  const load = context => exports.loadAgentMemoryContext({ userId: 'owner', agentId: 'agent', query: '排版', ...context });
  assert.doesNotMatch(await load({}), /来源空间排版|原任务排版|其他空间排版/);
  const space = await load({ spaceId: 'space-a' });
  assert.match(space, /通用排版规范/);
  assert.match(space, /来源空间排版规范/);
  assert.doesNotMatch(space, /原任务排版|其他空间排版/);
  assert.match(await load({ spaceId: 'space-a', taskId: 'task-a' }), /原任务排版规范/);
  assert.doesNotMatch(await load({ spaceId: 'space-a', taskId: 'task-b' }), /原任务排版/);
  const episode = (id, spaceId, sourceType, summary, taskId = id) => ({ id, spaceId, sourceType, summary, taskId, userId: 'owner', agentId: 'agent', outcome: 'ACCEPTED', status: 'ACTIVE', title: '排版', createdAt: '2026-10-27T00:00:00Z' });
  experiences.push(...Array.from({ length: 130 }, (_, index) => episode(`chat-${index}`, null, 'CHAT', '- [用户陈述，2026-10-27 08:00，北京时间] 排版私人聊天原话。', `chat:main:${index}`)));
  experiences.push(episode('other-chat', null, 'CHAT', '- [用户陈述，2026-10-27 08:00，北京时间] 排版其他会话原话。', 'chat:other:1'));
  experiences.push(episode('task-result', null, 'TASK', '排版任务成果'));
  experiences.push(episode('current-space', 'space-a', 'DISCUSSION', '排版当前空间讨论'));
  experiences.push(episode('foreign-space', 'space-b', 'DISCUSSION', '排版其他空间讨论'));
  const personalContext = await load({ conversationId: 'main' });
  assert.match(personalContext, /排版任务成果/);
  assert.match(personalContext, /排版私人聊天原话/);
  assert.doesNotMatch(personalContext, /排版其他会话原话|排版当前空间讨论|排版其他空间讨论/);
  const spaceContext = await load({ spaceId: 'space-a' });
  assert.match(spaceContext, /排版当前空间讨论/);
  assert.match(spaceContext, /排版任务成果/);
  assert.doesNotMatch(spaceContext, /排版私人聊天原话|排版其他会话原话|排版其他空间讨论/);
  for (const [id, time, content] of [
    ['plan', '2026-11-02 09:00', '周五要坐火车'],
    ['cancel', '2026-11-05 09:00', '火车取消了，不去了'],
  ]) experiences.push({ ...episode(id, null, 'CHAT', `- [用户陈述，${time}，北京时间，类型：plan] ${content}`, `chat:main:${id}`),
    title: '出行', createdAt: time.replace(' ', 'T') + ':00+08:00',
    memorySegments: [{ source: 'user', type: 'plan', occurredAt: time, content }],
  });
  const schedule = await load({ conversationId: 'main', query: '2026-11-06有什么安排' });
  assert.match(schedule, /周五要坐火车/);
  assert.match(schedule, /火车取消了/);
  assert.doesNotMatch(await load({ conversationId: 'other', query: '2026-11-06有什么安排' }), /坐火车|火车取消/);
});
