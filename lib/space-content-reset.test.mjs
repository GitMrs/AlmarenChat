import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resetSpaceContentsStorage } from './space-content-reset.mjs';

test('space reset removes stored files after records are cleared', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'space-reset-'));
  const root = path.join(projectRoot, 'space-1');
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  await writeFile(path.join(root, 'workspace', 'index.html'), 'old');

  let cleared = false;
  const result = await resetSpaceContentsStorage(root, async () => {
    cleared = true;
    return { messages: 2, files: 1 };
  });

  assert.equal(cleared, true);
  assert.deepEqual(result, { messages: 2, files: 1 });
  await assert.rejects(readFile(path.join(root, 'workspace', 'index.html')), { code: 'ENOENT' });
  await rm(projectRoot, { recursive: true, force: true });
});

test('space reset restores stored files when record cleanup fails', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'space-reset-'));
  const root = path.join(projectRoot, 'space-1');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'keep.md'), 'keep');

  await assert.rejects(
    resetSpaceContentsStorage(root, async () => {
      throw new Error('database failed');
    }),
    /database failed/
  );
  assert.equal(await readFile(path.join(root, 'keep.md'), 'utf8'), 'keep');
  await rm(projectRoot, { recursive: true, force: true });
});

test('space reset falls back to staging entries when Windows blocks the root rename', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'space-reset-'));
  const root = path.join(projectRoot, 'space-1');
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  await writeFile(path.join(root, 'workspace', 'index.html'), 'old');
  let blockedRootRename = false;
  const renamePath = async (source, target) => {
    if (!blockedRootRename && source === root) {
      blockedRootRename = true;
      throw Object.assign(new Error('directory is busy'), { code: 'EPERM' });
    }
    await rename(source, target);
  };

  try {
    const result = await resetSpaceContentsStorage(root, async () => ({ files: 1 }), { renamePath });
    assert.equal(blockedRootRename, true);
    assert.deepEqual(result, { files: 1 });
    await assert.rejects(readFile(path.join(root, 'workspace', 'index.html')), { code: 'ENOENT' });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('space reset restores entry-staged files when record cleanup fails', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'space-reset-'));
  const root = path.join(projectRoot, 'space-1');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'keep.md'), 'keep');
  let blockedRootRename = false;
  const renamePath = async (source, target) => {
    if (!blockedRootRename && source === root) {
      blockedRootRename = true;
      throw Object.assign(new Error('directory is busy'), { code: 'EPERM' });
    }
    await rename(source, target);
  };

  try {
    await assert.rejects(
      resetSpaceContentsStorage(root, async () => {
        throw new Error('database failed');
      }, { renamePath }),
      /database failed/
    );
    assert.equal(await readFile(path.join(root, 'keep.md'), 'utf8'), 'keep');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('space reset preserves Space Skills while removing generated contents', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'space-reset-'));
  const root = path.join(projectRoot, 'space-1');
  await mkdir(path.join(root, '.space', 'skills', 'review'), { recursive: true });
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  await writeFile(path.join(root, '.space', 'skills', 'review', 'SKILL.md'), 'review');
  await writeFile(path.join(root, 'workspace', 'index.html'), 'old');

  try {
    await resetSpaceContentsStorage(root, async () => ({ files: 1 }), { preserveEntries: ['.space'] });
    assert.equal(await readFile(path.join(root, '.space', 'skills', 'review', 'SKILL.md'), 'utf8'), 'review');
    await assert.rejects(readFile(path.join(root, 'workspace', 'index.html')), { code: 'ENOENT' });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
