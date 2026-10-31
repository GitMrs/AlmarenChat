import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

async function loadRoute(file, modules) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, console, require(name) {
    if (!(name in modules)) throw new Error('Unexpected import: ' + name);
    return modules[name];
  } });
  return exports;
}

async function contextRoute() {
  const state = { authenticated: true, owned: true, mode: 'MAIN', memoryReads: 0, modelReads: 0, archiveCalls: 0 };
  const after = { conversationId: 'chat', role: { in: ['user', 'assistant'] }, OR: [{ createdAt: { gt: new Date('2026-10-20') } }] };
  const params = { params: Promise.resolve({ conversationId: 'chat' }) };
  const archive = { id: 'archive', summary: '归档摘要', createdAt: new Date('2026-10-20'), tags: ['from-time:2026-10-19T00:00:00.000Z', 'through-time:2026-10-20T00:00:00.000Z', 'message:1', 'message:2'] };
  const route = await loadRoute('../../../app/api/conversations/[conversationId]/context/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/app/api/_lib/auth': { requireAuth() { if (!state.authenticated) throw new Error('Unauthorized'); return 'owner'; } },
    '@/app/api/_lib/db': { default: {
      conversation: { async findFirst({ where }) {
        assert.equal(where.userId, 'owner'); assert.equal(where.kind, 'AGENT'); assert.equal(where.id, 'chat');
        return state.owned ? { id: 'chat', agentId: 'agent-a', agentMode: state.mode, contextMessageLimit: 12 } : null;
      } },
      conversationContextState: { findUnique: async () => null },
      user: { findUnique: async () => ({ contextMessageLimit: 40, customModelEnabled: true }) },
      message: {
        count: async ({ where }) => { assert.equal(where.conversationId, 'chat'); return where.OR ? 6 : 8; },
        findMany: async ({ where, take, select }) => {
          assert.equal(where.conversationId, 'chat'); assert.equal(where.OR, undefined); assert.deepEqual([...where.role.in], ['user', 'assistant']); assert.equal(take, 12); assert.equal(select.content, true); assert.equal(select.attachments, undefined);
          return [{ id: 'recent', role: 'assistant', content: '近期回复', createdAt: new Date() }];
        },
        findFirst: async () => ({ content: '项目进度' }),
      },
      agentExperience: {
        findMany: async ({ where, take }) => {
          assert.equal(where.userId, 'owner'); assert.equal(where.agentId, 'agent-a'); assert.equal(where.taskId.startsWith, 'chat:chat:'); assert.equal(where.status.not, 'DELETED'); assert.equal(take, 30);
          return [archive];
        },
        count: async () => 1,
      },
    } },
    '@/app/api/_lib/agent-personal-memory': {
      requireAgentMemoryAccess: async (userId, agentId) => { assert.equal(userId, 'owner'); assert.equal(agentId, 'agent-a'); },
      agentChatArchiveState: async () => ({ where: after, prefix: 'chat:chat:' }),
      archiveAgentChat: async (userId, agentId, conversationId, options) => {
        state.archiveCalls++;
        assert.equal(userId, 'owner'); assert.equal(agentId, 'agent-a'); assert.equal(conversationId, 'chat'); assert.equal(options.preserveRecent, 4);
        assert.equal(await options.summarize('归档提示'), '模型摘要');
        return { experience: archive, archivedCount: 2, remainingCount: 4 };
      },
    },
    '@/lib/agents/memory/agent-memory': { loadAgentMemoryContext: async options => { state.memoryReads++; assert.equal(options.agentId, 'agent-a'); assert.equal(options.query, '项目进度'); return '相关个人记忆'; } },
    '@/lib/agents/memory/context-compression': { estimateMessagesTokens: messages => messages.length * 10 },
    '@/app/api/_lib/agent-model': {
      loadAgentModelSetting: async (userId, agentId) => { assert.equal(userId, 'owner'); assert.equal(agentId, 'agent-a'); return { modelName: 'agent-model' }; },
      resolveUserModelConfig: (_user, setting) => ({ modelName: setting.modelName, apiBaseUrl: 'https://saved.test/v1', apiKey: 'saved-key' }),
    },
    '@/lib/core/model-client': {
      resolveModelName: name => name,
      createModelClient: (url, key) => {
        state.modelReads++; assert.equal(url, 'https://saved.test/v1'); assert.equal(key, 'saved-key');
        return { chat: { completions: { create: async (request, options) => {
          assert.equal(request.model, 'agent-model'); assert.equal(request.messages[0].content, '归档提示'); assert.equal(options.timeout, 25_000);
          return { choices: [{ message: { content: '模型摘要' } }] };
        } } } };
      },
    },
  });
  return { route, state, params };
}

