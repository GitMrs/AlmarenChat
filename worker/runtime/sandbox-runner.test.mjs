import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runSandboxedSkillProcess } from './sandbox-runner.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const csvSkillRoot = path.join(projectRoot, 'skills', 'builtin', 'csv-business-analysis');
const csvFixture = path.join(projectRoot, 'tests', 'fixtures', 'skills', 'csv-business-analysis', 'fixtures', 'sales.csv');
const tempRoots = [];
const sandboxUsable = process.platform === 'darwin'
  ? spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default)', '--', '/usr/bin/true'], { timeout: 5_000 }).status === 0
  : process.platform === 'linux'
    ? ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'].some((command) =>
        spawnSync(command, ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent', '--', 'true'], {
          timeout: 5_000,
          stdio: 'ignore',
        }).status === 0
      )
    : false;

async function tempRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

test.afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('sandbox runner executes the CSV Skill with no inherited secrets', { skip: !sandboxUsable }, async () => {
  const workspaceRoot = await tempRoot('almaren-sandbox-workspace-');
  await cp(csvFixture, path.join(workspaceRoot, 'sales.csv'));
  process.env.ALMAREN_SANDBOX_TEST_SECRET = 'must-not-leak';
  try {
    const result = await runSandboxedSkillProcess({
      workspaceRoot,
      skillRoot: csvSkillRoot,
      command: 'python3',
      script: 'scripts/analyze.py',
      args: ['--input', 'sales.csv', '--markdown-output', 'outputs/analysis.md', '--html-output', 'outputs/report.html'],
      network: false,
    });
    assert.equal(result.ok, true, result.stderr);
    assert.equal(result.enforcement, 'full');
    assert.ok(['seatbelt', 'bubblewrap'].includes(result.backend));
    assert.match(await readFile(path.join(workspaceRoot, 'outputs', 'analysis.md'), 'utf8'), /8,500\.00/);
  } finally {
    delete process.env.ALMAREN_SANDBOX_TEST_SECRET;
  }
});

test('sandbox runner denies writes outside the workspace', { skip: !sandboxUsable }, async () => {
  const root = await tempRoot('almaren-sandbox-boundary-');
  const workspaceRoot = path.join(root, 'workspace');
  const skillRoot = path.join(root, 'skill');
  const outside = path.join(root, 'outside.txt');
  await mkdir(workspaceRoot);
  await mkdir(skillRoot);
  await writeFile(path.join(skillRoot, 'escape.py'), `from pathlib import Path\nPath(${JSON.stringify(outside)}).write_text('escaped')\n`, 'utf8');

  const result = await runSandboxedSkillProcess({
    workspaceRoot,
    skillRoot,
    command: 'python3',
    script: 'escape.py',
    network: false,
  });
  assert.equal(result.ok, false);
  await assert.rejects(readFile(outside, 'utf8'), { code: 'ENOENT' });
});

test('sandbox runner can mount the workspace read-only for uploaded Skill analyzers', { skip: !sandboxUsable }, async () => {
  const root = await tempRoot('almaren-sandbox-readonly-');
  const workspaceRoot = path.join(root, 'workspace');
  const skillRoot = path.join(root, 'skill');
  await mkdir(workspaceRoot);
  await mkdir(skillRoot);
  await writeFile(path.join(workspaceRoot, 'chapter.md'), 'original', 'utf8');
  await writeFile(path.join(skillRoot, 'mutate.py'), [
    'from pathlib import Path',
    'import sys',
    "Path(sys.argv[1]).write_text('changed', encoding='utf-8')",
  ].join('\n'), 'utf8');

  const result = await runSandboxedSkillProcess({
    workspaceRoot,
    skillRoot,
    command: 'python3',
    script: 'mutate.py',
    args: ['chapter.md'],
    network: false,
    workspaceAccess: 'read',
  });
  assert.equal(result.ok, false);
  assert.equal(await readFile(path.join(workspaceRoot, 'chapter.md'), 'utf8'), 'original');
});

test('sandbox runner denies network access even to a local listening socket', { skip: !sandboxUsable }, async () => {
  const root = await tempRoot('almaren-sandbox-network-');
  const workspaceRoot = path.join(root, 'workspace');
  const skillRoot = path.join(root, 'skill');
  await mkdir(workspaceRoot);
  await mkdir(skillRoot);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await writeFile(path.join(skillRoot, 'network.py'), `import socket\nsocket.create_connection(('127.0.0.1', ${port}), timeout=1)\n`, 'utf8');
  try {
    const result = await runSandboxedSkillProcess({
      workspaceRoot,
      skillRoot,
      command: 'python3',
      script: 'network.py',
      network: false,
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, false);
  } finally {
    server.close();
  }
});

test('sandbox runner terminates a timed-out process', { skip: !sandboxUsable }, async () => {
  const root = await tempRoot('almaren-sandbox-timeout-');
  const workspaceRoot = path.join(root, 'workspace');
  const skillRoot = path.join(root, 'skill');
  await mkdir(workspaceRoot);
  await mkdir(skillRoot);
  await writeFile(path.join(skillRoot, 'sleep.py'), 'import time\ntime.sleep(30)\n', 'utf8');

  const result = await runSandboxedSkillProcess({
    workspaceRoot,
    skillRoot,
    command: 'python3',
    script: 'sleep.py',
    network: false,
    timeoutMs: 1_000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.ok(result.durationMs < 5_000);
});
