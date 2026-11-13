import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createFeishuCliClient, feishuAuth, feishuPaths, feishuEnvironment, feishuState, prepareFeishu, runFeishu, spawnFeishu, validateFeishuArgs, safeFeishuFile, feishuSandboxArgs, validateFeishuFiles, redactFeishuResult } from './feishu-cli.mjs';

process.env.SPACE_CONNECTOR_SECRET = 'feishu-test-secret-at-least-32-characters';
const server = { userId: 'alice', connectorId: 'connector', id: 'feishu-cli', scope: 'agent', scopeId: 'lulu', headers: { appId: 'cli_test', appSecret: 'private-app-secret' } };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'almaren-feishu-'));
  const previous = process.env.FEISHU_CLI_DATA_ROOT;
  process.env.FEISHU_CLI_DATA_ROOT = root;
  t.after(async () => { if (previous === undefined) delete process.env.FEISHU_CLI_DATA_ROOT; else process.env.FEISHU_CLI_DATA_ROOT = previous; await rm(root, { recursive: true, force: true }); });
  const calls = [];
  const run = async (argv, options) => { calls.push({ argv, options }); return { code: 0, stdout: '{}', stderr: '' }; };
  return { root, calls, run };
}

test('config, keychain and files isolate accounts and scopes; ambient credentials are never inherited', async t => {
  const f = await fixture(t);
  const prepared = await prepareFeishu(server, { run: f.run, platform: 'linux' });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.stdin, server.headers.appSecret);
  assert.equal(f.calls[0].argv.includes(server.headers.appSecret), false);
  await prepareFeishu(server, { run: f.run, platform: 'linux' });
  assert.equal(f.calls.length, 1);
  const bob = feishuPaths({ ...server, userId: 'bob' });
  const other = feishuPaths({ ...server, scopeId: 'other' });
  assert.notEqual(bob.account, prepared.dirs.account);
  assert.equal(other.account, prepared.dirs.account);
  assert.notEqual(other.files, prepared.dirs.files);
  assert.notEqual(feishuPaths({ ...server, headers: { ...server.headers, appSecret: 'changed' } }).account, prepared.dirs.account);
  const env = feishuEnvironment(prepared.dirs, { PATH: '/bin', DATABASE_URL: 'secret', LARKSUITE_CLI_APP_SECRET: 'other', LARKSUITE_CLI_PROFILE: 'other' });
  assert.equal(env.DATABASE_URL, undefined); assert.equal(env.LARKSUITE_CLI_PROFILE, undefined);
  assert.equal(env.LARKSUITE_CLI_DATA_DIR, prepared.dirs.data);
  await assert.rejects(prepareFeishu(server, { run: f.run, platform: 'freebsd' }), /Linux、macOS 和 Windows/);
});

test('user device login persists encrypted pending code, hides secrets and expires requests', async t => {
  const f = await fixture(t);
  const run = async (argv, options) => {
    await f.run(argv, options);
    if (argv.includes('--no-wait')) return { code: 0, stdout: JSON.stringify({ device_code: 'secret-device-code', verification_uri: 'https://accounts.feishu.cn/auth', expires_in: 600 }), stderr: '' };
    if (argv[1] === 'status') return { code: 0, stdout: JSON.stringify({ identities: { bot: { available: true }, user: { available: true, refreshToken: 'NEVER-PUBLISH' } } }), stderr: '' };
    return { code: 0, stdout: '{}', stderr: '' };
  };
  const options = { run, platform: 'linux', domains: ['docs', 'calendar', 'docs'] };
  const start = await feishuAuth(server, 'start', options);
  assert.deepEqual(f.calls.at(-1).argv, ['auth', 'login', '--no-wait', '--json', '--domain', 'docs,calendar']);
  assert.deepEqual((await feishuState(server, 'login')).domains, ['docs', 'calendar']);
  assert.equal(start.verificationUrl, 'https://accounts.feishu.cn/auth');
  assert.doesNotMatch(JSON.stringify(start), /secret-device-code/);
  assert.doesNotMatch(await readFile(path.join(feishuPaths(server).account, 'login.enc'), 'utf8'), /secret-device-code/);
  const completed = await feishuAuth(server, 'complete', options);
  assert.equal(completed.userAvailable, true);
  assert.doesNotMatch(JSON.stringify(completed), /NEVER-PUBLISH/);
  await feishuState(server, 'login', { deviceCode: 'expired', expiresAt: 1 });
  await assert.rejects(feishuAuth(server, 'complete', options), /过期/);
});

test('reading uninitialized settings never initializes the CLI or makes an authorization request', async t => {
  const f = await fixture(t);
  const status = await feishuAuth(server, 'status', { run: f.run, platform: 'linux' });
  assert.deepEqual(status, { botAvailable: false, userAvailable: false, refreshExpiresAt: null });
  assert.equal(f.calls.length, 0);
  await assert.rejects(readFile(path.join(feishuPaths(server).account, 'initialized')), { code: 'ENOENT' });
});

