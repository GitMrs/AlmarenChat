import { getAvailableSources, getTrendingSnapshot } from './service';
import { getOrGenerateTrendingSummary } from './summary-service';
import { getLocalISODate } from './storage';
import { createTrendingSchedule } from './schedule.mjs';

const sleepRandom = (minMs: number, maxMs: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.floor(minMs + Math.random() * (maxMs - minMs))));

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
  schedule?: ReturnType<typeof createTrendingSchedule>;
  isSyncing: boolean;
  cooldownMap: Map<string, number>;
}

const globalForScheduler = globalThis as unknown as {
  __trendingScheduler?: SchedulerState;
};

const state: SchedulerState = globalForScheduler.__trendingScheduler || {
  started: false,
  isSyncing: false,
  cooldownMap: new Map(),
};
globalForScheduler.__trendingScheduler = state;

/** Fetch all sources with two concurrent requests, then refresh the AI summary. */
export async function performFullTrendingSync(options?: { forceAiSummary?: boolean }) {
  if (state.isSyncing) {
    console.log('[trending-scheduler] Another sync is already in progress, skipping.');
    return { success: false, reason: 'in_progress' };
  }

  state.isSyncing = true;
  try {
    const todayStr = getLocalISODate();
    console.log(`[trending-scheduler] Starting full sync for ${todayStr}...`);
    const shuffledSources = shuffleArray(getAvailableSources());
    let successCount = 0;
    let failCount = 0;
    let skippedCooldownCount = 0;

    const batchSize = 2;
    for (let i = 0; i < shuffledSources.length; i += batchSize) {
      const batch = shuffledSources.slice(i, i + batchSize);
      await Promise.all(batch.map(async (src) => {
        if (Date.now() < (state.cooldownMap.get(src.id) || 0)) {
          skippedCooldownCount++;
          return;
        }
        await sleepRandom(100, 300);
        try {
          await getTrendingSnapshot(src.id, { forceRefresh: true });
          successCount++;
        } catch (err: any) {
          failCount++;
          const errMsg = err?.message || String(err);
          console.warn(`[trending-scheduler] Failed to collect ${src.id}:`, errMsg);
          if (errMsg.includes('429') || errMsg.includes('403')) {
            state.cooldownMap.set(src.id, Date.now() + 4 * 60 * 60 * 1000);
          }
        }
      }));
      if (i + batchSize < shuffledSources.length) await sleepRandom(800, 2200);
    }

    console.log(`[trending-scheduler] Data sync completed. Success: ${successCount}, Fail: ${failCount}, Cooldown Skipped: ${skippedCooldownCount}`);
    try {
      console.log(`[trending-scheduler] Generating AI Daily Brief for ${todayStr}...`);
      const summaryResult = await getOrGenerateTrendingSummary({
        date: 'today', category: 'all', forceRefresh: options?.forceAiSummary ?? true,
      });
      console.log(`[trending-scheduler] AI Daily Brief saved for ${todayStr}. (Sampled: ${summaryResult.sampleCount} items)`);
    } catch (err: any) {
      console.warn('[trending-scheduler] Failed to generate AI summary:', err?.message || err);
    }
    return { success: true, today: todayStr, successCount, failCount };
  } finally {
    state.isSyncing = false;
  }
}

/** Schedule future 08:00 / 23:42 runs only; startup never fetches or catches up. */
export function startTrendingScheduler() {
  if (state.started) return;
  if (process.env.NODE_ENV === 'development' && process.env.ENABLE_SCHEDULERS !== 'true') return;
  state.started = true;
  state.schedule = createTrendingSchedule({ run: () => performFullTrendingSync({ forceAiSummary: true }) });
  state.schedule.start();
}

export function stopTrendingScheduler() {
  state.schedule?.stop();
  state.schedule = undefined;
  state.started = false;
  console.log('[trending-scheduler] Scheduler stopped.');
}
