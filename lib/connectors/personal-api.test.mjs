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
