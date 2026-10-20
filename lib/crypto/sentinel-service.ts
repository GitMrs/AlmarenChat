import prisma from '@/app/api/_lib/db';
import { getCryptoMarketData } from './okx-service';
import { randomUUID } from 'node:crypto';
import { createScheduler } from '../runtime/scheduler.mjs';
import { collectNextEventMarketWindow } from './event-market-collector.ts';
import { isPlanExpired } from './trade-lifecycle';
import {
  evaluateEventPhase,
  filterEventsForSpace,
} from './event-temporal.ts';
import { readCryptoEventsFromDisk, syncMacroEvents } from './event-sync.ts';

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
  sourceMessageId?: string;
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
  decisionStatuses?: Record<string, 'accepted' | 'rejected'>;
  handledDecisionIds?: string[];
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
      serverSentinelEnabled: false,
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
  const decisionStatuses = (sentinel.decisionStatuses && typeof sentinel.decisionStatuses === 'object')
    ? (sentinel.decisionStatuses as Record<string, 'accepted' | 'rejected'>)
    : {};
  const handledDecisionIds = Array.isArray(sentinel.handledDecisionIds)
    ? (sentinel.handledDecisionIds as string[])
    : [];

  return {
    spaceId: space.id,
    userId: space.userId,
    serverSentinelEnabled: sentinel.serverSentinelEnabled !== false,
    autoSyncChatPlans: sentinel.autoSyncChatPlans === true,
    deletedSignatures: Array.isArray(sentinel.deletedSignatures) ? (sentinel.deletedSignatures as string[]) : [],
    decisionStatuses,
    handledDecisionIds,
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
    decisionStatuses?: Record<string, 'accepted' | 'rejected'>;
    handledDecisionIds?: string[];
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
  const decisionStatuses = state.decisionStatuses !== undefined
    ? state.decisionStatuses
    : ((existingSentinel.decisionStatuses as Record<string, 'accepted' | 'rejected'>) || {});
  const handledDecisionIds = state.handledDecisionIds !== undefined
    ? state.handledDecisionIds
    : ((existingSentinel.handledDecisionIds as string[]) || []);
  const now = new Date().toISOString();

  const newSentinelState = {
    ...existingSentinel,
    ambushPlans,
    activePositions,
    reviews,
    serverSentinelEnabled,
    autoSyncChatPlans,
    deletedSignatures,
    decisionStatuses,
    handledDecisionIds,
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
  type: 'INVALIDATION' | 'ENTRY_ZONE' | 'TP_HIT' | 'SL_HIT' | 'MACRO_EVENT';
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
  triggerSource: 'CRON' | 'MANUAL' | 'API' = 'API',
  sharedMarketMap?: Record<string, any>
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

  const marketMap: Record<string, any> = sharedMarketMap ? { ...sharedMarketMap } : {};
  for (const sym of allSymbols) {
    if (!marketMap[sym]) {
      try {
        const snap = await getCryptoMarketData(sym);
        if (snap) marketMap[sym] = snap;
      } catch {}
    }
  }

  const alerts: CheckAlert[] = [];

  // 1. 检查伏击哨（未开单 · 埋伏阶段）
  for (const plan of state.ambushPlans) {
    if (plan.watchEnabled === false) continue; // 单笔单独暂停
    if (isPlanExpired(plan)) continue; // 关键防僵尸：超过生命周期的观察计划自动淘汰
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

  // 3. 检查临近的重大事件（事前提醒与事后早期观察分开，不自动生成完整复盘）。
  try {
    const nowObj = new Date();
    const globalEvents = filterEventsForSpace(await readCryptoEventsFromDisk(), [], allSymbols);
    for (const event of globalEvents) {
      if (event.volatilityTier < 2) continue;
      const { phase, deltaMinutes, countdownText } = evaluateEventPhase(event, nowObj);

      // ① 事前倒计时告警 (T-35m ~ T-10m) 且冷却防刷屏 60 分钟
      if (phase === 'IMPENDING' && deltaMinutes <= 35 && deltaMinutes >= 10) {
        const alertKey = `${spaceId}:event:${event.id}:T30M`;
        if (!isAlertInCooldown(alertKey, 60 * 60 * 1000)) {
          recordAlertCooldown(alertKey);
          alerts.push({
            type: 'MACRO_EVENT',
            symbol: event.impactCoins[0] || 'BTC',
            title: `⏳【决战倒计时】${event.title} 仅剩 ${countdownText}！`,
            content: `【鹰眼·宏观暴风雨预警】：重磅大事件【${event.title}】将于 ${countdownText} 后出炉！\n• 战备铁律：${event.guidance?.riskInstruction || '严禁追涨杀跌，持仓严格上移防守损！'}\n• 历史参考：过往同类事件双向插针概率极高，请持仓者做好防插针准备！`,
            level: 'CRITICAL',
            notifyQQ: true,
          });
        }
      }
      // ② 预定公布后 15~45 分钟的早期观察，不能替代事件窗口统计或实际公布值。
      else if (phase === 'DIGESTING' && deltaMinutes <= -15 && deltaMinutes >= -45) {
        const alertKey = `${spaceId}:event:${event.id}:DIGEST`;
        if (!isAlertInCooldown(alertKey, 2 * 60 * 60 * 1000)) {
          recordAlertCooldown(alertKey);
          const btcSnap = marketMap['BTC'];
          const quoteTime = Date.parse(btcSnap?.realtimeFetchedAt ?? '');
          const quoteAge = nowObj.getTime() - quoteTime;
          const hasQuote = btcSnap?.dataQuality?.ticker === true &&
            Number.isFinite(btcSnap.price) && btcSnap.price > 0 && quoteAge >= 0 && quoteAge <= 60_000;
          const candle = btcSnap?.candles15m?.[0];
          const hasCandle = hasQuote && btcSnap?.dataQuality?.candles15m === true &&
            Number.isFinite(candle?.open) && candle.open > 0 &&
            Number.isFinite(candle?.startTimeMs) &&
            candle.startTimeMs <= quoteTime && quoteTime < candle.startTimeMs + 15 * 60_000;
          const candleDelta = hasCandle ? (btcSnap.price - candle.open) / candle.open * 100 : null;
          const priceInfo = hasQuote
            ? `BTC现价 $${btcSnap.price.toLocaleString()}（行情采集 ${new Date(quoteTime).toISOString()}）。` +
              (candleDelta !== null
                ? `当前15分钟K线开盘以来涨跌 ${candleDelta >= 0 ? '+' : ''}${candleDelta.toFixed(2)}%；不等同于事件发布后的涨跌。`
                : '当前15分钟K线涨跌未知。')
            : 'BTC行情暂不可用，不能判断事件后的涨跌或形态。';

          alerts.push({
            type: 'MACRO_EVENT',
            symbol: event.impactCoins[0] || 'BTC',
            title: `🌊【事件早期观察】${event.title} 预定公布后 ${Math.round(-deltaMinutes)} 分钟`,
            content: `【鹰眼·早期观察】：${event.title} 已到预定公布时间 ${Math.round(-deltaMinutes)} 分钟，实际公布值与预期差尚未核验。\n• ${priceInfo}\n• 本条不构成完整复盘，1小时与24小时走势尚未完成核验，请继续观察。`,
            level: 'INFO',
            notifyQQ: state.activePositions.length > 0,
          });
        }
      }
    }
  } catch (err: any) {
    console.warn(`[CryptoSentinel] macro event check for space ${spaceId} failed:`, err?.message);
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
          const qqAlerts = alerts.filter((a) => a.notifyQQ !== false);
          if (qqAlerts.length === 1) {
            const a = qqAlerts[0];
            const reminderId = `rem-sentinel-${Date.now()}-${randomUUID().slice(0, 6)}`;
            await prisma.assistantReminder.create({
              data: {
                id: reminderId,
                userId: state.userId,
                content: `🦅【加密合约作战室·紧急盘面告警】\n${a.title}\n${a.content}`,
                dueTime: new Date(),
                status: 'PENDING',
              },
            });
          } else if (qqAlerts.length > 1) {
            const digestItems = qqAlerts.map((a, i) => `${i + 1}. ${a.title}\n${a.content}`).join('\n\n');
            const reminderId = `rem-sentinel-${Date.now()}-${randomUUID().slice(0, 6)}`;
            await prisma.assistantReminder.create({
              data: {
                id: reminderId,
                userId: state.userId,
                content: `🦅【加密合约作战室·盘面异动汇总 (${qqAlerts.length}笔)】\n\n${digestItems}\n\n请前往空间查看详细建议与盘面。`,
                dueTime: new Date(),
                status: 'PENDING',
              },
            });
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
  if (process.env.NODE_ENV === 'development' && process.env.ENABLE_SCHEDULERS !== 'true') return;
  schedulerState.started = true;
  console.log('[crypto-sentinel-scheduler] Started 7×24H crypto sentinel background scheduler (interval: 30s)');
  const scheduler = createScheduler({
    name: 'crypto-sentinel-scheduler',
    pollMs: 30 * 1000,
    logger: console,
  });
  scheduler.register('check-spaces', async () => {
    if (schedulerState.isChecking) return;
    schedulerState.isChecking = true;
    try {
      const cryptoSpaces = await prisma.space.findMany({
        where: { templateId: 'crypto-contract-trading' },
        select: { id: true, userId: true, templateSnapshot: true },
      });

      // 1. 扫描所有空间，收集有效且未过期的活跃标的，彻底杜绝僵尸单
      const activeSpaces: Array<{ id: string; userId: string; plans: AmbushPlanItem[]; positions: ActivePositionItem[] }> = [];
      const globalActiveSymbols = new Set<string>(['BTC']);

      // 检查是否有 3 星重大事件正处于前后约 2 小时的活跃时间窗口（T-35m 至 T+45m）
      const nowTime = new Date();
      const globalEvents = await readCryptoEventsFromDisk();
      const hasActiveEventWindow = globalEvents.some((e) => {
        if (e.volatilityTier < 2) return false;
        const delta = (new Date(e.timestamp).getTime() - nowTime.getTime()) / (60 * 1000);
        return delta >= -45 && delta <= 35;
      });

      for (const sp of cryptoSpaces) {
        const snap = sp.templateSnapshot && typeof sp.templateSnapshot === 'object'
          ? (sp.templateSnapshot as Record<string, unknown>)
          : {};
        const sentinel = (snap.sentinelState && typeof snap.sentinelState === 'object')
          ? (snap.sentinelState as Record<string, unknown>)
          : {};
        // 只要未显式关闭，默认自动开启静默守护
        if (sentinel.serverSentinelEnabled === false) continue;

        const rawPlans = Array.isArray(sentinel.ambushPlans) ? (sentinel.ambushPlans as AmbushPlanItem[]) : [];
        const activePositions = Array.isArray(sentinel.activePositions) ? (sentinel.activePositions as ActivePositionItem[]) : [];

        // 过滤掉超过 TTL 的僵尸计划和手动暂停的计划
        const activePlans = rawPlans.filter((p) => p.watchEnabled !== false && !isPlanExpired(p));
        const activeEscorts = activePositions.filter((p) => p.watchEnabled !== false);

        if (activePlans.length > 0 || activeEscorts.length > 0 || hasActiveEventWindow) {
          activeSpaces.push({ id: sp.id, userId: sp.userId, plans: activePlans, positions: activeEscorts });
          for (const p of activePlans) globalActiveSymbols.add(p.symbol);
          for (const pos of activeEscorts) globalActiveSymbols.add(pos.symbol);
        }
      }

      if (activeSpaces.length === 0) return;

      // 2. 【全局共享行情池】：对所有空间去重后的标的集中拉取一次，无论多少用户对 OKX 仅打一次请求
      const sharedMarketMap: Record<string, any> = {};
      await Promise.all(
        Array.from(globalActiveSymbols).map(async (sym) => {
          try {
            const snap = await getCryptoMarketData(sym);
            if (snap) sharedMarketMap[sym] = snap;
          } catch (err: any) {
            console.warn(`[crypto-sentinel-scheduler] shared fetch failed for ${sym}:`, err?.message);
          }
        })
      );

      // 3. 逐个空间在内存中比对守护逻辑
      for (const sp of activeSpaces) {
        try {
          await checkSentinelForSpace(sp.id, 'CRON', sharedMarketMap);
        } catch (err: any) {
          console.warn(`[crypto-sentinel-scheduler] check space ${sp.id} failed:`, err?.message);
        }
      }
    } finally {
      schedulerState.isChecking = false;
    }
  });

  // 注册宏观财经日历全自动动态采集任务：生产环境每 12 小时自动增量比对全球官方日历
  // ⚠️ 关键判断：本地启动开发环境 (development / local) 默认不自动联网获取外部数据，直接使用本地已持久化的 crypto-events.json
  // 仅在生产环境 (NODE_ENV === 'production') 或显式声明 ENABLE_MACRO_AUTO_SYNC='true' 时才自动增量巡检
  let lastMacroSyncAt = 0;
  const MACRO_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

  scheduler.register('sync-macro-calendar', async () => {
    // 本地开发启动默认跳过自动拉取，防止本地热重载打外网及触发频控；用户仍可在界面手动点击同步
    const isLocalDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    if (isLocalDev && process.env.ENABLE_MACRO_AUTO_SYNC !== 'true') {
      return;
    }

    const now = Date.now();
    if (now - lastMacroSyncAt < MACRO_SYNC_INTERVAL_MS) return;
    lastMacroSyncAt = now;
    try {
      const syncResult = await syncMacroEvents();
      console.log(
        `[crypto-sentinel-scheduler] 🌐 宏观大事件日历后台全自动同步成功: 库内共计 ${syncResult.total} 项 (新增 ${syncResult.addedCount}, 刷新 ${syncResult.updatedCount})`
      );
    } catch (err: any) {
      console.warn('[crypto-sentinel-scheduler] 宏观大事件日历后台同步告警:', err?.message || err);
    }
  });

  // 全局事件统计与房间/持仓无关；不阻塞原有空间巡检，采集器自身防止重入。
  scheduler.register('collect-event-market', () => {
    void collectNextEventMarketWindow().catch((error) => {
      console.warn('[crypto-sentinel-scheduler] 事件行情采集失败:', error?.message || error);
    });
  });

  scheduler.start();
}
