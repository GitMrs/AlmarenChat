import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
