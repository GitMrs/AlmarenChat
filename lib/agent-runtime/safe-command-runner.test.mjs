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
