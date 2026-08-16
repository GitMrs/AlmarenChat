import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export async function resetSpaceContentsStorage(root, clearRecords) {
  const resolvedRoot = path.resolve(root);
  const parent = path.dirname(resolvedRoot);
  const stagedRoot = path.join(parent, `.${path.basename(resolvedRoot)}.clearing-${randomUUID()}`);
  let staged = false;

  try {
    await rename(resolvedRoot, stagedRoot);
    staged = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let result;
  try {
    result = await clearRecords();
  } catch (error) {
    if (staged) await rename(stagedRoot, resolvedRoot);
    throw error;
  }

  await mkdir(resolvedRoot, { recursive: true });
  if (staged) {
    try {
      await rm(stagedRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn('[space-clear] unable to remove staged contents', error);
    }
  }
  return result;
}
