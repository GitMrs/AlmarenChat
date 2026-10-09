import prisma from '@/app/api/_lib/db';
import { getCryptoMarketData } from './okx-service';
import { randomUUID } from 'node:crypto';

export interface AmbushPlanItem {
  id: string;
  symbol: string;
  name: string;
  direction: 'LONG' | 'SHORT';
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  invalidationPrice: number;
  createdAt: string;
  expiresInHours: number;
  watchEnabled?: boolean;
  notifyQQ?: boolean;
}

export interface ActivePositionItem {
  id: string;
  symbol: string;
  name: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  leverage: number;
  positionSizeUsd: number;
  openedAt: string;
  watchEnabled?: boolean;
  notifyQQ?: boolean;
}

export interface SentinelState {
  spaceId: string;
  userId?: string;
  serverSentinelEnabled: boolean;
  autoSyncChatPlans?: boolean;
  deletedSignatures?: string[];
  ambushPlans: AmbushPlanItem[];
  activePositions: ActivePositionItem[];
  reviews?: any[];
  lastCheckedAt?: string;
  updatedAt?: string;
}

// 告警防刷屏冷却缓存：key -> 告警时间戳 (ms)
const alertCooldownMap = new Map<string, number>();

/**
 * 检查告警是否处于冷却期内（避免同一单同一事件反复刷屏）
 */
function isAlertInCooldown(key: string, cooldownMs: number): boolean {
  const lastTime = alertCooldownMap.get(key);
  if (!lastTime) return false;
  return Date.now() - lastTime < cooldownMs;
}

function recordAlertCooldown(key: string) {
  alertCooldownMap.set(key, Date.now());
}

/**
 * 从 Prisma 读取 Space 的盯盘状态
 * 采用 Space.templateSnapshot.sentinelState 统一存储，百分之百生产环境兼容
 */
export async function getSentinelState(spaceId: string): Promise<SentinelState> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, userId: true, templateSnapshot: true },
  });

  if (!space) {
    return {
      spaceId,
      serverSentinelEnabled: true,
      ambushPlans: [],
      activePositions: [],
      reviews: [],
    };
  }

  const snapshot = (space.templateSnapshot && typeof space.templateSnapshot === 'object')
    ? (space.templateSnapshot as Record<string, unknown>)
    : {};

  const sentinel = (snapshot.sentinelState && typeof snapshot.sentinelState === 'object')
    ? (snapshot.sentinelState as Record<string, unknown>)
    : {};

  let ambushPlans = Array.isArray(sentinel.ambushPlans) ? (sentinel.ambushPlans as AmbushPlanItem[]) : [];
  let activePositions = Array.isArray(sentinel.activePositions) ? (sentinel.activePositions as ActivePositionItem[]) : [];
  const reviews = Array.isArray(sentinel.reviews) ? sentinel.reviews : [];



  return {
    spaceId: space.id,
    userId: space.userId,
    serverSentinelEnabled: sentinel.serverSentinelEnabled !== false,
    autoSyncChatPlans: sentinel.autoSyncChatPlans === true,
    deletedSignatures: Array.isArray(sentinel.deletedSignatures) ? (sentinel.deletedSignatures as string[]) : [],
    ambushPlans,
    activePositions,
    reviews,
    lastCheckedAt: typeof sentinel.lastCheckedAt === 'string' ? sentinel.lastCheckedAt : undefined,
    updatedAt: typeof sentinel.updatedAt === 'string' ? sentinel.updatedAt : undefined,
  };
}

/**
 * 保存 Space 盯盘状态到 Prisma
 */
