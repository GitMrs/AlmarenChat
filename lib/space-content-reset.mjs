import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const WINDOWS_RENAME_FALLBACK_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

async function stageEntries(root, stagedRoot, renamePath) {
  await mkdir(stagedRoot);
  const moved = [];
  try {
    for (const name of await readdir(root)) {
      await renamePath(path.join(root, name), path.join(stagedRoot, name));
      moved.push(name);
    }
    return moved;
  } catch (error) {
    for (const name of [...moved].reverse()) {
      await renamePath(path.join(stagedRoot, name), path.join(root, name));
    }
    await rm(stagedRoot, { recursive: true, force: true });
    throw error;
  }
}

async function restoreEntries(root, stagedRoot, moved, renamePath) {
  for (const name of [...moved].reverse()) {
    await renamePath(path.join(stagedRoot, name), path.join(root, name));
  }
  await rm(stagedRoot, { recursive: true, force: true });
}

export async function resetSpaceContentsStorage(root, clearRecords, { renamePath = rename, preserveEntries = [] } = {}) {
  const resolvedRoot = path.resolve(root);
  const parent = path.dirname(resolvedRoot);
  const stagedRoot = path.join(parent, `.${path.basename(resolvedRoot)}.clearing-${randomUUID()}`);
  let stagingMode = null;
  let movedEntries = [];

  try {
    await renamePath(resolvedRoot, stagedRoot);
    stagingMode = 'root';
  } catch (error) {
    if (error?.code === 'ENOENT') {
      stagingMode = null;
    } else if (WINDOWS_RENAME_FALLBACK_CODES.has(error?.code)) {
      movedEntries = await stageEntries(resolvedRoot, stagedRoot, renamePath);
      stagingMode = 'entries';
    } else {
      throw error;
    }
  }

  let result;
  try {
    result = await clearRecords();
  } catch (error) {
    if (stagingMode === 'root') await renamePath(stagedRoot, resolvedRoot);
    if (stagingMode === 'entries') {
      await restoreEntries(resolvedRoot, stagedRoot, movedEntries, renamePath);
    }
    throw error;
  }

  await mkdir(resolvedRoot, { recursive: true });
  if (stagingMode) {
    for (const name of preserveEntries) {
      if (!name || path.basename(name) !== name || name === '.' || name === '..') {
        throw new Error('保留的空间目录名称不安全');
      }
      try {
        await renamePath(path.join(stagedRoot, name), path.join(resolvedRoot, name));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    try {
      await rm(stagedRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn('[space-clear] unable to remove staged contents', error);
    }
  }
  return result;
}
