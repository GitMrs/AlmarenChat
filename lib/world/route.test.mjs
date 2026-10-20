import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function loadRoute() {
  const loads = [];
  const reads = [];
  const history = [{ role: 'user', content: '今晚ADP' }, { role: 'user', content: '那结果呢？' }];
  const source = await readFile(new URL('../../app/api/conversations/[conversationId]/world-context/route.ts', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Error,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (body, options) => Response.json(body, options) } };
      if (name.endsWith('/auth')) return { requireAuth: request => {
        const id = request.headers.get('Authorization');
        if (!id) throw new Error('Unauthorized');
        return id;
      } };
      if (name.endsWith('/db')) return { default: {
        conversation: { findFirst: async ({ where }) => {
          reads.push(where);
          return where.userId === 'owner' && where.id === 'owned' && where.kind === 'AGENT' ? { agentId: 'fx-kurumi' } : null;
        } },
        message: { findMany: async ({ where }) => { assert.equal(where.conversationId, 'owned'); return [...history].reverse(); } },
      } };
      if (name === '@/lib/world/context') return { loadAgentWorldContext: async options => { loads.push(options); return 'shared-world-context'; } };
      throw new Error(name);
    },
  });
  const post = (user = 'owner', body = { query: '那结果呢？', agentId: 'spoofed-agent' }, id = 'owned') => exports.POST(new Request('http://localhost/api/conversations/owned/world-context', {
    method: 'POST', headers: user ? { Authorization: user } : {}, body: JSON.stringify(body),
  }), { params: Promise.resolve({ conversationId: id }) });
  return { post, loads, reads, history };
}

test('browser-model context is scoped to the authenticated conversation and ignores client-supplied agent identity', async () => {
  const route = await loadRoute();
  const response = await route.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { context: 'shared-world-context' });
  assert.equal(route.loads[0].agentId, 'fx-kurumi');
  assert.deepEqual(route.loads[0].history, route.history);
  assert.equal(route.loads[0].query, '那结果呢？');
});

test('unauthenticated, another user, another conversation and invalid queries cannot read event context', async () => {
  const route = await loadRoute();
  assert.equal((await route.post('')).status, 401);
  assert.equal((await route.post('other-user')).status, 404);
  assert.equal((await route.post('owner', { query: 'ADP' }, 'another')).status, 404);
  assert.equal((await route.post('owner', { query: 123 })).status, 400);
  assert.equal((await route.post('owner', { query: 'a'.repeat(20_001) })).status, 400);
  assert.equal(route.loads.length, 0);
});
