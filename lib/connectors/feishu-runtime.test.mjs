import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { checkFeishuRuntime } from './feishu-runtime.mjs';

test('missing CLI is reported without initializing credentials or exposing process errors', async () => {
  const calls = [];
  const result = await checkFeishuRuntime({ platform: 'win32', binary: 'missing.exe', run: async (...args) => { calls.push(args); throw Object.assign(Error('private server path'), { code: 'ENOENT' }); } });
  assert.equal(result.ready, false);
  assert.equal(result.cli.status, 'missing');
  assert.equal(result.sandbox.status, 'directory');
  assert.deepEqual(calls[0][1], ['--version']);
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].env.SPACE_CONNECTOR_SECRET, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private server path/);
});

test('CLI versions must match the pinned release, including v-prefixed version output', async () => {
  for (const [stdout, expected] of [['lark-cli version v1.0.100', true], ['lark-cli version 1.0.99', false], ['unknown', false], ['1.0.100-beta.1', false]]) {
    const result = await checkFeishuRuntime({ platform: 'win32', run: async () => ({ stdout, stderr: '' }) });
    assert.equal(result.ready, expected, stdout);
  }
});

test('Linux distinguishes a missing sandbox from namespace restrictions and ready runtime', async () => {
  for (const state of ['missing', 'blocked', 'ready']) {
    const calls = [];
    const result = await checkFeishuRuntime({ platform: 'linux', binary: '/runtime/lark-cli', run: async (binary, args) => {
      calls.push([binary, args]);
      if (binary === '/usr/bin/bwrap' && state === 'missing') throw Object.assign(Error(), { code: 'ENOENT' });
      if (binary === '/usr/bin/bwrap' && args.includes('--unshare-user') && state === 'blocked') throw Object.assign(Error(), { code: 1 });
      return { stdout: binary === '/runtime/lark-cli' ? 'lark-cli 1.0.100' : 'bubblewrap 0.11', stderr: '' };
    } });
    assert.equal(result.ready, state === 'ready');
    assert.equal(result.sandbox.status, state === 'blocked' ? 'error' : state);
    if (state !== 'missing') assert.ok(calls.some(([, args]) => args.includes('--unshare-user')));
  }
});

test('timeout and unsupported platforms cannot appear ready', async () => {
  const failure = await checkFeishuRuntime({ platform: 'win32', run: async () => { throw Object.assign(Error(), { killed: true }); } });
  assert.equal(failure.cli.status, 'error');
  assert.equal(failure.ready, false);
  const unsupported = await checkFeishuRuntime({ platform: 'freebsd', run: async () => { throw Error('must not execute'); } });
  assert.equal(unsupported.cli.status, 'unsupported');
  assert.equal(unsupported.ready, false);
});

test('runtime inspection requires login but no saved connector or application credentials', async () => {
  let calls = 0;
  const exports = {};
  const mocks = {
    'next/server': { NextResponse: { json: (value, options) => Response.json(value, options) } },
    '@/app/api/_lib/auth': { requireAuth: request => { if (!request.headers.has('authorization')) throw Error('Unauthorized'); return 'alice'; } },
    '@/lib/connectors/feishu-runtime.mjs': { checkFeishuRuntime: async () => { calls++; return { ready: false, cli: { status: 'missing' } }; } },
  };
  const source = readFileSync(new URL('../../app/api/connectors/feishu/runtime/route.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => { if (!(name in mocks)) throw Error(name); return mocks[name]; } });
  assert.equal(exports.POST, undefined, 'the web runtime endpoint must not offer server installation');
  assert.equal((await exports.GET(new Request('http://local/runtime'))).status, 401);
  assert.equal(calls, 0);
  const result = await exports.GET(new Request('http://local/runtime', { headers: { authorization: 'alice' } }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).cli.status, 'missing');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(calls, 1);
});

test('macOS requires a working system sandbox, reports failures safely and checks the pinned CLI', async () => {
  for (const state of ['ready', 'missing', 'blocked']) {
    const calls = [];
    const result = await checkFeishuRuntime({ platform: 'darwin', binary: '/test/lark-cli', run: async (binary, args, options) => {
      calls.push([binary, args, options]);
      if (binary === '/usr/bin/sandbox-exec' && state !== 'ready') throw Object.assign(Error('private error'), { code: state === 'missing' ? 'ENOENT' : 'EPERM' });
      return { stdout: 'lark-cli 1.0.100' };
    } });
    assert.equal(result.ready, state === 'ready');
    assert.equal(result.sandbox.status, state === 'blocked' ? 'error' : state);
    assert.ok(calls.some(([binary, args]) => binary === '/usr/bin/sandbox-exec' && args.at(-1) === '/usr/bin/true'));
    assert.doesNotMatch(JSON.stringify(result), /private error/);
    for (const [, , options] of calls) assert.equal(options.shell, false);
  }
});
