import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyWorkspaceAttempt,
  discardWorkspaceAttempt,
  prepareWorkspaceAttempt,
  recoverWorkspaceAttemptApplication,
  workspaceAttemptFile,
} from './workspace-staging.mjs';
import { diffWorkspaceSnapshots, snapshotWorkspace } from '../worker/runtime-tools.mjs';

test('workspace changes stay staged until approval and can be discarded', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-staging-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  const formal = { projectRoot, userId: options.userId, spaceId: options.spaceId };
  try {
    const workspace = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace');
    await prepareWorkspaceAttempt(options);
    await writeFile(workspaceAttemptFile(options, 'result.md').target, 'staged', 'utf8');
    await assert.rejects(readFile(path.join(workspace, 'result.md'), 'utf8'), /ENOENT/);
    await discardWorkspaceAttempt(options);
    await assert.rejects(readFile(path.join(workspace, 'result.md'), 'utf8'), /ENOENT/);

    const baseline = await snapshotWorkspace(formal);
    await prepareWorkspaceAttempt({ ...options, attempt: 2 });
    await writeFile(workspaceAttemptFile({ ...options, attempt: 2 }, 'result.md').target, 'approved', 'utf8');
    const staged = await snapshotWorkspace({ ...formal, taskId: options.taskId, attempt: 2 });
    const entries = diffWorkspaceSnapshots(baseline, staged);
    await applyWorkspaceAttempt({ ...options, attempt: 2 }, baseline, entries);
    assert.equal(await readFile(path.join(workspace, 'result.md'), 'utf8'), 'approved');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('workspace approval rejects changes when the formal baseline has moved', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-staging-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  const formal = { projectRoot, userId: options.userId, spaceId: options.spaceId };
  try {
    await snapshotWorkspace(formal);
    const workspace = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace');
    await writeFile(path.join(workspace, 'shared.md'), 'baseline', 'utf8');
    const baseline = await snapshotWorkspace(formal);
    await prepareWorkspaceAttempt(options);
    await writeFile(workspaceAttemptFile(options, 'shared.md').target, 'agent change', 'utf8');
    const entries = diffWorkspaceSnapshots(baseline, await snapshotWorkspace({ ...formal, taskId: options.taskId, attempt: 1 }));
    await writeFile(path.join(workspace, 'shared.md'), 'human change', 'utf8');
    await assert.rejects(applyWorkspaceAttempt(options, baseline, entries), (error) => error.code === 'WORKSPACE_CONFLICT');
    assert.equal(await readFile(path.join(workspace, 'shared.md'), 'utf8'), 'human change');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('workspace approval can roll modified and deleted files back', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-staging-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  const formal = { projectRoot, userId: options.userId, spaceId: options.spaceId };
  try {
    await snapshotWorkspace(formal);
    const workspace = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace');
    await writeFile(path.join(workspace, 'modify.md'), 'before', 'utf8');
    await writeFile(path.join(workspace, 'delete.md'), 'keep me', 'utf8');
    const baseline = await snapshotWorkspace(formal);
    await prepareWorkspaceAttempt(options);
    await writeFile(workspaceAttemptFile(options, 'modify.md').target, 'after', 'utf8');
    await rm(workspaceAttemptFile(options, 'delete.md').target);
    const entries = diffWorkspaceSnapshots(baseline, await snapshotWorkspace({ ...formal, taskId: options.taskId, attempt: 1 }));

    const application = await applyWorkspaceAttempt(options, baseline, entries);
    assert.equal(await readFile(path.join(workspace, 'modify.md'), 'utf8'), 'after');
    await assert.rejects(readFile(path.join(workspace, 'delete.md'), 'utf8'), /ENOENT/);

    await application.rollback();
    assert.equal(await readFile(path.join(workspace, 'modify.md'), 'utf8'), 'before');
    assert.equal(await readFile(path.join(workspace, 'delete.md'), 'utf8'), 'keep me');

    await applyWorkspaceAttempt(options, baseline, entries);
    assert.equal(await recoverWorkspaceAttemptApplication(options, baseline, entries), true);
    assert.equal(await readFile(path.join(workspace, 'modify.md'), 'utf8'), 'before');
    assert.equal(await readFile(path.join(workspace, 'delete.md'), 'utf8'), 'keep me');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
