import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(relative, mocks) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, URL, console, require: name => {
      if (name in mocks) return mocks[name];
      if (name === 'next/server') return { NextResponse: { json: (value, options) => Response.json(value, options) } };
      throw Error(name);
    },
  });
  return exports;
}

test('mail profile API checks ownership and never includes app passwords; testing performs online verification', async () => {
  let verifies = 0;
  let failVerify = false;
  const mocks = {
    '@/app/api/_lib/auth': { requireAuth: request => { const user = request.headers.get('authorization'); if (!user) throw Error('Unauthorized'); return user; } },
    '@/app/api/_lib/personal-connectors': { testPersonalConnector: async (user, id) => {
      if (user !== 'alice' || id !== 'mail') throw Error('连接器不存在');
      return { url: 'connector:personal-mail', headers: { provider: 'qq', email: 'alice@qq.com', password: 'private-code' } };
    } },
    '@/lib/connectors/personal-mail.mjs': await import('./personal-mail.mjs'),
    '@/lib/connectors/feishu-cli.mjs': { FEISHU_URL: 'connector:feishu-cli' },
    '@/lib/connectors/client.mjs': { createConnectorClient: () => ({ listTools: async () => [{ name: 'search_emails' }], verify: async () => { verifies++; if (failVerify) throw Error('邮箱登录失败：请确认授权码'); } }) },
  };
  const profile = load('../../app/api/connectors/[connectorId]/mail/route.ts', mocks);
  const probe = load('../../app/api/connectors/[connectorId]/test/route.ts', mocks);
  const context = { params: Promise.resolve({ connectorId: 'mail' }) };
  const request = (user = '') => new Request('http://local/mail', { headers: user ? { authorization: user } : {} });
  assert.equal((await profile.GET(request(), context)).status, 401);
  assert.equal((await profile.GET(request('bob'), context)).status, 400);
  const result = await profile.GET(request('alice'), context);
  assert.deepEqual(await result.json(), { provider: 'qq', email: 'alice@qq.com' });
  assert.equal(verifies, 0);
  assert.equal((await probe.POST(request('bob'), context)).status, 400);
  assert.equal(verifies, 0);
  assert.equal((await probe.POST(request('alice'), context)).status, 200);
  assert.equal(verifies, 1);
  failVerify = true;
  const failed = await probe.POST(request('alice'), context);
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /邮箱登录失败/);
});

test('scope validation rejects other users spaces and private agents, and permits personal use of public/built-in agents', async () => {
  const db = {
    space: { findFirst: async ({ where }) => where.id === 'owned' && where.userId === 'alice' ? { id: 'owned' } : null },
    agent: { findFirst: async ({ where }) => where.id === 'public-agent' && where.OR[0].creatorId === 'alice' && where.OR[1].isPublic ? { id: 'public-agent' } : null },
  };
  const helper = load('../../app/api/_lib/personal-connectors.ts', {
    './db': { default: db },
    '@/lib/agents/data/agents-data': { getBuiltInAgents: async () => [{ id: 'builtin' }] },
    '@/lib/companion/agents': { findCompanionAgent: () => null },
    '@/lib/connectors/personal-store.mjs': await import('./personal-store.mjs'),
    '@/lib/personal-assistant/tool-broker.mjs': await import('../personal-assistant/tool-broker.mjs'),
    '@/lib/connectors/credentials.mjs': await import('./credentials.mjs'),
  });
  assert.equal((await helper.assertConnectorScope('alice', 'assistant', 'bob')).scopeId, 'alice');
  assert.equal((await helper.assertConnectorScope('alice', 'agent', 'builtin')).scopeId, 'builtin');
  assert.equal((await helper.assertConnectorScope('alice', 'agent', 'public-agent')).scopeId, 'public-agent');
  assert.equal((await helper.assertConnectorScope('alice', 'space', 'owned')).scopeId, 'owned');
  await assert.rejects(helper.assertConnectorScope('alice', 'space', 'other-space'), /无权/);
  await assert.rejects(helper.assertConnectorScope('alice', 'agent', 'private-agent'), /无权/);
  await assert.rejects(helper.assertConnectorScope('alice', 'studio', 'x'), /作用域/);
});

