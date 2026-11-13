import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, realpath, rm, lstat, unlink, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { macosSandboxProbeArgs, macosKeychainDirectory, prepareMacosFeishu } from './feishu-macos.mjs';
import { feishuBinary, feishuPaths, prepareFeishu, spawnFeishu, runFeishu, listFeishuFiles, safeFeishuFile } from './feishu-cli.mjs';
import { probeMacosFeishuBus } from './feishu-events.mjs';

const server = { userId: 'alice', connectorId: 'mac-connector', scope: 'agent', scopeId: 'writer', headers: { appId: 'cli_test', appSecret: 'test-only-secret' } };
const sandboxUsable = process.platform === 'darwin' && spawnSync('/usr/bin/sandbox-exec', macosSandboxProbeArgs(), { timeout: 5000, stdio: 'ignore' }).status === 0;
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feishu mac "quoted"-'));
  const previous = process.env.FEISHU_CLI_DATA_ROOT;
  process.env.FEISHU_CLI_DATA_ROOT = root;
  t.after(async () => { if (previous === undefined) delete process.env.FEISHU_CLI_DATA_ROOT; else process.env.FEISHU_CLI_DATA_ROOT = previous; await rm(root, { recursive: true, force: true }); });
  const prepared = await prepareFeishu(server, { platform: 'darwin', run: async () => ({ code: 0, stdout: '{}', stderr: '' }) });
  return { root, ...prepared };
}

test('macOS has stable independent file keys and a verified short config alias, with no host Keychain access', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const keyFile = path.join(macosKeychainDirectory(f.dirs.account), 'master.key.file');
  const key = await readFile(keyFile);
  assert.equal(key.length, 32);
  assert.equal((await lstat(keyFile)).mode & 0o777, 0o600);
  assert.equal(await realpath(path.join(f.dirs.files, '.c')), await realpath(f.dirs.config));
  await Promise.all(Array.from({ length: 4 }, () => prepareMacosFeishu(f.dirs)));
  assert.deepEqual(await readFile(keyFile), key);
  const bob = await prepareFeishu({ ...server, userId: 'bob' }, { platform: 'darwin', run: async () => ({ code: 0, stdout: '{}', stderr: '' }) });
  assert.notDeepEqual(await readFile(path.join(macosKeychainDirectory(bob.dirs.account), 'master.key.file')), key);
  assert.deepEqual(await listFeishuFiles(f.dirs.files), []);
  await assert.rejects(safeFeishuFile(f.dirs.files, '.c/config.json'), /符号链接/);
  assert.equal(f.env.TMPDIR, f.env.TEMP);
});

test('macOS wraps literal argv in sandbox-exec and limits reads and writes to the current connector', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const calls = [];
  const argv = ['docs', '--title', '中文 & $(literal)'];
  spawnFeishu(argv, { env: f.env, cwd: f.dirs.files, binary: '/opt/lark-cli', platform: 'darwin', spawnImpl: (...args) => { calls.push(args); } });
  const [binary, args, options] = calls[0];
  assert.equal(binary, '/usr/bin/sandbox-exec');
  assert.deepEqual(args.slice(-argv.length), argv);
  assert.equal(options.shell, false);
  assert.equal(options.cwd, f.dirs.files);
  assert.equal(options.env.LARKSUITE_CLI_CONFIG_DIR, '.c');
  assert.match(args[1], /\(deny default\)/);
  assert.doesNotMatch(args[1], /\(allow default\)|securityd|\.env/);
  assert.ok(args[1].includes(JSON.stringify(await realpath(f.dirs.files))));
  assert.throws(() => spawnFeishu([], { platform: 'darwin', env: {}, cwd: f.dirs.files }), /隔离目录/);
});

test('macOS refuses a substituted config alias or shared/corrupt credential key', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  await unlink(path.join(f.dirs.files, '.c'));
  await symlink(f.root, path.join(f.dirs.files, '.c'));
  await assert.rejects(prepareMacosFeishu(f.dirs), /别名无效/);
  await unlink(path.join(f.dirs.files, '.c'));
  await symlink(f.dirs.config, path.join(f.dirs.files, '.c'));
  const keyFile = path.join(macosKeychainDirectory(f.dirs.account), 'master.key.file');
  await writeFile(keyFile, 'corrupt');
  await assert.rejects(prepareMacosFeishu(f.dirs), /密钥无效/);
});