test('automatic status is local while explicit verification still checks the server and rejects unusable identities', async t => {
  const f = await fixture(t);
  await prepareFeishu(server, { run: f.run, platform: 'linux' });
  const calls = [];
  let verified = true;
  const run = async argv => {
    calls.push(argv);
    return { code: 0, stdout: JSON.stringify({ identities: { bot: { available: true, verified }, user: { available: false } } }), stderr: '' };
  };
  assert.equal((await feishuAuth(server, 'status', { run, platform: 'linux' })).botAvailable, true);
  assert.deepEqual(calls[0], ['auth', 'status', '--json']);
  assert.equal((await feishuAuth(server, 'verify', { run, platform: 'linux' })).botAvailable, true);
  assert.deepEqual(calls[1], ['auth', 'status', '--json', '--verify']);
  verified = false;
  await assert.rejects(feishuAuth(server, 'verify', { run, platform: 'linux' }), /验证飞书身份失败/);
});

test('an initialization policy rejection is labelled and never starts device authorization', async t => {
  const f = await fixture(t);
  const calls = [];
  const run = async argv => { calls.push(argv); return { code: 1, stdout: '', stderr: '{"error":{"message":"The requested scope is blocked by data security policy"}}' }; };
  await assert.rejects(feishuAuth(server, 'start', { run, platform: 'linux', domains: ['im'] }), /飞书应用初始化失败：The requested scope is blocked/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'config');
  assert.equal((await feishuAuth(server, 'status', { run, platform: 'linux' })).userAvailable, false);
  assert.equal(calls.length, 1);
  await assert.rejects(readFile(path.join(feishuPaths(server).account, 'initialized')), { code: 'ENOENT' });
});

test('authorization rejects missing, empty, unknown and all-domain requests before invoking the CLI', async t => {
  const f = await fixture(t);
  for (const domains of [undefined, null, [], 'docs', ['all'], ['docs,calendar'], ['docs', '--recommend'], [null]]) {
    await assert.rejects(feishuAuth(server, 'start', { run: f.run, platform: 'linux', domains }), /请选择需要授权/);
  }
  assert.equal(f.calls.length, 0);
});

test('failed replacement authorization invalidates the previous pending device code', async t => {
  const f = await fixture(t);
  await prepareFeishu(server, { run: f.run, platform: 'linux' });
  await feishuState(server, 'login', { deviceCode: 'old-code', expiresAt: Date.now() + 600000 });
  const run = async () => ({ code: 1, stdout: '', stderr: '{"error":{"message":"Access denied due to platform policy"}}' });
  await assert.rejects(feishuAuth(server, 'start', { run, platform: 'linux', domains: ['docs'] }), /platform policy/);
  assert.deepEqual(await feishuState(server, 'login'), {});
  await assert.rejects(feishuAuth(server, 'complete', { run, platform: 'linux' }), /过期/);
});

test('complete command surface supports arbitrary domains and official embedded guides while blocking lifecycle overrides', async t => {
  const f = await fixture(t);
  const client = createFeishuCliClient(server, { run: f.run, platform: 'linux' });
  await client.callTool('help', { command: ['mail'] });
  await client.callTool('run', { argv: ['sheets', '+read', '--spreadsheet-token', 'example'], identity: 'user' });
  await client.callTool('run', { argv: ['api', 'GET', '/open-apis/example'], stdin: '{"hello":"世界"}' });
  await client.callTool('guide', { skill: 'lark-doc', reference: 'references/lark-doc-fetch.md' });
  assert.deepEqual(f.calls.at(-1).argv, ['skills', 'read', 'lark-doc', 'references/lark-doc-fetch.md']);
  assert.ok(f.calls.some(call => call.argv[0] === 'sheets' && call.argv.includes('--as')));
  assert.ok(f.calls.some(call => call.options.stdin.includes('世界')));
  for (const argv of [['auth', 'login'], ['config', 'show'], ['profile', 'use', 'bob'], ['docs', '--profile=other'], ['docs', '+delete', '--yes'], ['event', '--as', 'bot', 'consume', 'im.message.receive_v1'], ['sh', '-c', 'anything\0']]) assert.throws(() => validateFeishuArgs(argv));
});

