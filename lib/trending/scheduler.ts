import { getAvailableSources, getTrendingSnapshot } from './service';
import { getOrGenerateTrendingSummary } from './summary-service';
import { getLocalISODate } from './storage';
import path from 'node:path';
import { readdir } from 'node:fs/promises';

const TRENDING_DIR = path.join(process.cwd(), 'data', 'trending');
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 每 10 分钟检测一次调度条件

// 基础周期 3 小时，带有 ±25 分钟随机扰动（避免钟摆式整点特征）
function getNextSyncInterval(): number {
  const baseHours = 2.8;
  const jitterHours = Math.random() * 0.7; // 2.8h ~ 3.5h 浮动
  return Math.floor((baseHours + jitterHours) * 3600 * 1000);
}

// 拟人随机睡眠助手
const sleepRandom = (minMs: number, maxMs: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.floor(minMs + Math.random() * (maxMs - minMs))));

// Fisher-Yates 随机打乱源抓取顺序，避免固定访问顺序被识别为机器人
function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface SchedulerState {
  started: boolean;
  intervalId?: NodeJS.Timeout;
  lastSyncTime?: number;
  nextSyncDelayMs: number;
  lastFinalizedDate?: string;
  isSyncing: boolean;
  cooldownMap: Map<string, number>; // 记录触发限流/错误源的冷静期截止时间
}

const globalForScheduler = globalThis as unknown as {
  __trendingScheduler?: SchedulerState;
};

const state: SchedulerState = globalForScheduler.__trendingScheduler || {
  started: false,
  isSyncing: false,
  nextSyncDelayMs: getNextSyncInterval(),
  cooldownMap: new Map(),
};

globalForScheduler.__trendingScheduler = state;

/**
 * 拟人化静默抓取并落盘所有热榜源
 * 特性：随机顺序、极低并发、请求间随机睡眠、触发 429 自动进入冷静期
 */
export async function performFullTrendingSync(options?: { forceAiSummary?: boolean }) {
  if (state.isSyncing) {
    console.log('[trending-scheduler] Another sync is already in progress, skipping.');
    return { success: false, reason: 'in_progress' };
  }

  state.isSyncing = true;
  const todayStr = getLocalISODate();
  console.log(`[trending-scheduler] 🕵️ Starting stealth randomized sync for: ${todayStr}...`);

  // 1. 获取所有源并随机乱序
  const rawSources = getAvailableSources();
  const shuffledSources = shuffleArray(rawSources);
  const now = Date.now();

  let successCount = 0;
  let failCount = 0;
  let skippedCooldownCount = 0;

  // 2. 超轻并发（每次仅 2 个），请求间随机休眠 800ms ~ 2200ms
  const batchSize = 2;
  for (let i = 0; i < shuffledSources.length; i += batchSize) {
    const batch = shuffledSources.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (src) => {
        // 检查是否处于限流冷静期
        const cooldownUntil = state.cooldownMap.get(src.id) || 0;
        if (now < cooldownUntil) {
          skippedCooldownCount++;
          return;
        }

        // 源与源之间注入微小随机抖动（100~300ms）
        await sleepRandom(100, 300);

        try {
          await getTrendingSnapshot(src.id, { forceRefresh: true });
          successCount++;
        } catch (err: any) {
          failCount++;
          const errMsg = err?.message || String(err);
          console.warn(`[trending-scheduler] Failed to collect ${src.id}:`, errMsg);

          // 若触发 429 Too Many Requests 或 403 Forbidden，让该源静默冷却 4 小时
          if (errMsg.includes('429') || errMsg.includes('403')) {
            const cooldownMs = 4 * 60 * 60 * 1000;
            state.cooldownMap.set(src.id, Date.now() + cooldownMs);
            console.warn(`[trending-scheduler] ⚠️ Rate limit detected for ${src.id}, cooled down for 4 hours.`);
          }
        }
      })
    );

    // 批次间拟人休眠 800ms ~ 2200ms，杜绝短时高频洪峰
    if (i + batchSize < shuffledSources.length) {
      await sleepRandom(800, 2200);
    }
  }

  console.log(
    `[trending-scheduler] Data sync completed. Success: ${successCount}, Fail: ${failCount}, Cooldown Skipped: ${skippedCooldownCount}`
  );

  // 3. 自动触发 AI 智能脱水与速报落盘
  try {
    console.log(`[trending-scheduler] Generating automated AI Daily Brief for ${todayStr}...`);
    const summaryResult = await getOrGenerateTrendingSummary({
      date: 'today',
      category: 'all',
      forceRefresh: options?.forceAiSummary ?? true,
    });
    console.log(
      `[trending-scheduler] AI Daily Brief successfully sealed for ${todayStr}. (Sampled: ${summaryResult.sampleCount} items)`
    );
  } catch (err: any) {
    console.warn('[trending-scheduler] Failed to generate automated AI summary:', err?.message || err);
  }

  state.lastSyncTime = Date.now();
  // 重新计算下一次执行的随机等待时长（2.8h ~ 3.5h 浮动）
  state.nextSyncDelayMs = getNextSyncInterval();
  state.isSyncing = false;

  return { success: true, today: todayStr, successCount, failCount };
}