export async function saveSentinelState(
  spaceId: string,
  userId: string,
  state: {
    ambushPlans?: AmbushPlanItem[];
    activePositions?: ActivePositionItem[];
    reviews?: any[];
    serverSentinelEnabled?: boolean;
    autoSyncChatPlans?: boolean;
    deletedSignatures?: string[];
  }
): Promise<SentinelState> {
  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, userId: true, templateSnapshot: true },
  });

  if (!space) {
    throw new Error(`Space not found: ${spaceId}`);
  }

  const existingSnapshot = (space.templateSnapshot && typeof space.templateSnapshot === 'object')
    ? (space.templateSnapshot as Record<string, unknown>)
    : {};

  const existingSentinel = (existingSnapshot.sentinelState && typeof existingSnapshot.sentinelState === 'object')
    ? (existingSnapshot.sentinelState as Record<string, unknown>)
    : {};

  const ambushPlans = state.ambushPlans !== undefined
    ? state.ambushPlans
    : ((existingSentinel.ambushPlans as AmbushPlanItem[]) || []);
  const activePositions = state.activePositions !== undefined
    ? state.activePositions
    : ((existingSentinel.activePositions as ActivePositionItem[]) || []);
  const reviews = state.reviews !== undefined
    ? state.reviews
    : (Array.isArray(existingSentinel.reviews) ? existingSentinel.reviews : []);
  const serverSentinelEnabled = state.serverSentinelEnabled !== undefined
    ? state.serverSentinelEnabled
    : (existingSentinel.serverSentinelEnabled !== false);
  const autoSyncChatPlans = state.autoSyncChatPlans !== undefined
    ? state.autoSyncChatPlans
    : (existingSentinel.autoSyncChatPlans === true);
  const deletedSignatures = state.deletedSignatures !== undefined
    ? state.deletedSignatures
    : (Array.isArray(existingSentinel.deletedSignatures) ? (existingSentinel.deletedSignatures as string[]) : []);
  const now = new Date().toISOString();

  const newSentinelState = {
    ...existingSentinel,
    ambushPlans,
    activePositions,
    reviews,
    serverSentinelEnabled,
    autoSyncChatPlans,
    deletedSignatures,
    updatedAt: now,
  };

  await prisma.space.update({
    where: { id: spaceId },
    data: {
      templateSnapshot: {
        ...existingSnapshot,
        sentinelState: newSentinelState,
      } as any,
    },
  });

  return {
    spaceId,
    userId: space.userId,
    serverSentinelEnabled,
    autoSyncChatPlans,
    deletedSignatures,
    ambushPlans,
    activePositions,
    reviews,
    updatedAt: now,
  };
}

export interface CheckAlert {
  type: 'INVALIDATION' | 'ENTRY_ZONE' | 'TP_HIT' | 'SL_HIT';
  symbol: string;
  title: string;
  content: string;
  level: 'INFO' | 'WARN' | 'CRITICAL';
  notifyQQ: boolean;
}

/**
 * 核心盯盘校验逻辑
 * 纯粹专注于【伏击哨】和【护航哨】，消灭所有宏观冗余，自带告警防刷屏机制
 */