test('macOS actual sandbox permits current files while denying sibling scope, account, application secrets and outside writes', { skip: !sandboxUsable }, async t => {
  const f = await fixture(t);
  const own = path.join(f.dirs.files, 'own.txt');
  const outside = path.join(f.root, '.env');
  const sibling = feishuPaths({ ...server, scopeId: 'other' }).files;
  await mkdir(sibling, { recursive: true });
  await writeFile(own, 'visible');
  await writeFile(outside, 'must-not-leak');
  await writeFile(path.join(sibling, 'private.txt'), 'must-not-leak');
  const run = (binary, argv, stdin = '') => runFeishu(argv, { env: f.env, cwd: f.dirs.files, stdin, spawnImpl: (args, options) => spawnFeishu(args, { ...options, binary, platform: 'darwin' }) });
  assert.equal((await run('/bin/cat', [own])).stdout, 'visible');
  for (const file of [outside, path.join(sibling, 'private.txt')]) {
    const result = await run('/bin/cat', [file]);
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, /must-not-leak/);
  }
  assert.equal((await run('/usr/bin/tee', [path.join(f.dirs.files, 'written.txt')], 'allowed')).code, 0);
  assert.notEqual((await run('/usr/bin/tee', [path.join(f.root, 'escape.txt')], 'blocked')).code, 0);
  await assert.rejects(readFile(path.join(f.root, 'escape.txt')), { code: 'ENOENT' });
});

test('macOS probes the bus through its short relative alias even with long hashed directories', { skip: !sandboxUsable }, async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.dirs.config, 'events', server.headers.appId), { recursive: true });
  // A temporary short alias lets this test's listener use the same on-disk socket
  // without changing the test runner's global working directory.
  const short = await mkdtemp('/private/tmp/feishu-bus-');
  t.after(() => rm(short, { recursive: true, force: true }));
  await symlink(f.dirs.config, path.join(short, 'c'));
  const listener = createServer(socket => socket.end());
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(path.join(short, 'c', 'events', server.headers.appId, 'bus.sock'), resolve); });
  try { assert.equal(await probeMacosFeishuBus(f, server.headers.appId), true); }
  finally { await new Promise(resolve => listener.close(resolve)); }
  assert.equal(await probeMacosFeishuBus(f, server.headers.appId), false);
});


test('macOS refuses redirected state directories before creating files in another account', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'another-account');
  await mkdir(outside);
  await rm(f.dirs.data, { recursive: true });
  await symlink(outside, f.dirs.data);
  await assert.rejects(prepareMacosFeishu(f.dirs), /不允许符号链接/);
  await assert.rejects(lstat(path.join(outside, 'roaming')), { code: 'ENOENT' });
});

test('installed official macOS CLI stores encrypted credentials inside the connector and reads them through the short alias', { skip: !sandboxUsable || !existsSync(feishuBinary()) }, async t => {
  const f = await fixture(t);
  const secret = 'fake-offline-credential-test';
  const run = argv => runFeishu(argv, {
    env: f.env, cwd: f.dirs.files, stdin: secret,
    spawnImpl: (args, options) => spawnFeishu(args, { ...options, env: { ...options.env, HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '' } }),
  });
  const initialized = await run(['config', 'init', '--app-id', server.headers.appId, '--app-secret-stdin', '--brand', 'feishu']);
  assert.equal(initialized.code, 0, initialized.stderr);
  const config = await readFile(path.join(f.dirs.config, 'config.json'), 'utf8');
  assert.doesNotMatch(config, new RegExp(secret));
  const stored = await readFile(path.join(macosKeychainDirectory(f.dirs.account), 'appsecret_cli_test.enc'));
  assert.equal(stored.includes(secret), false);
  const shown = await run(['config', 'show']);
  assert.equal(shown.code, 0, shown.stderr);
  assert.doesNotMatch(shown.stdout, new RegExp(secret));
  assert.match(shown.stdout, /cli_test/);
});