test('high risk response creates a scope-bound encrypted approval without rerunning automatically', async t => {
  const f = await fixture(t);
  const run = async (argv, options) => { await f.run(argv, options); return { code: argv[0] === 'config' ? 0 : 10, stdout: '', stderr: '{"error":{"type":"confirmation","subtype":"confirmation_required"}}' }; };
  const result = await createFeishuCliClient(server, { run, platform: 'linux' }).callTool('run', { argv: ['drive', '+delete', '--file-token', 'doc'], stdin: 'payload' });
  assert.equal(result.confirmationRequired, true);
  const pending = await feishuState(server, `approval-${result.approvalId}`);
  assert.equal(pending.scopeId, 'lulu'); assert.equal(pending.stdin, 'payload');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls.some(call => call.argv.includes('--yes')), false);
});

test('relative file access rejects traversal, absolute paths and symlinks', async t => {
  const f = await fixture(t);
  const { dirs } = await prepareFeishu(server, { run: f.run, platform: 'linux' });
  await writeFile(path.join(dirs.files, 'sample.txt'), 'sample');
  assert.equal(await safeFeishuFile(dirs.files, 'sample.txt', { mustExist: true }), path.join(dirs.files, 'sample.txt'));
  for (const name of ['../secret', '/etc/passwd', 'nested/../../x', 'a\\b', 'a/./b']) await assert.rejects(safeFeishuFile(dirs.files, name));
  if (process.platform !== 'win32') {
    await symlink(f.root, path.join(dirs.files, 'escape'));
    await assert.rejects(safeFeishuFile(dirs.files, 'escape/x'), /符号链接/);
  }
});

test('subprocess runner preserves argv and stdin without shell parsing and reports nonzero exits', async () => {
  const result = await runFeishu(['literal;$(not-a-command)', '中文'], {
    stdin: 'hello',
    spawnImpl: (argv, options) => spawn(process.execPath, ['-e', "let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{console.log(JSON.stringify({args:process.argv.slice(1),input}));console.error('diagnostic');process.exitCode=3})", ...argv], { ...options, shell: false, windowsHide: true }),
  });
  assert.equal(result.code, 3);
  assert.deepEqual(JSON.parse(result.stdout), { args: ['literal;$(not-a-command)', '中文'], input: 'hello' });
  assert.equal(result.stderr, 'diagnostic');
});

test('sandbox exposes only selected state and files; sensitive outputs and outside file flags are blocked', async t => {
  const f = await fixture(t);
  const { dirs, env } = await prepareFeishu(server, { run: f.run, platform: 'linux' });
  const argv = feishuSandboxArgs(['docs', '+fetch'], { env, cwd: dirs.files, binary: '/opt/lark-cli' });
  assert.ok(argv.includes('--unshare-pid'));
  assert.ok(argv.includes('--die-with-parent'));
  assert.ok(argv.includes('/workspace'));
  assert.equal(argv.includes(dirs.root), false); assert.equal(argv.includes('/app'), false);
  assert.equal(argv.filter(value => value === '--bind').length, 3);
  await assert.rejects(validateFeishuFiles(dirs.files, ['apps', '+upload', '--file', '../secret']), /相对路径/);
  await assert.rejects(validateFeishuFiles(dirs.files, ['api', 'POST', '/open-apis/x', '--data=@/tmp/another-user']), /相对路径/);
  assert.doesNotMatch(redactFeishuResult({ stdout: '{"access_token":"private-token"}', stderr: server.headers.appSecret }, server).stdout, /private-token/);
  assert.equal(redactFeishuResult({ stdout: '', stderr: server.headers.appSecret }, server).stderr, '[redacted]');
});

test('Windows native execution preserves literal arguments, stdin and isolated working directories', async t => {
  const f = await fixture(t);
  const { dirs, env } = await prepareFeishu(server, { run: f.run, platform: 'win32' });
  assert.ok(env.APPDATA.startsWith(dirs.data));
  assert.ok(env.LOCALAPPDATA.startsWith(dirs.data));
  assert.ok(env.TEMP.startsWith(dirs.account));
  assert.notEqual(feishuEnvironment(feishuPaths({ ...server, userId: 'bob' })).TEMP, env.TEMP);
  const result = await runFeishu(['-e', "let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>console.log(JSON.stringify({arg:process.argv[1],input,cwd:process.cwd(),config:process.env.LARKSUITE_CLI_CONFIG_DIR})))", 'hello & $(literal) 中文'], {
    env, cwd: dirs.files, stdin: 'private input',
    spawnImpl: (argv, options) => spawnFeishu(argv, { ...options, binary: process.execPath, platform: 'win32' }),
  });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { arg: 'hello & $(literal) 中文', input: 'private input', cwd: dirs.files, config: dirs.config });
  const calls = [];
  spawnFeishu(['docs', '--help'], { env, cwd: dirs.files, binary: '/opt/cli', platform: 'linux', spawnImpl: (...args) => { calls.push(args); return null; } });
  assert.equal(calls[0][0], '/usr/bin/bwrap');
  assert.equal(calls[0][2].shell, false);
});