export async function checkSentinelForSpace(
  spaceId: string,
  triggerSource: 'CRON' | 'MANUAL' | 'API' = 'API'
): Promise<{
  alerts: CheckAlert[];
  checkedSymbols: string[];
  lastCheckedAt: string;
}> {
  const state = await getSentinelState(spaceId);
  if (!state.serverSentinelEnabled) {
    return { alerts: [], checkedSymbols: [], lastCheckedAt: new Date().toISOString() };
  }

  const allSymbols = Array.from(
    new Set([
      'BTC',
      ...state.ambushPlans.map((p) => p.symbol),
      ...state.activePositions.map((p) => p.symbol),
    ])
  );

  const marketMap: Record<string, any> = {};
  for (const sym of allSymbols) {
    try {
      const snap = await getCryptoMarketData(sym);
      if (snap) marketMap[sym] = snap;
    } catch {}
  }

  const alerts: CheckAlert[] = [];

  // 1. 检查伏击哨（未开单 · 埋伏阶段）
  for (const plan of state.ambushPlans) {
    if (plan.watchEnabled === false) continue; // 单笔单独暂停
    const snap = marketMap[plan.symbol];
    if (!snap || snap.price <= 0) continue;
    const price = snap.price;
    const isLong = plan.direction === 'LONG';
    const notifyQQ = plan.notifyQQ !== false;

    if (isLong) {
      // 跌破失效位 (10 分钟防刷屏)
      if (price <= plan.invalidationPrice) {
        const alertKey = `${spaceId}:plan:${plan.id}:INVALIDATION`;
        if (!isAlertInCooldown(alertKey, 10 * 60 * 1000)) {
          recordAlertCooldown(alertKey);
          alerts.push({
            type: 'INVALIDATION',
            symbol: plan.symbol,
            title: `🚨 ${plan.symbol} 多单结构失效预警！`,
            content: `【鹰眼·撤单警报】：现价 $${price.toLocaleString()} 已跌穿【${plan.name}】结构失效防守线 $${plan.invalidationPrice.toLocaleString()}！原做多逻辑彻底破坏，请立即前往交易所全部撤单，严防意外被套！`,
            level: 'CRITICAL',
            notifyQQ,
          });
        }
      }
      // 触及挂单区间 (15 分钟防刷屏)
      else if (price >= plan.entryMin && price <= plan.entryMax) {
        const alertKey = `${spaceId}:plan:${plan.id}:ENTRY_ZONE`;
        if (!isAlertInCooldown(alertKey, 15 * 60 * 1000)) {
          recordAlertCooldown(alertKey);
          alerts.push({
            type: 'ENTRY_ZONE',
            symbol: plan.symbol,
            title: `⚡ ${plan.symbol} 现价进入挂单区间`,
            content: `【鹰眼·战备提醒】：现价 $${price.toLocaleString()} 已进入【${plan.name}】挂单区间 ($${plan.entryMin.toLocaleString()} - $${plan.entryMax.toLocaleString()})！密切关注 15m 企稳收线信号，准备入场！`,
            level: 'WARN',
            notifyQQ,
          });
        }
      }
    } else {
      // 空单冲破失效位 (10 分钟防刷屏)
      if (price >= plan.invalidationPrice) {
        const alertKey = `${spaceId}:plan:${plan.id}:INVALIDATION`;
        if (!isAlertInCooldown(alertKey, 10 * 60 * 1000)) {
          recordAlertCooldown(alertKey);
          alerts.push({
            type: 'INVALIDATION',
            symbol: plan.symbol,
            title: `🚨 ${plan.symbol} 空单结构失效预警！`,
            content: `【鹰眼·撤单警报】：现价 $${price.toLocaleString()} 已放量冲破【${plan.name}】结构失效线 $${plan.invalidationPrice.toLocaleString()}！空头逻辑作废，严禁盲目挂空，请立即撤单！`,
            level: 'CRITICAL',
            notifyQQ,
          });
        }
      } else if (price >= plan.entryMin && price <= plan.entryMax) {
        const alertKey = `${spaceId}:plan:${plan.id}:ENTRY_ZONE`;
        if (!isAlertInCooldown(alertKey, 15 * 60 * 1000)) {
          recordAlertCooldown(alertKey);
          alerts.push({
            type: 'ENTRY_ZONE',
            symbol: plan.symbol,
            title: `⚡ ${plan.symbol} 现价进入挂空区间`,
            content: `【鹰眼·战备提醒】：现价 $${price.toLocaleString()} 已进入【${plan.name}】挂单区间 ($${plan.entryMin.toLocaleString()} - $${plan.entryMax.toLocaleString()})！密切关注 15m 滞涨信号！`,
            level: 'WARN',
            notifyQQ,
          });
        }
      }
    }
  }

  // 2. 检查护航哨（已开单 · 实时持仓）
  for (const pos of state.activePositions) {
    if (pos.watchEnabled === false) continue; // 单笔单独暂停
    const snap = marketMap[pos.symbol];
    if (!snap || snap.price <= 0) continue;
    const price = snap.price;
    const isLong = pos.direction === 'LONG';
    const notifyQQ = pos.notifyQQ !== false;

    const hitTP1 = isLong ? price >= pos.takeProfit1 : price <= pos.takeProfit1;
    const hitSL = isLong ? price <= pos.stopLoss : price >= pos.stopLoss;

    if (hitSL) {
      const alertKey = `${spaceId}:pos:${pos.id}:SL_HIT`;
      if (!isAlertInCooldown(alertKey, 10 * 60 * 1000)) {
        recordAlertCooldown(alertKey);
        alerts.push({
          type: 'SL_HIT',
          symbol: pos.symbol,
          title: `🚨 ${pos.symbol} 触及防守止损线！`,
          content: `【鹰眼·铁面止损】：现价 $${price.toLocaleString()} 已击穿【${pos.name}】止损位 $${pos.stopLoss.toLocaleString()}！雷震铁律：严禁逆势扛单与补仓，坚决服从风控离场！`,
          level: 'CRITICAL',
          notifyQQ,
        });
      }
    } else if (hitTP1) {
      const alertKey = `${spaceId}:pos:${pos.id}:TP_HIT`;
      if (!isAlertInCooldown(alertKey, 15 * 60 * 1000)) {
        recordAlertCooldown(alertKey);
        alerts.push({
          type: 'TP_HIT',
          symbol: pos.symbol,
          title: `🎯 ${pos.symbol} 触达 TP1 第一止盈目标！`,
          content: `【鹰眼·止盈推保本】：现价 $${price.toLocaleString()} 已到达【${pos.name}】TP1 目标 $${pos.takeProfit1.toLocaleString()}！建议立即平仓 50% 锁定利润，并将剩余持仓止损拉至开仓价保本！`,
          level: 'INFO',
          notifyQQ,
        });
      }
    }
  }

  const now = new Date().toISOString();

  // 更新最后巡检时间
  try {
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { templateSnapshot: true },
    });
    if (space?.templateSnapshot && typeof space.templateSnapshot === 'object') {
      const snap = space.templateSnapshot as Record<string, unknown>;
      const sentinel = (snap.sentinelState && typeof snap.sentinelState === 'object')
        ? (snap.sentinelState as Record<string, unknown>)
        : {};
      await prisma.space.update({
        where: { id: spaceId },
        data: {
          templateSnapshot: {
            ...snap,
            sentinelState: {
              ...sentinel,
              lastCheckedAt: now,
            },
          } as any,
        },
      });
    }
  } catch {}

  // 3. 若有告警产生，写入空间聊天并推送 QQ
  if (alerts.length > 0) {
    const alertDigest = alerts.map((a) => `**${a.title}**\n${a.content}`).join('\n\n---\n\n');

    // 写入空间群聊记录 (使用 Prisma)
    try {
      await prisma.spaceMessage.create({
        data: {
          id: `msg-sentinel-${Date.now()}-${randomUUID().slice(0, 6)}`,
          spaceId,
          role: 'assistant',
          speakerAgentId: 'crypto-ticker-sentinel',
          content: `🦅 **【鹰眼·离线后台哨兵速报】**\n\n${alertDigest}`,
        },
      });
    } catch (e: any) {
      console.warn('[CryptoSentinel] write SpaceMessage via Prisma failed:', e?.message);
    }

    // 若用户配置了 QQ，推送 AssistantReminder 触发手机 QQ 私聊 (使用 Prisma)
    if (state.userId) {
      try {
        const qqBinding = await prisma.assistantQQBinding.findFirst({
          where: {
            userId: state.userId,
            enabled: true,
            qqOpenId: { not: null },
          },
        });
        if (qqBinding) {
          for (const alert of alerts) {
            if (alert.notifyQQ) {
              const reminderId = `rem-sentinel-${Date.now()}-${randomUUID().slice(0, 6)}`;
              await prisma.assistantReminder.create({
                data: {
                  id: reminderId,
                  userId: state.userId,
                  content: `🦅【加密合约作战室·紧急盘面告警】\n${alert.title}\n${alert.content}`,
                  dueTime: new Date(),
                  status: 'PENDING',
                },
              });
            }
          }
        }
      } catch (e: any) {
        console.warn('[CryptoSentinel] push QQ reminder via Prisma failed:', e?.message);
      }
    }
  }

  return {
    alerts,
    checkedSymbols: allSymbols,
    lastCheckedAt: now,
  };
}

