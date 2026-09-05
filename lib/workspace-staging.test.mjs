import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyWorkspaceAttempt,
  cloneWorkspaceAttempt,
  discardWorkspaceAttempt,
  prepareWorkspaceAttempt,
  readExecutionCheckpoint,
  recoverWorkspaceAttemptApplication,
  saveExecutionCheckpoint,
  workspaceAttemptFile,
} from './workspace-staging.mjs';
import { diffWorkspaceSnapshots, snapshotWorkspace } from './agent-runtime/runtime-tools.mjs';

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

test('execution checkpoints are compressed, replaceable and private to one attempt', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-checkpoint-'));
  const options = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  try {
    await prepareWorkspaceAttempt(options);
    assert.equal(await readExecutionCheckpoint(options), null);
    await saveExecutionCheckpoint(options, {
      version: 1,
      conversation: [{ role: 'user', content: '原任务' }, { role: 'tool', content: '第一轮结果' }],
      totalIterations: 1,
    });
    assert.equal((await readExecutionCheckpoint(options)).totalIterations, 1);

    await saveExecutionCheckpoint(options, {
      version: 1,
      conversation: [{ role: 'user', content: '原任务' }, { role: 'tool', content: '第二轮结果' }],
      totalIterations: 2,
    });
    const restored = await readExecutionCheckpoint(options);
    assert.equal(restored.totalIterations, 2);
    assert.equal(restored.conversation.at(-1).content, '第二轮结果');
    assert.equal(await readExecutionCheckpoint({ ...options, attempt: 2 }), null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('a revision inherits the previous staged result without changing the formal workspace', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-staging-'));
  const first = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  const second = { ...first, attempt: 2 };
  const formalFile = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace', 'result.md');
  try {
    await prepareWorkspaceAttempt(first);
    await writeFile(workspaceAttemptFile(first, 'result.md').target, 'first draft', 'utf8');

    await prepareWorkspaceAttempt(second, { sourceAttempt: 1 });
    assert.equal(await readFile(workspaceAttemptFile(second, 'result.md').target, 'utf8'), 'first draft');
    await assert.rejects(
      prepareWorkspaceAttempt({ ...first, attempt: 3 }, { sourceAttempt: 1 }),
      /只能继承紧邻的上一次 attempt/
    );
    await writeFile(workspaceAttemptFile(second, 'result.md').target, 'revised draft', 'utf8');

    assert.equal(await readFile(workspaceAttemptFile(first, 'result.md').target, 'utf8'), 'first draft');
    await assert.rejects(readFile(formalFile, 'utf8'), /ENOENT/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('a failed task retry can inherit staging into a new run task', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-staging-'));
  const source = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'failed-task', attempt: 1 };
  const target = { ...source, taskId: 'retry-task', attempt: 2 };
  try {
    await prepareWorkspaceAttempt(source);
    await writeFile(workspaceAttemptFile(source, 'outline.md').target, 'recoverable draft', 'utf8');

    await cloneWorkspaceAttempt(source, target);

    assert.equal(await readFile(workspaceAttemptFile(target, 'outline.md').target, 'utf8'), 'recoverable draft');
    assert.equal(await readFile(workspaceAttemptFile(source, 'outline.md').target, 'utf8'), 'recoverable draft');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('an accepted image remains when a later workspace attempt is discarded', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'almaren-image-staging-'));
  const imageTask = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'image-task', attempt: 1 };
  const laterTask = { ...imageTask, taskId: 'page-task' };
  const formal = { projectRoot, userId: imageTask.userId, spaceId: imageTask.spaceId };
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(600 * 1024),
  ]);
  try {
    const baseline = await snapshotWorkspace(formal);
    await prepareWorkspaceAttempt(imageTask);
    const stagedImage = workspaceAttemptFile(imageTask, 'assets/hero.png').target;
    await mkdir(path.dirname(stagedImage), { recursive: true });
    await writeFile(stagedImage, png);
    const entries = diffWorkspaceSnapshots(baseline, await snapshotWorkspace(imageTask));
    await applyWorkspaceAttempt(imageTask, baseline, entries);

    await prepareWorkspaceAttempt(laterTask);
    await writeFile(workspaceAttemptFile(laterTask, 'index.html').target, '<html>invalid later draft</html>', 'utf8');
    await discardWorkspaceAttempt(laterTask);

    const acceptedImage = path.join(projectRoot, 'data', 'spaces', 'user-1', 'space-1', 'workspace', 'assets', 'hero.png');
    assert.deepEqual(await readFile(acceptedImage), png);
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
