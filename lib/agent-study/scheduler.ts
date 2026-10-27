import { createScheduler } from '../core/scheduler.mjs';
import prisma from '@/app/api/_lib/db';
import { resolveUserModelConfig } from '@/app/api/_lib/agent-model';
import { getOrGenerateDailyStudy } from './service';
import { getLocalISODate, loadDailyStudyRecord } from './storage';

/**
 * 每日研习后台调度器
 *
 * 规则：
 * - 本地时间进入 DAILY_STUDY_HOUR ~ DAILY_STUDY_WINDOW_END_HOUR（默认 8 点至当天结束）后才触发当天的研习
 * - 只处理 AgentModelSetting.dailyStudyEnabled = true 的 (userId, agentId)
 * - 今日记录已存在则跳过（记录文件即完成标记）
 * - 用户最后一条消息距今超过 DAILY_STUDY_ACTIVE_DAYS（默认 3 天）→ 休眠，不再偷偷学习
 * - 单个 Agent 失败不影响其他；当天最多 DAILY_STUDY_MAX_ATTEMPTS 次，失败按冷却时间重试
 * - 用户回来聊天时走懒生成路径自动唤醒，无需调度器特殊处理
 */

export interface DailyStudyTickDeps {
  now?: Date;
  today?: string;
  hourThreshold?: number;
  windowEndHour?: number;
  activeWindowDays?: number;
  maxAttempts?: number;
  retryBackoffMinutes?: number;
  listEnabledPairs?: () => Promise<Array<{
    userId: string;
    agentId: string;
    dailyStudyAttemptDate?: string | null;
    dailyStudyAttemptCount?: number | null;
    dailyStudyNextAttemptAt?: Date | string | null;
    dailyStudyStartHour?: number | null;
    dailyStudyWindowEndHour?: number | null;
    dailyStudyMaxAttempts?: number | null;
    dailyStudyRetryBackoffMinutes?: number | null;
  }>>;
  hasTodayRecord?: (agentId: string, date: string, userId: string) => Promise<boolean>;
  lastUserMessageAt?: (userId: string, agentId: string) => Promise<Date | null>;
  recordAttempt?: (userId: string, agentId: string, state: {
    date: string;
    count: number;
    nextAttemptAt: Date | null;
  }) => Promise<void>;
  generate?: (agentId: string, userId: string) => Promise<unknown>;
  logger?: { log: (...args: any[]) => void; warn: (...args: any[]) => void };
}