// ----------------- 服务端常驻 7×24H 自动守护调度器 -----------------
interface SentinelSchedulerState {
  started: boolean;
  intervalId?: NodeJS.Timeout;
  isChecking: boolean;
}

const globalForSentinel = globalThis as unknown as {
  __cryptoSentinelScheduler?: SentinelSchedulerState;
};

const schedulerState: SentinelSchedulerState = globalForSentinel.__cryptoSentinelScheduler || {
  started: false,
  isChecking: false,
};

globalForSentinel.__cryptoSentinelScheduler = schedulerState;

/**
 * 启动 7×24H 云端离线自动盯盘调度器
 * 即使浏览器关闭，服务端每 30 秒自动巡检一次所有开启了盯盘的活跃合约空间
 */
export function startCryptoSentinelScheduler() {
  if (schedulerState.started) return;
  schedulerState.started = true;
  console.log('[crypto-sentinel-scheduler] Started 7×24H crypto sentinel background scheduler (interval: 30s)');

  schedulerState.intervalId = setInterval(async () => {
    if (schedulerState.isChecking) return;
    schedulerState.isChecking = true;
    try {
      // 通过 Prisma 查询所有 crypto-contract-trading 模板的活跃空间
      const cryptoSpaces = await prisma.space.findMany({
        where: {
          templateId: 'crypto-contract-trading',
        },
        select: { id: true, templateSnapshot: true },
      });

      for (const sp of cryptoSpaces) {
        const snap = sp.templateSnapshot && typeof sp.templateSnapshot === 'object'
          ? (sp.templateSnapshot as Record<string, unknown>)
          : {};
        const sentinel = (snap.sentinelState && typeof snap.sentinelState === 'object')
          ? (snap.sentinelState as Record<string, unknown>)
          : {};

        if (sentinel.serverSentinelEnabled !== false) {
          const plans = Array.isArray(sentinel.ambushPlans) ? sentinel.ambushPlans : [];
          const positions = Array.isArray(sentinel.activePositions) ? sentinel.activePositions : [];
          if (plans.length > 0 || positions.length > 0) {
            await checkSentinelForSpace(sp.id, 'CRON');
          }
        }
      }
    } catch (e: any) {
      console.warn('[crypto-sentinel-scheduler] cron check error:', e?.message);
    } finally {
      schedulerState.isChecking = false;
    }
  }, 30 * 1000);
}
