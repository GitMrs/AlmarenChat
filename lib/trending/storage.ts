import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TrendingSnapshot } from './types';

const TRENDING_DIR = path.join(process.cwd(), 'data', 'trending');
export const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 分钟缓存有效期

async function ensureDir() {
  await mkdir(TRENDING_DIR, { recursive: true });
}

export function getSnapshotFilePath(sourceId: string): string {
  return path.join(TRENDING_DIR, `${sourceId}.json`);
}

export async function readSnapshot(sourceId: string): Promise<TrendingSnapshot | null> {
  try {
    const filePath = getSnapshotFilePath(sourceId);
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as TrendingSnapshot;
    if (parsed && Array.isArray(parsed.items)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snapshot: TrendingSnapshot): Promise<void> {
  try {
    await ensureDir();
    const filePath = getSnapshotFilePath(snapshot.source);
    await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch (err: any) {
    console.error(`[trending-storage] Failed to save snapshot for ${snapshot.source}:`, err?.message);
  }
}

export function isSnapshotFresh(snapshot: TrendingSnapshot | null, ttlMs = DEFAULT_TTL_MS): boolean {
  if (!snapshot || !snapshot.updatedAt || !snapshot.items || snapshot.items.length === 0) {
    return false;
  }
  const updatedTime = new Date(snapshot.updatedAt).getTime();
  if (Number.isNaN(updatedTime)) return false;
  return Date.now() - updatedTime < ttlMs;
}
