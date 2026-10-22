import fs from 'node:fs';
import path from 'node:path';
import type {
  TurtleSoupItem,
  TurtleSoupSummary,
  TurtleSoupJudgeResult,
  TurtleSoupCategory,
  DetectiveScore,
} from './types';

let cachedPuzzles: TurtleSoupItem[] | null = null;

function loadPuzzles(): TurtleSoupItem[] {
  if (cachedPuzzles) return cachedPuzzles;
  try {
    const filePath = path.join(process.cwd(), 'lib', 'workspace', 'game', 'turtle-soup', 'data', 'library.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    cachedPuzzles = (data as any[]).map((p, idx) => ({
      id: String(p.id || `soup-${idx + 1}`),
      index: idx + 1,
      title: String(p.title || `第${idx + 1}题`),
      story: String(p.story || '').trim(),
      answer: String(p.answer || '').trim(),
      hints: Array.isArray(p.hints) ? p.hints.map((h: any) => String(h).trim()) : [],
    }));
    return cachedPuzzles;
  } catch (err) {
    console.warn('[turtle-soup] Failed to load library.json:', err);
    return [];
  }
}

export function getAllPuzzles(): TurtleSoupItem[] {
  return loadPuzzles();
}

export function getPuzzlesCount(): number {
  return loadPuzzles().length;
}

export {
  inferCategory,
  inferDifficulty,
  calculateDetectiveScore,
  getDetectiveTitle,
} from './scoring.ts';
import {
  inferCategory,
  inferDifficulty,
} from './scoring.ts';

export function getPuzzlesSummary(): TurtleSoupSummary[] {
  return loadPuzzles().map((p, idx) => ({
    id: p.id,
    index: idx + 1,
    title: p.title,
    storySnippet: p.story.length > 50 ? `${p.story.slice(0, 50)}…` : p.story,
    hintCount: p.hints.length,
    category: inferCategory(p, idx + 1),
    difficulty: inferDifficulty(p),
  }));
}

export function getPuzzleById(id: string): TurtleSoupItem | null {
  if (!id) return null;
  return loadPuzzles().find((p) => p.id === id) || null;
}

export function getPuzzleWithIndex(id: string): { puzzle: TurtleSoupItem; index: number } | null {
  const all = loadPuzzles();
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  return { puzzle: all[idx], index: idx + 1 };
}

export function getRandomPuzzle(excludeIds: string[] = []): TurtleSoupItem {
  const all = loadPuzzles();
  const available = all.filter((p) => !excludeIds.includes(p.id));
  const pool = available.length > 0 ? available : all;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

export function getRandomPuzzleWithIndex(excludeIds: string[] = []): { puzzle: TurtleSoupItem; index: number } {
  const all = loadPuzzles();
  const available = all.filter((p) => !excludeIds.includes(p.id));
  const pool = available.length > 0 ? available : all;
  const randomIndex = Math.floor(Math.random() * pool.length);
  const selected = pool[randomIndex];
  const trueIndex = all.findIndex((p) => p.id === selected.id) + 1;
  return { puzzle: selected, index: trueIndex || selected.index || 1 };
}

/**
 * 降级裁判响应：当大模型或网络不可用时，明确提示裁判不可用，绝不靠文字重合度瞎编“是/否”误导玩家
 */
export function heuristicJudge(
  _puzzle?: TurtleSoupItem,
  _question?: string
): TurtleSoupJudgeResult {
  return {
    verdict: 'IRRELEVANT',
    verdictLabel: '⚠️ 裁判暂不可用',
    dmExplanation: '守秘人 DM 陷入迷雾（裁判模型服务响应超时或网络异常），无法准确核验此问题。请稍后重新提问，本次提问未计入对局。',
    luluReaction: '诶？！裁判席怎么起大雾了……指挥官别急，这个不算，等会儿我们重新问一次！',
    kokoReaction: '呼呼～迷雾太浓啦！指挥官先喝口水歇一歇，等迷雾散了我们再继续！🍵',
    isSolved: false,
  };
}