test('agent context stats use owned recent originals independently of archive state and omit reasoning', async () => {
  const { route, state, params } = await contextRoute();
  const response = await route.GET({}, params);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const stats = await response.json();
  assert.equal(stats.contextLimit, 12);
  assert.equal(stats.totalCount, 8);
  assert.equal(stats.unarchivedCount, 6);
  assert.equal(stats.archivedCount, 2);
  assert.equal(stats.recentContextCount, 1);
  assert.equal(stats.recentContextTokens, 10);
  assert.equal(stats.experiences[0].messageCount, 2);
  assert.equal(stats.memoryContext, '相关个人记忆');
  assert.equal(state.modelReads, 0);
});

test('temporary agent context never reads private memory or archives into the agent timeline', async () => {
  const { route, state, params } = await contextRoute();
  state.mode = 'TEMPORARY';
  const response = await route.GET({}, params);
  assert.equal((await response.json()).canArchive, false);
  assert.equal(state.memoryReads, 0);
  assert.equal((await route.POST({ json: async () => ({ preserveRecent: 4 }) }, params)).status, 400);
  assert.equal(state.archiveCalls, 0);
});

test('agent context rejects unauthenticated and foreign conversation access before reading memory', async () => {
  const { route, state, params } = await contextRoute();
  state.authenticated = false;
  assert.equal((await route.GET({}, params)).status, 401);
  state.authenticated = true; state.owned = false;
  assert.equal((await route.GET({}, params)).status, 404);
  assert.equal((await route.POST({ json: async () => ({}) }, params)).status, 404);
  assert.equal(state.memoryReads, 0);
  assert.equal(state.modelReads, 0);
});

test('manual archive validates the preserve count and resolves the owned agent model', async () => {
  const { route, state, params } = await contextRoute();
  for (const preserveRecent of [0, -1, 21, 3.5, 'invalid']) {
    assert.equal((await route.POST({ json: async () => ({ preserveRecent }) }, params)).status, 400);
  }
  const response = await route.POST({ json: async () => ({ preserveRecent: 4, userId: 'other', agentId: 'other-agent', apiKey: 'injected', modelName: 'injected' }) }, params);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).archivedCount, 2);
  assert.equal(state.archiveCalls, 1);
  assert.equal(state.modelReads, 1);
});

test('archive source lookup restricts both the archive and its messages to the owned conversation', async () => {
  let valid = true;
  const route = await loadRoute('../../../app/api/conversations/[conversationId]/context/[experienceId]/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/app/api/_lib/auth': { requireAuth: () => 'owner' },
    '@/app/api/_lib/agent-personal-memory': { requireAgentMemoryAccess: async () => {} },
    '@/app/api/_lib/db': { default: {
      conversation: { findFirst: async () => ({ agentId: 'agent-a' }) },
      agentExperience: { findFirst: async ({ where }) => {
        assert.equal(where.userId, 'owner'); assert.equal(where.agentId, 'agent-a'); assert.equal(where.taskId.startsWith, 'chat:chat:'); assert.equal(where.status.not, 'DELETED');
        return valid ? { id: 'archive', tags: ['message:raw', 'message:foreign'] } : null;
      } },
      message: { findMany: async ({ where, select }) => {
        assert.equal(where.conversationId, 'chat'); assert.deepEqual([...where.id.in], ['raw', 'foreign']); assert.equal(select.attachments, undefined);
        return [{ id: 'raw', role: 'user', content: '原始对话', createdAt: new Date() }];
      } },
    } },
  });
  const params = { params: Promise.resolve({ conversationId: 'chat', experienceId: 'archive' }) };
  const response = await route.GET({}, params);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).experience.messages[0].content, '原始对话');
  valid = false;
  assert.equal((await route.GET({}, params)).status, 404);
});