/**
 * 开机启动自检：检查今天是否已有足够数据和 AI 总结
 */
async function checkAndBootstrapToday() {
  const todayStr = getLocalISODate();
  const historyTodayDir = path.join(TRENDING_DIR, 'history', todayStr);

  let hasEnoughSnapshots = false;
  try {
    const files = await readdir(historyTodayDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.startsWith('summary_'));
    hasEnoughSnapshots = jsonFiles.length >= 3;
  } catch {
    hasEnoughSnapshots = false;
  }

  if (!hasEnoughSnapshots) {
    console.log(
      `[trending-scheduler] Bootstrap check: No sufficient archive found for today (${todayStr}). Triggering immediate collection...`
    );
    await performFullTrendingSync({ forceAiSummary: true });
  } else {
    console.log(`[trending-scheduler] Bootstrap check: Today (${todayStr}) archive is healthy.`);
  }
}

/**
 * 核心调度循环：处理带随机扰动的周期性同步与午夜终局归档
 */
async function runSchedulerTick() {
  const now = new Date();
  const todayStr = getLocalISODate(now);

  // 使用东八区时间计算当前时分
  const shanghaiHourStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).format(now);

  const [hour, minute] = shanghaiHourStr.split(':').map((v) => parseInt(v, 10));

  // 1. 午夜终局归档判定（每天 23:42 ~ 23:58 之间随机窗口触发）
  const isNearMidnight = hour === 23 && minute >= 42;
  if (isNearMidnight && state.lastFinalizedDate !== todayStr) {
    // 注入 1~10 秒随机延迟
    await sleepRandom(1000, 10000);
    console.log(`[trending-scheduler] Midnight trigger (${shanghaiHourStr}). Sealing final archive for ${todayStr}...`);
    await performFullTrendingSync({ forceAiSummary: true });
    state.lastFinalizedDate = todayStr;
    return;
  }

  // 2. 常规周期性同步判定（使用动态计算的随机浮动时间窗口）
  const lastSync = state.lastSyncTime || 0;
  const elapsed = Date.now() - lastSync;
  if (elapsed >= state.nextSyncDelayMs) {
    const mins = Math.round(elapsed / 60000);
    console.log(`[trending-scheduler] Random interval reached (${mins} mins). Triggering sync...`);
    await performFullTrendingSync({ forceAiSummary: false });
  }
}

/**
 * 启动全网热点与 AI 总结自动调度守护引擎
 */
export function startTrendingScheduler() {
  if (state.started) {
    return;
  }

  state.started = true;
  console.log('[trending-scheduler] 🚀 Trending Auto-Scheduler initialized with anti-ban stealth randomizer.');

  // 延迟 5~12 秒随机时间执行开机自检，平滑服务启动
  setTimeout(() => {
    checkAndBootstrapToday().catch((err) => {
      console.warn('[trending-scheduler] Bootstrap check error:', err?.message || err);
    });
  }, 5000 + Math.random() * 7000);

  // 启动主轮询定时器
  state.intervalId = setInterval(() => {
    runSchedulerTick().catch((err) => {
      console.warn('[trending-scheduler] Scheduler tick error:', err?.message || err);
    });
  }, CHECK_INTERVAL_MS);
}

/**
 * 停止调度器（用于测试或热重载清理）
 */
export function stopTrendingScheduler() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = undefined;
  }
  state.started = false;
  console.log('[trending-scheduler] 🛑 Trending Auto-Scheduler stopped.');
}
