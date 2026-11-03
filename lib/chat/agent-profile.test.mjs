import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as prompts from './agent-prompt.mjs';
import * as reasoning from './reasoning.mjs';
import * as retrieval from '../personal-assistant/retrieval-notice.mjs';

const require = createRequire(import.meta.url);
const rawAgents = JSON.parse(await readFile(new URL('../../src/lib/agent.json', import.meta.url), 'utf8'));
const rawLulu = rawAgents.find(agent => agent.identifier === 'gaming-lulu');
const lulu = {
  id: rawLulu.identifier, name: rawLulu.meta.title,
  description: rawLulu.meta.description, systemPrompt: rawLulu.description, tone: '幽默',
};

async function callRoute({ qq = false, custom = false, requestedAgentId } = {}) {
  const agentId = custom ? 'custom-agent' : lulu.id;
  const conversation = {
    id: 'conversation', agentId, agentMode: 'MAIN',
    agentName: '旧名称', agentDescription: '旧简介',
    agentSystemPrompt: '旧版专属游戏开黑搭子提示词', agentTone: '旧语气',
  };
  const saved = [];
  let modelMessages;
  const db = {
    user: { findUnique: async () => ({ email: 'test@example.com' }) },
    agent: { findUnique: async () => ({ id: agentId, systemPrompt: '数据库中的旧人设' }) },
    conversation: { findFirst: async () => conversation, update: async () => ({}) },
    message: {
      findMany: async () => [], findUnique: async () => null,
      create: async ({ data }) => { saved.push(data); return { id: 'message', ...data }; },
    },
    agentQQBinding: { findUnique: async () => ({
      id: 'binding', userId: 'user', agentId, conversationId: 'conversation',
      enabled: true, botAccount: { enabled: true, appId: 'app' },
    }) },
    $transaction: async operations => Promise.all(operations),
  };
  const mocks = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/app/api/_lib/db': { default: db },
    '@/app/api/_lib/auth': { requireAuth: () => 'user' },
    '@/lib/agents/data/agents-data': { getBuiltInAgents: async () => [lulu] },
    '@/lib/companion/agents': { findCompanionAgent: () => undefined },
    '@/lib/companion/reply-protocol.mjs': {},
    '@/lib/chat/agent-prompt.mjs': prompts,
    '@/lib/chat/reasoning.mjs': reasoning,
    '@/lib/personal-assistant/retrieval-notice.mjs': retrieval,
    '@/lib/chat/chat-quota': { reserveChatQuota: async () => null },
    '@/app/api/_lib/agent-model': {
      loadAgentModelSetting: async () => null,
      resolveUserModelConfig: () => ({ apiBaseUrl: 'https://example.test', apiKey: 'fixture', modelName: 'fixture' }),
    },
    '@/lib/core/model-client': { createModelClient: () => ({}), resolveModelName: name => name },
    '@/lib/memory/conversation-context': {
      prepareConversationContext: async input => ({
        messages: [{ role: 'system', content: input.requiredSystem }, input.currentMessage],
        history: [], manifest: {},
      }),
      recordConversationUsage: async () => {},
    },
    '@/lib/memory/memory-tools': { createMemoryTools: () => ({ tools: [] }) },
    '@/lib/chat/recent-state-store': { syncRecentStates: async () => [], applyRecentStateMessage: async () => {} },
    '@/lib/chat/conversation-grounding.mjs': { CONVERSATION_GROUNDING_GUIDANCE: '' },
    '@/lib/chat/conversation-continuity.mjs': { buildRecentStateContinuityGuidance: () => '' },
    '@/lib/chat/model-time-log.mjs': { logModelTimeContext() {} },
    '@/lib/agents/memory/current-time-context.mjs': { currentTimeContext: () => '' },
    '@/lib/memory/context-dispatcher.mjs': { planContextSources: () => ({}), dispatchContextCandidates: () => [] },
    '@/lib/agents/memory/agent-memory': {},
    '@/lib/world/context': {},
    '@/lib/knowledge/knowledge': {},
    '@/lib/agents/growth/agent-growth': { createAgentGrowthTools: () => ({ tools: [] }) },
    '@/app/api/_lib/agent-personal-memory': { archiveAgentChat: async () => {} },
    '@/lib/qq-assistant/credentials.mjs': { isValidInternalQQSecret: () => true },
    '@/lib/qq-assistant/policy.mjs': { qqImageAttachments: () => [] },
    '@/lib/web/auto-web': {
      createChatWebTools: () => ({ attachments: () => [] }),
      runAutoWebChat: async ({ messages, onText }) => {
        modelMessages = messages;
        onText?.('测试回复');
        return '测试回复';
      },
    },
  };
  const file = qq ? '../../app/api/internal/agents/qq/messages/route.ts' : '../../app/api/chat/route.ts';
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports, console, Response, ReadableStream, TextEncoder, AbortController,
    require: name => name in mocks ? mocks[name] : name.startsWith('node:') ? require(name) : (() => { throw Error(name); })(),
  });
  const request = new Request('http://test/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bindingId: 'binding', userId: 'user', eventId: 'event',
      agentId: requestedAgentId || agentId, conversationId: 'conversation', message: '你好',
      agentSnapshot: { name: '客户端旧名称', systemPrompt: '客户端旧人设' },
    }),
  });
  const response = await exports.POST(request);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  assert.doesNotMatch(body, /"type":"error"/);
  assert.equal(saved.filter(item => item.role === 'user').length, 1);
  assert.equal(saved.filter(item => item.role === 'assistant').length, 1);
  return modelMessages[0].content;
}

for (const qq of [false, true]) {
  test(`${qq ? 'QQ' : 'web'} Agent chat uses current JSON persona over old conversation and database profiles`, async () => {
    const identity = await callRoute({ qq });
    assert.ok(identity.startsWith(rawLulu.description));
    assert.ok(identity.includes(`【角色描述】${rawLulu.meta.description}`));
    assert.ok(identity.includes(`「${rawLulu.meta.title}」`));
    assert.doesNotMatch(identity, /旧名称|旧简介|旧人设|旧版专属/);
  });
}

test('existing web conversation Agent ID takes precedence over the client supplied ID', async () => {
  const identity = await callRoute({ requestedAgentId: 'another-agent' });
  assert.ok(identity.startsWith(rawLulu.description));
});

test('custom Agent chats preserve their saved persona', async () => {
  for (const qq of [false, true]) {
    const identity = await callRoute({ qq, custom: true });
    assert.match(identity, /^旧版专属游戏开黑搭子提示词/);
    assert.match(identity, /「旧名称」/);
  }
});