test('binding API checks authenticated scope before persisting and never accepts a userId supplied by the caller', async () => {
  const calls = [];
  const route = load('../../app/api/connectors/bindings/route.ts', {
    '@/app/api/_lib/db': { default: {} },
    '@/app/api/_lib/auth': { requireAuth: request => { if (!request.headers.get('Authorization')) throw Error('Unauthorized'); return 'alice'; } },
    '@/app/api/_lib/personal-connectors': { assertConnectorScope: async (userId, scope, scopeId) => {
      assert.equal(userId, 'alice');
      if (scopeId === 'bob-space') throw Error('无权管理此空间的连接器');
      return { scope, scopeId: scope === 'assistant' ? userId : scopeId };
    } },
    '@/lib/connectors/personal-store.mjs': { listConnectorBindings: async () => [], setConnectorBinding: async (...args) => calls.push(args.slice(1)) },
  });
  const request = (body, auth = true) => new Request('http://local/api/connectors/bindings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test' } : {}) }, body: JSON.stringify(body) });
  assert.equal((await route.PATCH(request({ scope: 'assistant', connectorId: 'a', enabled: true }, false))).status, 401);
  assert.equal((await route.PATCH(request({ scope: 'space', scopeId: 'bob-space', connectorId: 'a', enabled: true }))).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await route.PATCH(request({ userId: 'bob', scope: 'assistant', connectorId: 'a', enabled: true }))).status, 200);
  assert.deepEqual(calls[0], ['alice', 'assistant', 'alice', 'a', true]);
  assert.equal((await route.PATCH(request({ scope: 'assistant', connectorId: 'a', enabled: 'false' }))).status, 403);
  assert.equal(calls.length, 1);
});

test('unavailable Agents get an empty chat broker while binding and loaded tool access stay denied', async () => {
  let available = true, remoteCalls = 0, resolutions = 0;
  const { createAssistantToolBroker } = await import('../personal-assistant/tool-broker.mjs');
  const db = { agent: { findFirst: async () => available ? { id: 'custom' } : null } };
  const helper = load('../../app/api/_lib/personal-connectors.ts', {
    './db': { default: db },
    '@/lib/agents/data/agents-data': { getBuiltInAgents: async () => [] },
    '@/lib/companion/agents': { findCompanionAgent: () => null },
    '@/lib/connectors/personal-store.mjs': {
      ...(await import('./personal-store.mjs')),
      resolvePersonalConnectorServers: async () => { resolutions++; return [{ id: 'docs', url: 'https://example.test/mcp' }]; },
    },
    '@/lib/personal-assistant/tool-broker.mjs': {
      createAssistantToolBroker: options => createAssistantToolBroker({ ...options,
        clientFactory: () => ({ listTools: async () => [{ name: 'lookup' }], callTool: async () => { remoteCalls++; } }),
      }),
    },
    '@/lib/connectors/credentials.mjs': await import('./credentials.mjs'),
  });
  const loaded = await helper.createScopedConnectorBroker('alice', 'agent', 'custom');
  await loaded.call('mcp_load', { serverId: 'docs' });
  assert.ok(loaded.modelTools().some(tool => tool.function.name === 'mcp_docs_lookup'));
  available = false;
  const empty = await helper.createScopedConnectorBroker('alice', 'agent', 'custom');
  assert.deepEqual(empty.modelTools(), []);
  assert.equal(resolutions, 2);
  await assert.rejects(helper.assertConnectorScope('alice', 'agent', 'custom'), /无权/);
  await assert.rejects(loaded.call('mcp_docs_lookup'), /关闭或删除/);
  assert.equal(remoteCalls, 0);
});