export async function runDailyStudyTick(deps: DailyStudyTickDeps = {}): Promise<{
  generated: number;
  skipped: number;
  failed: number;
}> {
  const logger = deps.logger || console;
  const now = deps.now || new Date();
  const today = deps.today || getLocalISODate(now);
  const configuredStartHour = deps.hourThreshold ?? Number(process.env.DAILY_STUDY_HOUR ?? 8);
  const configuredEndHour = deps.windowEndHour ?? Number(process.env.DAILY_STUDY_WINDOW_END_HOUR ?? 24);
  const hourThreshold = Number.isFinite(configuredStartHour) ? Math.max(0, Math.min(23, configuredStartHour)) : 8;
  const windowEndHour = Number.isFinite(configuredEndHour) ? Math.max(1, Math.min(24, configuredEndHour)) : 24;
  const activeWindowDays =
    deps.activeWindowDays ?? Number(process.env.DAILY_STUDY_ACTIVE_DAYS ?? 3);
  const configuredMaxAttempts = deps.maxAttempts ?? Number(process.env.DAILY_STUDY_MAX_ATTEMPTS ?? 2);
  const configuredRetryBackoff = deps.retryBackoffMinutes ?? Number(process.env.DAILY_STUDY_RETRY_BACKOFF_MINUTES ?? 30);
  const maxAttempts = Number.isFinite(configuredMaxAttempts) ? Math.max(1, configuredMaxAttempts) : 2;
  const retryBackoffMinutes = Number.isFinite(configuredRetryBackoff) ? Math.max(1, configuredRetryBackoff) : 30;

  const listEnabledPairs =
    deps.listEnabledPairs ||
    (async () => {
      const db: any = (prisma as any)?.default || prisma;
      if (!db?.agentModelSetting?.findMany) return [];
      return db.agentModelSetting.findMany({
        where: { dailyStudyEnabled: true },
        select: {
          userId: true,
          agentId: true,
          dailyStudyAttemptDate: true,
          dailyStudyAttemptCount: true,
          dailyStudyNextAttemptAt: true,
          dailyStudyStartHour: true,
          dailyStudyWindowEndHour: true,
          dailyStudyMaxAttempts: true,
          dailyStudyRetryBackoffMinutes: true,
        },
      });
    });

  const recordAttempt = deps.recordAttempt || (async (
    userId: string,
    agentId: string,
    state: { date: string; count: number; nextAttemptAt: Date | null },
  ) => {
    const db: any = (prisma as any)?.default || prisma;
    if (!db?.agentModelSetting?.updateMany) return;
    await db.agentModelSetting.updateMany({
      where: { userId, agentId },
      data: {
        dailyStudyAttemptDate: state.date,
        dailyStudyAttemptCount: state.count,
        dailyStudyNextAttemptAt: state.nextAttemptAt,
        updatedAt: new Date(),
      },
    });
  });

  const hasTodayRecord =
    deps.hasTodayRecord ||
    (async (agentId: string, date: string, userId: string) =>
      Boolean(await loadDailyStudyRecord(agentId, date, userId)));

  const lastUserMessageAt =
    deps.lastUserMessageAt ||
    (async (userId: string, agentId: string) => {
      const db: any = (prisma as any)?.default || prisma;
      if (!db?.message?.findFirst) return null;
      const msg = await db.message.findFirst({
        where: { role: 'user', conversation: { userId, agentId } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      return msg?.createdAt ?? null;
    });

  const generate =
    deps.generate ||
    (async (agentId: string, userId: string) => {
      const db: any = (prisma as any)?.default || prisma;
      // 后台研习必须沿用用户/Agent 自己的模型配置，否则会退回系统默认 key 而失败
      const [user, setting] = await Promise.all([
        db?.user?.findUnique
          ? db.user.findUnique({
              where: { id: userId },
              select: { customModelEnabled: true, modelName: true, apiBaseUrl: true, apiKey: true },
            })
          : Promise.resolve(null),
        db?.agentModelSetting?.findUnique
          ? db.agentModelSetting.findUnique({ where: { userId_agentId: { userId, agentId } } })
          : Promise.resolve(null),
      ]);
      return getOrGenerateDailyStudy(agentId, userId, {
        modelConfig: resolveUserModelConfig(user, setting),
      });
    });

  const pairs = await listEnabledPairs();
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const pair of pairs) {
    try {
      const pairStartHour = Number.isFinite(pair.dailyStudyStartHour)
        ? Math.max(0, Math.min(23, pair.dailyStudyStartHour as number))
        : hourThreshold;
      const pairWindowEndHour = Number.isFinite(pair.dailyStudyWindowEndHour)
        ? Math.max(1, Math.min(24, pair.dailyStudyWindowEndHour as number))
        : windowEndHour;
      // 每个 Agent 可以单独设置窗口；不合法或当前不在窗口内时保持静默。
      if (pairWindowEndHour <= pairStartHour || now.getHours() < pairStartHour || now.getHours() >= pairWindowEndHour) {
        continue;
      }
      const pairMaxAttempts = Number.isFinite(pair.dailyStudyMaxAttempts)
        ? Math.max(1, pair.dailyStudyMaxAttempts as number)
        : maxAttempts;
      const pairRetryBackoffMinutes = Number.isFinite(pair.dailyStudyRetryBackoffMinutes)
        ? Math.max(1, pair.dailyStudyRetryBackoffMinutes as number)
        : retryBackoffMinutes;

      if (await hasTodayRecord(pair.agentId, today, pair.userId)) {
        skipped++;
        continue;
      }

      const attemptDate = pair.dailyStudyAttemptDate === today ? today : '';
      const attemptCount = attemptDate ? Number(pair.dailyStudyAttemptCount || 0) : 0;
      const nextAttemptAt = attemptDate && pair.dailyStudyNextAttemptAt
        ? new Date(pair.dailyStudyNextAttemptAt).getTime()
        : 0;
      if (attemptCount >= pairMaxAttempts || (nextAttemptAt > now.getTime())) {
        skipped++;
        continue;
      }

      const lastAt = await lastUserMessageAt(pair.userId, pair.agentId);
      const dormantMs = activeWindowDays * 24 * 3600 * 1000;
      if (!lastAt || now.getTime() - new Date(lastAt).getTime() > dormantMs) {
        // 用户从未聊过或超过活跃窗口：休眠
        skipped++;
        continue;
      }

      const nextCount = attemptCount + 1;
      await recordAttempt(pair.userId, pair.agentId, {
        date: today,
        count: nextCount,
        nextAttemptAt: null,
      });

      try {
        await generate(pair.agentId, pair.userId);
      } catch (error) {
        const retryAt = new Date(now.getTime() + pairRetryBackoffMinutes * 60_000 * (2 ** (nextCount - 1)));
        await recordAttempt(pair.userId, pair.agentId, {
          date: today,
          count: nextCount,
          nextAttemptAt: retryAt,
        }).catch(() => {});
        throw error;
      }
      generated++;
      logger.log(`[agent-study-scheduler] generated daily study for ${pair.agentId} (user ${pair.userId})`);
    } catch (err: any) {
      failed++;
      logger.warn(
        `[agent-study-scheduler] failed for ${pair.agentId} (user ${pair.userId}):`,
        err?.message || err
      );
    }
  }

  return { generated, skipped, failed };
}

const globalForStudyScheduler = globalThis as unknown as {
  __agentStudyScheduler?: ReturnType<typeof createScheduler>;
};

/**
 * 启动每日研习后台调度（进程内单例，HMR 安全）
 */
export function startAgentStudyScheduler() {
  if (globalForStudyScheduler.__agentStudyScheduler) {
    return globalForStudyScheduler.__agentStudyScheduler;
  }

  const pollMs = Number(process.env.AGENT_STUDY_SCHEDULER_POLL_MS ?? 30 * 60 * 1000);
  const scheduler = createScheduler({ name: 'agent-study', pollMs });
  scheduler.register('daily-study', () => runDailyStudyTick());
  scheduler.start();
  globalForStudyScheduler.__agentStudyScheduler = scheduler;
  console.log(`[agent-study-scheduler] started, polling every ${Math.round(pollMs / 60000)}min`);
  return scheduler;
}
