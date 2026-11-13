import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function route(file, mocks) {
  const exports = {};
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, URL, require: name => { if (!(name in mocks)) throw Error(name); return mocks[name]; },
  });
  return exports;
}
const response = { NextResponse: { json: (body, options) => Response.json(body, options) } };

test('targets expose only owned spaces and allowed agents, with current-user bindings and readable names', async () => {
  const queries = {};
  const api = await route('../../app/api/connectors/targets/route.ts', {
    'next/server': response,
    '@/app/api/_lib/auth': { requireAuth: request => { if (!request.headers.has('authorization')) throw Error('Unauthorized'); return 'alice'; } },
    '@/lib/agents/data/agents-data': { getBuiltInAgents: async () => [{ id: 'builtin', name: '内置' }] },
    '@/app/api/_lib/db': { default: {
      agent: { findMany: async query => { queries.agent = query; return [{ id: 'builtin', name: '内置' }, { id: 'mine', name: '我的助手' }]; } },
      space: { findMany: async query => { queries.space = query; return [{ id: 'space-a', name: '工作空间' }]; } },
      $queryRawUnsafe: async (sql, userId) => { queries.binding = { sql, userId }; return [{ scope: 'assistant', scopeId: 'alice', connectorId: 'feishu' }]; },
    } },
  });
  assert.equal((await api.GET(new Request('http://local'))).status, 401);
  assert.equal(Object.keys(queries).length, 0);
  const result = await api.GET(new Request('http://local', { headers: { authorization: 'alice' } }));
  const { targets } = await result.json();
  assert.equal(targets.length, 4);
  assert.deepEqual(targets[0], { scope: 'assistant', scopeId: 'alice', name: '小伴', connectorIds: ['feishu'] });
  assert.equal(targets.find(target => target.scope === 'space').name, '工作空间');
  assert.equal(JSON.stringify(queries.agent.where), JSON.stringify({ OR: [{ creatorId: 'alice' }, { isPublic: true }] }));
  assert.equal(queries.space.where.userId, 'alice');
  assert.equal(queries.binding.userId, 'alice');
  assert.match(queries.binding.sql, /WHERE "userId" = \?/);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});
