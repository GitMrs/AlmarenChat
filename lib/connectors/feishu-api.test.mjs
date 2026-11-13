import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import * as cli from './feishu-cli.mjs';
import { validateFeishuAuthDomains } from './feishu-auth-domains.mjs';

process.env.SPACE_CONNECTOR_SECRET = 'feishu-api-test-secret-at-least-32-characters';
const server = { url: cli.FEISHU_URL, connectorId: 'connector', userId: 'alice', id: 'feishu-cli', headers: { appId: 'cli_test', appSecret: 'secret' } };
async function fixture(t, authImpl) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'almaren-feishu-api-'));
  const previous = process.env.FEISHU_CLI_DATA_ROOT; process.env.FEISHU_CLI_DATA_ROOT = root;
  t.after(async () => { if (previous === undefined) delete process.env.FEISHU_CLI_DATA_ROOT; else process.env.FEISHU_CLI_DATA_ROOT = previous; await rm(root, { recursive: true, force: true }); });
  const calls = [];
  const mocks = {
    'next/server': { NextResponse: { json: (value, options) => Response.json(value, options) } },
    'node:fs/promises': await import('node:fs/promises'), 'node:path': { default: path },
    '@/app/api/_lib/db': { default: { $queryRawUnsafe: async () => [{ scope: 'agent', scopeId: 'lulu' }] } },
    '@/app/api/_lib/auth': { requireAuth: request => { if (!request.headers.get('authorization')) throw Error('Unauthorized'); return request.headers.get('authorization'); } },
    '@/app/api/_lib/personal-connectors': {
      testPersonalConnector: async (userId, id) => { if (userId !== 'alice' || id !== 'connector') throw Error('连接器不存在'); return server; },
      assertConnectorScope: async (userId, scope, scopeId) => { if (userId !== 'alice' || scope !== 'agent' || scopeId !== 'lulu') throw Error('无权使用此入口'); return { scope, scopeId }; },
    },
    '@/lib/connectors/personal-store.mjs': { listConnectorBindings: async () => ['connector'] },
    '@/lib/connectors/client.mjs': { createConnectorClient: () => ({ listTools: async () => [] }) },
    '@/lib/connectors/feishu-events.mjs': { callFeishuEvents: (server, input) => ({ scopeId: server.scopeId, action: input.action }) },
    '@/lib/connectors/feishu-cli.mjs': {
      ...cli,
      feishuAuth: authImpl || (async (_server, action, options) => ({ botAvailable: true, action, domains: action === 'start' ? validateFeishuAuthDomains(options?.domains) : undefined })),
      prepareFeishu: async scoped => { const dirs = cli.feishuPaths(scoped); await mkdir(dirs.files, { recursive: true }); return { dirs, env: {} }; },
      runFeishu: async (argv, options) => { calls.push({ argv, options }); return { code: 0, stdout: '{}', stderr: '' }; },
    },
  };
  const source = readFileSync(new URL('../../app/api/connectors/[connectorId]/feishu/route.ts', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, Buffer, URL, console, require: name => { if (!(name in mocks)) throw Error(name); return mocks[name]; } });
  const testExports = {};
  const testSource = readFileSync(new URL('../../app/api/connectors/[connectorId]/test/route.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(testSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports: testExports, console, require: name => { if (!(name in mocks)) throw Error(name); return mocks[name]; } });
  const context = { params: Promise.resolve({ connectorId: 'connector' }) };
  const post = (body, auth = 'alice') => exports.POST(new Request('http://local/feishu', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) }), context);
  return { calls, post, get: () => exports.GET(new Request('http://local/feishu', { headers: { authorization: 'alice' } }), context),
    verify: () => testExports.POST(new Request('http://local/test', { method: 'POST', headers: { authorization: 'alice' } }), context) };
}

test('Feishu endpoints enforce ownership and scope before auth, files and subscriptions', async t => {
  const f = await fixture(t);
  assert.equal((await f.post({ action: 'start' }, '')).status, 401);
  assert.equal((await f.post({ action: 'start' }, 'bob')).status, 400);
  assert.equal((await f.post({ action: 'upload', scope: 'agent', scopeId: 'other', name: 'x', base64: '' })).status, 400);
  assert.equal((await f.post({ action: 'events', scope: 'agent', scopeId: 'other', event: { action: 'start' } })).status, 400);
  const response = await f.post({ action: 'events', scope: 'agent', scopeId: 'lulu', event: { action: 'list' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).scopeId, 'lulu');
});

test('uploads stay in the selected binding file area and cannot overwrite or traverse', async t => {
  const f = await fixture(t);
  const body = { action: 'upload', scope: 'agent', scopeId: 'lulu', name: 'hello.txt', base64: Buffer.from('你好').toString('base64') };
  assert.equal((await f.post(body)).status, 200);
  assert.equal(await readFile(path.join(cli.feishuPaths({ ...server, scope: 'agent', scopeId: 'lulu' }).files, 'hello.txt'), 'utf8'), '你好');
  assert.equal((await f.post(body)).status, 400);
  assert.equal((await f.post({ ...body, name: '../config.json' })).status, 400);
});

test('authorization API forwards the explicit function selection and rejects blanket requests', async t => {
  const f = await fixture(t);
  for (const domains of [undefined, [], ['all'], ['unknown']]) {
    assert.equal((await f.post({ action: 'start', domains })).status, 400);
  }
  const response = await f.post({ action: 'start', domains: ['docs', 'calendar'] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).domains, ['docs', 'calendar']);
});

test('opening connection management returns local state without invoking app initialization or online authorization', async t => {
  const calls = [];
  const f = await fixture(t, (server, action) => cli.feishuAuth(server, action, {
    platform: 'linux', run: async argv => { calls.push(argv); throw Error('unexpected online CLI operation'); },
  }));
  const response = await f.get();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status.userAvailable, false);
  assert.equal(calls.length, 0);
});

test('explicit connection testing cannot pass using a cached identity when online verification is rejected', async t => {
  const actions = [];
  const f = await fixture(t, async (_server, action) => {
    actions.push(action);
    if (action === 'verify') throw Error('Access denied due to platform policy');
    return { botAvailable: true, userAvailable: false };
  });
  assert.equal((await f.get()).status, 200);
  const response = await f.verify();
  assert.equal(response.status, 400);
  assert.equal((await response.json()).ok, false);
  assert.deepEqual(actions, ['status', 'verify']);
});

test('only explicit owner approval executes a stored command, and concurrent/replayed approvals execute once', async t => {
  const f = await fixture(t);
  const id = '11111111-1111-1111-1111-111111111111';
  await cli.feishuState(server, `approval-${id}`, { argv: ['drive', '+delete', '--file-token', 'token'], stdin: 'review-me', scope: 'agent', scopeId: 'lulu', expiresAt: Date.now() + 10000 });
  const view = await (await f.get()).json();
  assert.equal(view.pending[0].stdin, 'review-me');
  assert.equal((await f.post({ action: 'approve', approvalId: id }, 'bob')).status, 400);
  assert.equal(f.calls.length, 0);
  const responses = await Promise.all([f.post({ action: 'approve', approvalId: id }), f.post({ action: 'approve', approvalId: id })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].argv.at(-1), '--yes');
  assert.equal((await f.post({ action: 'approve', approvalId: id })).status, 400);
});
