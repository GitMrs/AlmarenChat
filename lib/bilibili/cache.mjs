import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE_DIR = '.bilibili';
const CACHE_FILE = 'cache.json';

function cachePath(root) {
  return path.join(root, CACHE_DIR, CACHE_FILE);
}

async function readAll(root) {
  try {
    const text = await readFile(cachePath(root), 'utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAll(root, data) {
  const dir = path.join(root, CACHE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(cachePath(root), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 读缓存；过期或 refresh=true 时调用 loader 并回写。
 * 缓存失败不影响主流程。
 */
export async function withCache(root, key, ttlMs, refresh, loader) {
  const all = await readAll(root);
  const entry = all[key];
  const fresh = entry && Number(entry.fetchedAt) && Date.now() - Number(entry.fetchedAt) < ttlMs;
  if (!refresh && fresh) {
    return { data: entry.data, fetchedAt: Number(entry.fetchedAt), cached: true };
  }
  const data = await loader();
  const fetchedAt = Date.now();
  try {
    await writeAll(root, { ...all, [key]: { data, fetchedAt } });
  } catch {
    // 缓存写失败不影响返回
  }
  return { data, fetchedAt, cached: false };
}

export async function clearCache(root) {
  try {
    await writeAll(root, {});
  } catch {
    // ignore
  }
}
