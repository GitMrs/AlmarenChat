import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TrendingSnapshot } from './types';

const TRENDING_DIR = path.join(process.cwd(), 'data', 'trending');
const HISTORY_DIR = path.join(TRENDING_DIR, 'history');
export const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 分钟缓存有效期

export function getLocalISODate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export interface DateArchiveOption {
  date: string; // 'today' or '2026-10-04'
  label: string; // '今日实时' | '昨天 (10-04)' | '前天 (10-03)'
  isToday?: boolean;
  rawDate: string; // '2026-10-05'
}

async function ensureDir(dirPath = TRENDING_DIR) {
  await mkdir(dirPath, { recursive: true });
}

export function getSnapshotFilePath(sourceId: string, date?: string): string {
  if (date && date !== 'today' && date !== getLocalISODate()) {
    return path.join(HISTORY_DIR, date, `${sourceId}.json`);
  }
  return path.join(TRENDING_DIR, `${sourceId}.json`);
}

export async function getAvailableDates(): Promise<DateArchiveOption[]> {
  const todayStr = getLocalISODate();
  const options: DateArchiveOption[] = [
    {
      date: 'today',
      label: '今日实时',
      isToday: true,
      rawDate: todayStr,
    },
  ];

  try {
    await ensureDir(HISTORY_DIR);
    const entries = await readdir(HISTORY_DIR, { withFileTypes: true });
    const dateFolders = entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a)); // 倒序排列，最近的在前

    const todayTime = new Date(`${todayStr}T00:00:00+08:00`).getTime();

    for (const folder of dateFolders) {
      if (folder === todayStr) continue; // 今天已包含在 'today'
      const folderTime = new Date(`${folder}T00:00:00+08:00`).getTime();
      const diffDays = Math.round((todayTime - folderTime) / (1000 * 60 * 60 * 24));
      const parts = folder.split('-');
      const monthDay = `${parts[1]}-${parts[2]}`;

      let label = `${monthDay} 归档`;
      if (diffDays === 1) {
        label = `昨天 (${monthDay})`;
      } else if (diffDays === 2) {
        label = `前天 (${monthDay})`;
      }

      options.push({
        date: folder,
        label,
        isToday: false,
        rawDate: folder,
      });
    }
  } catch (err: any) {
    console.warn('[trending-storage] Failed to read history directories:', err?.message);
  }

  return options;
}

export async function readSnapshot(
  sourceId: string,
  options?: { date?: string }
): Promise<TrendingSnapshot | null> {
  try {
    const filePath = getSnapshotFilePath(sourceId, options?.date);
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
    // 1. 写入今日最新实时快照
    const liveFilePath = getSnapshotFilePath(snapshot.source);
    await writeFile(liveFilePath, JSON.stringify(snapshot, null, 2), 'utf8');

    // 2. 同时归档到今天的历史目录中
    const todayStr = getLocalISODate();
    const todayHistoryDir = path.join(HISTORY_DIR, todayStr);
    await ensureDir(todayHistoryDir);
    const historyFilePath = path.join(todayHistoryDir, `${snapshot.source}.json`);

    let snapshotToSave = snapshot;
    try {
      const existingHistoryContent = await readFile(historyFilePath, 'utf8');
      const existingSnapshot = JSON.parse(existingHistoryContent) as TrendingSnapshot;
      if (existingSnapshot && Array.isArray(existingSnapshot.items)) {
        const itemMap = new Map<string, any>();
        // 先放最新条目
        snapshot.items.forEach((it) => {
          const key = it.id || it.title;
          itemMap.set(key, it);
        });
        // 追加此前记录过但现在未在当前前 20 的条目
        existingSnapshot.items.forEach((it) => {
          const key = it.id || it.title;
          if (!itemMap.has(key)) {
            itemMap.set(key, it);
          }
        });
        snapshotToSave = {
          ...snapshot,
          total: itemMap.size,
          items: Array.from(itemMap.values()).slice(0, 50),
        };
      }
    } catch {
      // 容错处理
    }

    await writeFile(historyFilePath, JSON.stringify(snapshotToSave, null, 2), 'utf8');
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
