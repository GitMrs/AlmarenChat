import { createScheduler } from '../runtime/scheduler.mjs';
import prisma from '@/app/api/_lib/db';
import { getOrGenerateDailyStudy } from './service';
import { getLocalISODate, loadDailyStudyRecord } from './storage';

/**
 * 每日研习后台调度器
 *
 * 规则：
 * - 本地时间到达 DAILY_STUDY_HOUR（默认 8 点）后才触发当天的研习
 * - 只处理 AgentModelSetting.dailyStudyEnabled = true 的 (userId, agentId)
 * - 今日记录已存在则跳过（记录文件即完成标记）
 * - 用户最后一条消息距今超过 DAILY_STUDY_ACTIVE_DAYS（默认 3 天）→ 休眠，不再偷偷学习
 * - 单个 Agent 失败不影响其他；失败下轮自然重试
 * - 用户回来聊天时走懒生成路径自动唤醒，无需调度器特殊处理
 */

export interface DailyStudyTickDeps {
  now?: Date;
  today?: string;
  hourThreshold?: number;
  activeWindowDays?: number;
  listEnabledPairs?: () => Promise<Array<{ userId: string; agentId: string }>>;
  hasTodayRecord?: (agentId: string, date: string, userId: string) => Promise<boolean>;
  lastUserMessageAt?: (userId: string, agentId: string) => Promise<Date | null>;
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
  const hourThreshold = deps.hourThreshold ?? Number(process.env.DAILY_STUDY_HOUR ?? 8);
  const activeWindowDays =
    deps.activeWindowDays ?? Number(process.env.DAILY_STUDY_ACTIVE_DAYS ?? 3);

  // 1. 本地小时未到阈值，整天还没"醒来"
  if (now.getHours() < hourThreshold) {
    return { generated: 0, skipped: 0, failed: 0 };
  }

  const listEnabledPairs =
    deps.listEnabledPairs ||
    (async () => {
      const db: any = (prisma as any)?.default || prisma;
      if (!db?.agentModelSetting?.findMany) return [];
      return db.agentModelSetting.findMany({
        where: { dailyStudyEnabled: true },
        select: { userId: true, agentId: true },
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
    ((agentId: string, userId: string) => getOrGenerateDailyStudy(agentId, userId));

  const pairs = await listEnabledPairs();
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const pair of pairs) {
    try {
      if (await hasTodayRecord(pair.agentId, today, pair.userId)) {
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

      await generate(pair.agentId, pair.userId);
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
