import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareWorkspaceAttempt, workspaceAttemptFile } from '../workspace-staging.mjs';
import { runSafeWorkspaceCheck } from './safe-command-runner.mjs';

test('safe command runner only checks allowlisted file types without a shell', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-command-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  try {
    await prepareWorkspaceAttempt(options);
    await writeFile(workspaceAttemptFile(options, 'valid.js').target, 'const answer = 42;\n', 'utf8');
    await writeFile(workspaceAttemptFile(options, 'invalid.js').target, 'const = ;\n', 'utf8');
    assert.equal((await runSafeWorkspaceCheck(options, { check: 'javascript', path: 'valid.js' })).ok, true);
    const invalid = await runSafeWorkspaceCheck(options, { check: 'javascript', path: 'invalid.js' });
    assert.equal(invalid.ok, false);
    assert.match(invalid.stderr, /SyntaxError/);
    await assert.rejects(runSafeWorkspaceCheck(options, { check: 'shell', path: 'valid.js' }), /不支持/);
    await assert.rejects(runSafeWorkspaceCheck(options, { check: 'javascript', path: '../outside.js' }), /路径/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('safe command runner parses inline HTML scripts without executing them', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-command-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  try {
    await prepareWorkspaceAttempt(options);
    await writeFile(workspaceAttemptFile(options, 'valid.html').target, [
      '<script>globalThis.__mustNotRun = true; const answer = 42;</script>',
      '<script type="application/json">{"not":"javascript"}</script>',
      '<script src="external.js"></script>',
      '<script type="module">export const value = 1;</script>',
    ].join(''), 'utf8');
    await writeFile(workspaceAttemptFile(options, 'invalid.html').target, '<script>const = ;</script>', 'utf8');

    const valid = await runSafeWorkspaceCheck(options, { check: 'html', path: 'valid.html' });
    assert.equal(valid.ok, true);
    assert.equal(valid.scriptsChecked, 2);
    assert.equal(globalThis.__mustNotRun, undefined);
    const invalid = await runSafeWorkspaceCheck(options, { check: 'html', path: 'invalid.html' });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /第 1 个内联脚本/);
    assert.match(invalid.stderr, /SyntaxError/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
