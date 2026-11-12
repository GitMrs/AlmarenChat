import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import path from 'node:path';

const source = readFileSync(new URL('../../scripts/install-feishu-cli.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');

function install(platform) {
  const calls = [];
  const win = platform === 'win32';
  const paths = win ? path.win32 : path.posix;
  const npmCli = win ? 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' : '/usr/lib/node_modules/npm/bin/npm-cli.js';
  runInNewContext(source, {
    process: { platform, execPath: win ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/bin/node', env: { PATH: '', npm_execpath: npmCli }, exit: code => { throw new Error(`exit ${code}`); } },
    path: paths, FEISHU_CLI_VERSION: '1.0.100', feishuBinary: () => win ? 'C:\\runtime with spaces\\lark-cli.exe' : '/runtime/lark-cli',
    existsSync: file => file === npmCli, mkdirSync: () => {}, console: { log: () => {} },
    spawnSync: (...args) => { calls.push(args); return { status: 0 }; },
  });
  return calls;
}

test('Windows installation uses npm JS directly with spaced paths and verifies exe without a shell', () => {
  const calls = install('win32');
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(calls[0][1][0], 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js');
  assert.ok(calls[0][1].includes('@larksuite/cli@1.0.100'));
  assert.equal(calls[1][0], 'C:\\runtime with spaces\\lark-cli.exe');
  for (const call of calls) assert.equal(call[2].shell, false);
});

test('Linux installation still requires namespace checks before installing CLI', () => {
  const calls = install('linux');
  assert.equal(calls.length, 4);
  assert.equal(calls[0][0], '/usr/bin/bwrap');
  assert.equal(calls[1][0], '/usr/bin/bwrap');
  assert.ok(calls[1][1].includes('--unshare-user'));
  assert.equal(calls[2][0], 'npm');
  assert.ok(calls[2][1].includes('@larksuite/cli@1.0.100'));
});
