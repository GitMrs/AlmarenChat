'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  TrendingUp,
  Crosshair,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  MessagesSquare,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Clock,
  Zap,
  ArrowRight,
  FileText,
  DollarSign,
  Percent,
} from 'lucide-react';
import type { Agent, SpaceMessage } from '@/types';
import type { CryptoPlanDecision } from '@/lib/crypto/trade-lifecycle';
import { assistant as assistantApi, cryptoSentinel as cryptoSentinelApi, spaces as spacesApi } from '@/lib/api';

export interface SpaceCryptoCenterProps {
  spaceId: string;
  spaceAgents?: Agent[];
  messages?: SpaceMessage[];
  onBackToChat?: () => void;
  onShareToSpace?: (content: string) => void;
}

export interface AmbushPlan {
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
  lastReviewedAt?: string;
  lastReviewSummary?: string;
}

export interface ActivePosition {
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
  sourcePlanId?: string;
}

interface PendingCryptoDecision extends CryptoPlanDecision {
  sourceMessageId: string;
}

const isNewObservationDecision = (decision?: PendingCryptoDecision) => (
  decision?.mode === 'CREATE' && decision.action === 'WATCH'
);

interface SimulationDraft {
  sourcePlan: AmbushPlan;
  entryPrice: number;
  leverage: number;
  positionSizeUsd: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  sourceDecisionMessageId?: string;
}

export interface ReviewRecord {
  id: string;
  date: string;
  symbol: string;
  planName: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  pnlPercent: number;
  reason: 'TP_HIT' | 'SL_HIT' | 'BREAKEVEN' | 'MANUAL_EXIT';
  disciplineScore?: number;
  summary: string;
}

export default function SpaceCryptoCenter({
  spaceId,
  spaceAgents = [],
  messages = [],
  onBackToChat,
  onShareToSpace,
}: SpaceCryptoCenterProps) {
  const monitoringUiEnabled = false;
  const [symbol, setSymbol] = useState<string>('BTC');
  const [marketData, setMarketData] = useState<any>(null);
  const [marketLoading, setMarketLoading] = useState<boolean>(false);
  const [qqConnected, setQqConnected] = useState<boolean | null>(null);

  // 跨币种价格缓存池 (symbol -> price)
  const [pricePool, setPricePool] = useState<Record<string, number>>({});

  // 本地持久化 key
  const storageKey = `crypto-cockpit-${spaceId}`;
  const handledDecisionsStorageKey = `${storageKey}-handled-decisions-v2`;

  // 1. 伏击哨队列 (未开单 · 埋伏阶段)
  const [ambushPlans, setAmbushPlans] = useState<AmbushPlan[]>(() => {
    if (typeof window === 'undefined') return [];
    const saved = localStorage.getItem(`${storageKey}-ambush-list`);
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return [];
  });

  // 2. 模拟仓位队列
  const [activePositions, setActivePositions] = useState<ActivePosition[]>(() => {
    if (typeof window === 'undefined') return [];
    const saved = localStorage.getItem(`${storageKey}-position-list`);
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return [];
  });

  // 记录用户已主动撤销/删除过的战术签名（黑名单），确保删除是“真删除”，杜绝群聊历史旧消息把删掉的单子重新当作“新推演”强行加回
  const [deletedSignatures, setDeletedSignatures] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const saved = localStorage.getItem(`${storageKey}-deleted-signatures`);
    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return [];
  });

  // 3. 战绩复盘列表 (已平仓记录)
  const [reviews, setReviews] = useState<ReviewRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    const saved = localStorage.getItem(`${storageKey}-reviews`);
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return [];
  });

  // 7×24H 服务端云端盯盘状态（优先从本地即时恢复，随后自动与服务端数据库对齐）
  const [serverSentinelEnabled, setServerSentinelEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem(`${storageKey}-server-sentinel`);
    if (saved !== null) return saved === 'true';
    return false;
  });
  const [serverStateHydrated, setServerStateHydrated] = useState(false);
  const [serverCheckedAt, setServerCheckedAt] = useState<string | null>(null);
  const [checkingServer, setCheckingServer] = useState<boolean>(false);

  // 提示通知与同步状态
  const [syncingPlans, setSyncingPlans] = useState<boolean>(false);
  const [syncNotification, setSyncNotification] = useState<string | null>(null);

  // 伏击单行内编辑点位
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    entryMin: number;
    entryMax: number;
    stopLoss: number;
    takeProfit1: number;
    invalidationPrice: number;
  }>({
    entryMin: 0,
    entryMax: 0,
    stopLoss: 0,
    takeProfit1: 0,
    invalidationPrice: 0,
  });

  // 平仓结算弹窗状态
  const [settlingPosition, setSettlingPosition] = useState<ActivePosition | null>(null);
  const [settleExitPrice, setSettleExitPrice] = useState<number>(0);
  const [settleReason, setSettleReason] = useState<'TP_HIT' | 'SL_HIT' | 'BREAKEVEN' | 'MANUAL_EXIT'>('TP_HIT');
  const [settleNote, setSettleNote] = useState<string>('');
  const [settleShareToChat, setSettleShareToChat] = useState<boolean>(true);
  const [simulationDraft, setSimulationDraft] = useState<SimulationDraft | null>(null);

  // 历史复盘折叠展开开关
  const [historyExpanded, setHistoryExpanded] = useState<boolean>(true);

  const [autoSyncChatPlans] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<PendingCryptoDecision | null>(null);
  const [handledDecisionIds, setHandledDecisionIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const saved = localStorage.getItem(handledDecisionsStorageKey);
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const handledDecisionIdsRef = useRef(handledDecisionIds);
  useEffect(() => {
    handledDecisionIdsRef.current = handledDecisionIds;
  }, [handledDecisionIds]);

  const computeSinglePlanSignature = (p: {
    symbol: string;
    direction: string;
    entryMin: number;
    entryMax: number;
    stopLoss: number;
  }) => {
    return `${p.symbol}:${p.direction}:${p.entryMin}:${p.entryMax}:${p.stopLoss}`;
  };

  const markDecisionHandled = (messageId: string) => {
    setHandledDecisionIds((prev) => {
      const next = Array.from(new Set([...prev, messageId])).slice(-100);
      localStorage.setItem(handledDecisionsStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const latestDecisionFromMessages = (sourceMessages: SpaceMessage[]) => (
    [...sourceMessages].reverse().flatMap((message) => (message.attachments || [])
      .filter((item) => item.type === 'crypto_plan_decision_v1')
      .map((item) => ({ ...item as CryptoPlanDecision, sourceMessageId: message.id })))[0]
  ) as PendingCryptoDecision | undefined;

  const checkForCryptoDecisions = async (isManualClick = false) => {
    setSyncingPlans(true);
    try {
      const data = await spacesApi.messages(spaceId, { limit: 30 });
      const responseMessages = Array.isArray(data.messages) ? data.messages : [];
      const latestDecision = latestDecisionFromMessages(responseMessages);
      const latest = latestDecision
        && !isNewObservationDecision(latestDecision)
        && (isManualClick || !handledDecisionIdsRef.current.includes(latestDecision.sourceMessageId))
        ? latestDecision
        : undefined;

      setPendingDecision(latest || null);
      if (isManualClick) {
        setSyncNotification(isNewObservationDecision(latestDecision)
          ? '新观察计划请在聊天消息中确认。'
          : latest
            ? '已找到一条待确认的计划变更。'
            : '近期没有尚未处理的计划变更。');
        setTimeout(() => setSyncNotification(null), 3500);
      }
    } catch (e) {
      console.warn('[SpaceCryptoCenter] check crypto decisions failed', e);
      if (isManualClick) {
        setSyncNotification('读取交易决策失败，请检查网络连接');
        setTimeout(() => setSyncNotification(null), 3000);
      }
    } finally {
      setSyncingPlans(false);
    }
  };

  function planFromDecision(decision: PendingCryptoDecision): AmbushPlan | null {
    const plan = decision.proposedPlan;
    if (!plan) return null;
    return {
      id: decision.targetPlanId || `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      symbol: plan.symbol,
      name: plan.name,
      direction: plan.direction,
      entryMin: plan.entryMin,
      entryMax: plan.entryMax,
      stopLoss: plan.stopLoss,
      takeProfit1: plan.takeProfit1,
      takeProfit2: plan.takeProfit2,
      invalidationPrice: plan.invalidationPrice,
      createdAt: new Date().toISOString(),
      expiresInHours: 8,
      watchEnabled: false,
      notifyQQ: false,
      sourceMessageId: decision.sourceMessageId,
      lastReviewedAt: decision.analyzedAt,
      lastReviewSummary: decision.summary,
    };
  }

  const openSimulationDraft = (plan: AmbushPlan, sourceDecisionMessageId?: string) => {
    const livePrice = pricePool[plan.symbol] || (plan.symbol === symbol ? curPrice : 0);
    setSimulationDraft({
      sourcePlan: plan,
      entryPrice: livePrice || plan.entryMin,
      leverage: 1,
      positionSizeUsd: 1000,
      stopLoss: plan.stopLoss,
      takeProfit1: plan.takeProfit1,
      takeProfit2: plan.takeProfit2,
      sourceDecisionMessageId,
    });
  };

  const applyPendingDecision = () => {
    if (!pendingDecision) return;
    const decision = pendingDecision;
    const targetPlan = decision.targetPlanId
      ? ambushPlans.find((plan) => plan.id === decision.targetPlanId)
      : null;

    if (decision.mode === 'REVIEW' && !targetPlan) {
      markDecisionHandled(decision.sourceMessageId);
      setPendingDecision(null);
      setSyncNotification('对应的观察计划已经不存在，本次复查结果未应用。');
      setTimeout(() => setSyncNotification(null), 3500);
      return;
    }

    if (decision.action === 'ENTER_SIMULATION') {
      const plan = targetPlan || planFromDecision(decision);
      if (!plan) return;
      openSimulationDraft(plan, decision.sourceMessageId);
      return;
    }

    if (decision.action === 'INVALIDATE') {
      if (decision.targetPlanId) {
        setAmbushPlans((prev) => prev.filter((plan) => plan.id !== decision.targetPlanId));
      }
    } else if (decision.action === 'MAINTAIN') {
      if (decision.targetPlanId) {
        setAmbushPlans((prev) => prev.map((plan) => plan.id === decision.targetPlanId
          ? { ...plan, lastReviewedAt: decision.analyzedAt, lastReviewSummary: decision.summary }
          : plan));
      }
    } else {
      const nextPlan = planFromDecision(decision);
      if (!nextPlan) return;
      setAmbushPlans((prev) => {
        if (prev.some((plan) => plan.sourceMessageId === decision.sourceMessageId)) return prev;
        const existingIndex = decision.targetPlanId
          ? prev.findIndex((plan) => plan.id === decision.targetPlanId)
          : -1;
        if (existingIndex < 0) return [...prev, nextPlan];
        return prev.map((plan, index) => index === existingIndex
          ? { ...nextPlan, createdAt: plan.createdAt }
          : plan);
      });
    }

    markDecisionHandled(decision.sourceMessageId);
    setPendingDecision(null);
    setSyncNotification('已应用本次特战队决策。');
    setTimeout(() => setSyncNotification(null), 3000);
  };

  const dismissPendingDecision = () => {
    if (!pendingDecision) return;
    markDecisionHandled(pendingDecision.sourceMessageId);
    setPendingDecision(null);
    setSyncNotification('已忽略本次特战队决策，当前数据保持不变。');
    setTimeout(() => setSyncNotification(null), 3000);
  };

  // 用户手动撤销/删除伏击单（彻底真删除，并记录签名黑名单，防止旧群聊消息强行复活）
  const handleDeleteAmbushPlan = (planId: string) => {
    const target = ambushPlans.find((p) => p.id === planId);
    if (target) {
      const sig = computeSinglePlanSignature(target);
      setDeletedSignatures((prev) => {
        const next = Array.from(new Set([...prev, sig]));
        if (typeof window !== 'undefined') {
          localStorage.setItem(`${storageKey}-deleted-signatures`, JSON.stringify(next));
        }
        return next;
      });
    }
    setAmbushPlans((prev) => prev.filter((p) => p.id !== planId));
    setSyncNotification('已成功撤销该埋伏方案');
    setTimeout(() => setSyncNotification(null), 3000);
  };

  // 用户移除持仓单
  const handleRemovePosition = (posId: string) => {
    setActivePositions((prev) => prev.filter((p) => p.id !== posId));
    setSyncNotification('已移除该持仓单');
    setTimeout(() => setSyncNotification(null), 3000);
  };

  // 读取加密空间中的结构化最终决策（初始挂载 + 15 秒轻轮询）
  useEffect(() => {
    if (!serverStateHydrated) return;
    void checkForCryptoDecisions(false);
    const interval = setInterval(() => {
      void checkForCryptoDecisions(false);
    }, 15000);
    return () => clearInterval(interval);
  }, [spaceId, serverStateHydrated]);

  useEffect(() => {
    if (!serverStateHydrated) return;
    const latest = latestDecisionFromMessages(messages);
    if (latest && !isNewObservationDecision(latest) && !handledDecisionIdsRef.current.includes(latest.sourceMessageId)) {
      setPendingDecision(latest);
    } else if (isNewObservationDecision(latest)) {
      setPendingDecision(null);
    }
  }, [messages, serverStateHydrated]);

  // 从服务端读取持久化状态
  useEffect(() => {
    cryptoSentinelApi.get(spaceId)
      .then((res) => {
        if (res?.success && res.data) {
          const d = res.data;
          // 哪怕服务端是空数组 [] 也真实采纳，绝不强行回退示范单
          if (Array.isArray(d.ambushPlans)) {
            setAmbushPlans(d.ambushPlans);
          }
          if (Array.isArray(d.activePositions)) {
            setActivePositions(d.activePositions);
          }
          if (Array.isArray(d.deletedSignatures)) {
            setDeletedSignatures(d.deletedSignatures);
          }
          if (typeof d.serverSentinelEnabled === 'boolean') {
            setServerSentinelEnabled(d.serverSentinelEnabled);
          }
          if (d.lastCheckedAt) {
            setServerCheckedAt(d.lastCheckedAt);
          }
        }
      })
      .catch((err) => console.warn('[SpaceCryptoCenter] load server sentinel failed:', err))
      .finally(() => setServerStateHydrated(true));
  }, [spaceId]);

  // 变动时防抖保存到服务端 SQLite
  useEffect(() => {
    if (!serverStateHydrated) return;
    const timer = setTimeout(() => {
      cryptoSentinelApi.save({
        spaceId,
        ambushPlans,
        activePositions,
        serverSentinelEnabled,
        autoSyncChatPlans,
        deletedSignatures,
      }).catch((e) => console.warn('[SpaceCryptoCenter] sync to server failed:', e));
    }, 1500);
    return () => clearTimeout(timer);
  }, [spaceId, ambushPlans, activePositions, serverSentinelEnabled, autoSyncChatPlans, deletedSignatures, serverStateHydrated]);

  // 本地轻持久化
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`${storageKey}-ambush-list`, JSON.stringify(ambushPlans));
  }, [ambushPlans, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`${storageKey}-position-list`, JSON.stringify(activePositions));
  }, [activePositions, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`${storageKey}-reviews`, JSON.stringify(reviews));
  }, [reviews, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`${storageKey}-server-sentinel`, String(serverSentinelEnabled));
  }, [serverSentinelEnabled, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`${storageKey}-deleted-signatures`, JSON.stringify(deletedSignatures));
  }, [deletedSignatures, storageKey]);

  // 手动触发一次云端巡检
  const triggerServerCheck = async () => {
    setCheckingServer(true);
    try {
      const result = await cryptoSentinelApi.check(spaceId);
      setServerCheckedAt(result.checkResult?.lastCheckedAt || new Date().toISOString());
      const count = result.checkResult?.alerts?.length || 0;
      setSyncNotification(
        count > 0
          ? `☁️ 云端巡检完成：检测到 ${count} 条告警，已写入日志并推送手机 QQ！`
          : '☁️ 云端巡检完成：当前盘面平稳，伏击与护航各单正常运行，未触碰失效/止损线。'
      );
      setTimeout(() => setSyncNotification(null), 5000);
    } catch {
      setSyncNotification('云端巡检连接失败，请检查网络');
      setTimeout(() => setSyncNotification(null), 4000);
    } finally {
      setCheckingServer(false);
    }
  };

  // 获取实时行情（主标的）
  const fetchMarket = async (targetSym: string) => {
    setMarketLoading(true);
    try {
      const res = await fetch(`/api/crypto/market?symbol=${encodeURIComponent(targetSym)}`);
      if (res.ok) {
        const json = await res.json();
        const payload = json.data ? { ...json.data, trapAnalysis: json.analysis } : json;
        setMarketData(payload);
        const p = Number(payload.price ?? 0);
        if (p > 0) {
          setPricePool((prev) => ({ ...prev, [targetSym]: p }));
        }
      }
    } catch (e) {
      console.warn('[SpaceCryptoCenter] fetch market failed', e);
    } finally {
      setMarketLoading(false);
    }
  };

  // 轮询队列中所有币种的最新现价（并发并行拉取，显著提升刷新敏捷度）
  const pollAllActiveSymbols = async () => {
    const allSymbols = Array.from(new Set([
      ...ambushPlans.map((p) => p.symbol),
      ...activePositions.map((p) => p.symbol),
    ])).filter((item) => item !== symbol);
    await Promise.all(
      allSymbols.map(async (s) => {
        try {
          const res = await fetch(`/api/crypto/market?symbol=${encodeURIComponent(s)}`);
          if (res.ok) {
            const json = await res.json();
            const p = Number(json.data?.price ?? json.price ?? 0);
            if (p > 0) {
              setPricePool((prev) => ({ ...prev, [s]: p }));
            }
          }
        } catch {}
      })
    );
  };

  useEffect(() => {
    void fetchMarket(symbol);
    void pollAllActiveSymbols();
    const interval = setInterval(() => {
      void fetchMarket(symbol);
      void pollAllActiveSymbols();
    }, 6000); // 6秒轻轮询多币种
    return () => clearInterval(interval);
  }, [symbol, ambushPlans, activePositions]);

  // 检查 QQ 绑定状态
  useEffect(() => {
    assistantApi.getQQBinding()
      .then((data) => {
        setQqConnected(Boolean(data?.binding?.configured && data?.binding?.enabled));
      })
      .catch(() => setQqConnected(false));
  }, []);

  const curPrice = Number(marketData?.price ?? marketData?.data?.price ?? 0);

  // 统计战绩数据
  const reviewStats = useMemo(() => {
    if (reviews.length === 0) return { totalPnl: 0, winRate: 0, totalCount: 0, winCount: 0 };
    const totalPnl = reviews.reduce((sum, r) => sum + (r.pnlUsd || 0), 0);
    const winCount = reviews.filter((r) => (r.pnlUsd || 0) > 0).length;
    const winRate = Math.round((winCount / reviews.length) * 100);
    return {
      totalPnl: Math.round(totalPnl),
      winRate,
      totalCount: reviews.length,
      winCount,
    };
  }, [reviews]);

  // 处理平仓结算确认
  const handleConfirmSettle = () => {
    if (!settlingPosition) return;
    const pos = settlingPosition;
    const exitPrice = settleExitPrice > 0 ? settleExitPrice : (pricePool[pos.symbol] || pos.entryPrice);
    const isLong = pos.direction === 'LONG';
    const priceDiff = isLong ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    const pnlUsd = pos.entryPrice > 0 ? (priceDiff / pos.entryPrice) * pos.positionSizeUsd : 0;
    const pnlPercent = pos.entryPrice > 0 ? (priceDiff / pos.entryPrice) * 100 * pos.leverage : 0;

    const newRecord: ReviewRecord = {
      id: `rev-${Date.now()}`,
      date: new Date().toLocaleDateString('zh-CN'),
      symbol: pos.symbol,
      planName: pos.name,
      direction: pos.direction,
      entryPrice: pos.entryPrice,
      exitPrice,
      pnlUsd: Math.round(pnlUsd),
      pnlPercent,
      reason: settleReason,
      summary: settleNote.trim() || `${pos.name} 平仓结案 (${settleReason === 'TP_HIT' ? '止盈落袋' : settleReason === 'SL_HIT' ? '止损断臂' : '保本离场'})`,
    };

    // 从持仓队列移除，沉淀到复盘记录
    setActivePositions((prev) => prev.filter((p) => p.id !== pos.id));
    setReviews((prev) => [newRecord, ...prev]);

    if (settleShareToChat) {
      const shareMsg = `📋 【实战结案播报】我已对【${pos.symbol} ${isLong ? '多' : '空'}单 · ${pos.name}】执行平仓了结！
- 开仓均价: $${pos.entryPrice.toLocaleString()} ➔ 平仓均价: $${exitPrice.toLocaleString()}
- 最终盈亏: ${Math.round(pnlUsd) >= 0 ? '+' : ''}$${Math.round(pnlUsd)} USDT (${pnlPercent.toFixed(2)}%)
- 出局方式: ${settleReason === 'TP_HIT' ? '🎯 止盈达成' : settleReason === 'SL_HIT' ? '🛑 止损出局' : '⚪ 保本出局'}
- 战术复盘: ${newRecord.summary}`;
      onShareToSpace?.(shareMsg);
    }

    setSyncNotification(`🎉 【${pos.symbol}】持仓已平仓了结，成功归档至下方战绩复盘！`);
    setTimeout(() => setSyncNotification(null), 4000);
    setSettlingPosition(null);
  };

  const handleConfirmSimulation = () => {
    if (!simulationDraft) return;
    const { sourcePlan } = simulationDraft;
    if (
      simulationDraft.entryPrice <= 0
      || simulationDraft.positionSizeUsd <= 0
      || simulationDraft.leverage <= 0
      || simulationDraft.stopLoss <= 0
      || simulationDraft.takeProfit1 <= 0
    ) {
      setSyncNotification('请填写有效的模拟成交参数。');
      setTimeout(() => setSyncNotification(null), 3000);
      return;
    }

    const invalidRisk = sourcePlan.direction === 'LONG'
      ? simulationDraft.stopLoss >= simulationDraft.entryPrice || simulationDraft.takeProfit1 <= simulationDraft.entryPrice
      : simulationDraft.stopLoss <= simulationDraft.entryPrice || simulationDraft.takeProfit1 >= simulationDraft.entryPrice;
    if (invalidRisk) {
      setSyncNotification('止损和止盈方向与模拟仓位方向不一致。');
      setTimeout(() => setSyncNotification(null), 3000);
      return;
    }

    const newPosition: ActivePosition = {
      id: `pos-${Date.now()}`,
      symbol: sourcePlan.symbol,
      name: sourcePlan.name,
      direction: sourcePlan.direction,
      entryPrice: simulationDraft.entryPrice,
      stopLoss: simulationDraft.stopLoss,
      takeProfit1: simulationDraft.takeProfit1,
      takeProfit2: simulationDraft.takeProfit2,
      leverage: simulationDraft.leverage,
      positionSizeUsd: simulationDraft.positionSizeUsd,
      openedAt: new Date().toISOString(),
      watchEnabled: false,
      notifyQQ: false,
      sourcePlanId: sourcePlan.id,
    };

    setActivePositions((prev) => [...prev, newPosition]);
    setAmbushPlans((prev) => prev.filter((plan) => plan.id !== sourcePlan.id));
    if (simulationDraft.sourceDecisionMessageId) {
      markDecisionHandled(simulationDraft.sourceDecisionMessageId);
      setPendingDecision(null);
    }
    setSimulationDraft(null);
    setSyncNotification(`已建立 ${sourcePlan.symbol} 模拟仓位。`);
    setTimeout(() => setSyncNotification(null), 3500);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#f8f9fa]">
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 space-y-5">
        {/* ==================== 顶部极简状态栏 ==================== */}
        <div className="rounded-2xl border border-black/[0.08] bg-white p-4 sm:p-5 shadow-sm space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white font-black text-lg shadow-sm">
                ⚡
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-black text-slate-950">加密合约推演作战室</h2>
                  {monitoringUiEnabled && qqConnected !== null && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                        qqConnected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {qqConnected ? '📱 QQ 通知就绪' : '📱 QQ 未连接'}
                    </span>
                  )}
                </div>
                <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                  左侧观察计划 · 右侧模拟仓位 · 下方模拟复盘
                </p>
              </div>
            </div>

            {/* 云端总控开关与操作按钮 */}
            <div className="flex flex-wrap items-center gap-2.5">
              {monitoringUiEnabled && <>
                <div className="flex items-center gap-2 rounded-xl border border-black/[0.08] bg-slate-50 px-3 py-1.5">
                <div className="flex flex-col text-right">
                  <div className="flex items-center gap-1.5 justify-end">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        serverSentinelEnabled ? 'bg-emerald-500 animate-ping' : 'bg-slate-300'
                      }`}
                    />
                    <span className="text-xs font-black text-slate-900">
                      7×24H 云端离线盯盘
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-semibold">
                    {serverSentinelEnabled ? '守护中 · 触及推 QQ' : '已暂停后台巡检'}
                  </span>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={serverSentinelEnabled}
                  onClick={() => {
                    const next = !serverSentinelEnabled;
                    setServerSentinelEnabled(next);
                    setSyncNotification(
                      next
                        ? '🟢 已成功开启服务端 7×24H 离线盯盘！即使关闭浏览器，触及点位也将持续推送手机 QQ。'
                        : '⏸️ 已暂停服务端离线盯盘，后台停止自动巡检。'
                    );
                    setTimeout(() => setSyncNotification(null), 4000);
                  }}
                  className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    serverSentinelEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                  title={serverSentinelEnabled ? '点击暂停云端离线巡检' : '点击开启云端离线巡检'}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      serverSentinelEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                </div>

                <button
                type="button"
                onClick={triggerServerCheck}
                disabled={checkingServer || !serverSentinelEnabled}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-50 px-2.5 text-xs font-black text-emerald-800 transition hover:bg-emerald-100 cursor-pointer disabled:opacity-40"
                title="立即要求后端执行一次全盘实盘条件巡检"
              >
                <RefreshCw size={12} className={checkingServer ? 'animate-spin' : ''} />
                巡检一次
                </button>
              </>}

              {onBackToChat && (
                <button
                  type="button"
                  onClick={onBackToChat}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 cursor-pointer"
                >
                  <MessagesSquare size={14} />
                  返回作战室
                </button>
              )}
            </div>
          </div>

          {/* 常用币种行情走势条 */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-black/[0.05] text-xs font-black">
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
              <span className="text-slate-400 text-[11px] shrink-0 mr-1">看盘:</span>
              {['BTC', 'ETH', 'SOL', 'DOGE', 'PEPE', 'SUI'].map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setSymbol(sym)}
                  className={`rounded-md px-2 py-0.5 text-xs font-black transition cursor-pointer shrink-0 ${
                    symbol === sym
                      ? 'bg-slate-950 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>

            {marketData && (
              <div className="flex items-center gap-3 text-[11px] font-black">
                <span className="text-slate-400">{symbol} 撮合价:</span>
                <span className="text-sm text-slate-950 font-black">${(curPrice || 0).toLocaleString()}</span>
                <span className={(marketData.priceDelta1hPercent ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                  1H: {(marketData.priceDelta1hPercent ?? 0) >= 0 ? '+' : ''}
                  {(typeof marketData.priceDelta1hPercent === 'number' ? marketData.priceDelta1hPercent : 0).toFixed(2)}%
                </span>
                <span className="text-slate-500 hidden sm:inline">
                  费率: {((typeof marketData.fundingRate === 'number' ? marketData.fundingRate : 0) * 100).toFixed(4)}%
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void fetchMarket(symbol);
                    void pollAllActiveSymbols();
                  }}
                  disabled={marketLoading}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  title="刷新行情"
                >
                  <RefreshCw size={12} className={marketLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 顶部同步浮窗通知 */}
        {syncNotification && (
          <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-2.5 text-xs font-black text-indigo-950 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-600 shrink-0" />
              {syncNotification}
            </span>
            <button
              type="button"
              onClick={() => setSyncNotification(null)}
              className="text-indigo-400 hover:text-indigo-700 cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* ==================== 主战场：左右双轨并排 ==================== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* ----------------- 左侧：观察计划 ----------------- */}
          <div className="rounded-2xl border-2 border-emerald-500/20 bg-white p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between border-b border-black/[0.06] pb-3 gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h3 className="text-sm font-black text-slate-950">
                  观察计划（{ambushPlans.length} 笔）
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void checkForCryptoDecisions(true)}
                  disabled={syncingPlans}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-black text-indigo-800 hover:bg-indigo-100 cursor-pointer disabled:opacity-50"
                  title="读取雷震最新给出的正式交易决策"
                >
                  <RefreshCw size={11} className={syncingPlans ? 'animate-spin' : ''} />
                  检查新决策
                </button>
              </div>
            </div>

            {pendingDecision && (
              <div className="rounded-xl border-2 border-indigo-400/35 bg-indigo-50/80 p-3.5 shadow-sm space-y-2.5 animate-in fade-in duration-200">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white text-xs font-black shadow-xs">
                      🎯
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-indigo-950">
                          计划变更待确认
                        </span>
                        <span className="rounded-full bg-indigo-200/80 px-2 py-0.5 text-[10px] font-black text-indigo-900">
                          {{
                            WATCH: '建立观察',
                            MAINTAIN: '继续维护',
                            UPDATE: '更新计划',
                            INVALIDATE: '结束观察',
                            ENTER_SIMULATION: '转为模拟',
                          }[pendingDecision.action]}
                        </span>
                      </div>
                      <p className="text-[11px] font-semibold text-indigo-700/90">
                        {pendingDecision.summary}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={applyPendingDecision}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700 shadow-xs transition cursor-pointer"
                    >
                      <CheckCircle2 size={13} />
                      确认执行
                    </button>
                    <button
                      type="button"
                      onClick={dismissPendingDecision}
                      className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                    >
                      <X size={13} />
                      忽略本次
                    </button>
                  </div>
                </div>

                {pendingDecision.proposedPlan && (() => {
                  const p = pendingDecision.proposedPlan;
                  const currentPlan = pendingDecision.targetPlanId
                    ? ambushPlans.find((plan) => plan.id === pendingDecision.targetPlanId)
                    : null;
                  return (
                    <div className="flex flex-col gap-1 rounded-lg border border-indigo-100 bg-white/95 p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                              p.direction === 'LONG'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {p.symbol} {p.direction === 'LONG' ? '做多' : '做空'}
                          </span>
                          <span className="font-black text-slate-900 truncate max-w-[150px]">
                            {p.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-black text-indigo-600 font-mono">
                          盈亏比 {p.rrRatio || '1:2'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-slate-600 font-semibold">
                        <span>
                          入场: <span className="font-mono font-bold text-slate-900">${p.entryMin.toLocaleString()} ~ ${p.entryMax.toLocaleString()}</span>
                        </span>
                        <span>
                          防守: <span className="font-mono font-bold text-rose-600">${p.stopLoss.toLocaleString()}</span>
                        </span>
                        <span>
                          目标: <span className="font-mono font-bold text-emerald-600">${p.takeProfit1.toLocaleString()}</span>
                        </span>
                      </div>
                      {pendingDecision.action === 'UPDATE' && currentPlan && (
                        <div className="mt-1 grid grid-cols-3 gap-1.5 border-t border-indigo-100 pt-2 text-[10px] font-semibold">
                          <div className="rounded bg-slate-50 px-2 py-1 text-slate-600">
                            入场 ${currentPlan.entryMin.toLocaleString()} - ${currentPlan.entryMax.toLocaleString()}
                            <ArrowRight size={10} className="mx-1 inline" />
                            <span className="text-indigo-700">${p.entryMin.toLocaleString()} - ${p.entryMax.toLocaleString()}</span>
                          </div>
                          <div className="rounded bg-slate-50 px-2 py-1 text-slate-600">
                            止损 ${currentPlan.stopLoss.toLocaleString()}
                            <ArrowRight size={10} className="mx-1 inline" />
                            <span className="text-rose-700">${p.stopLoss.toLocaleString()}</span>
                          </div>
                          <div className="rounded bg-slate-50 px-2 py-1 text-slate-600">
                            TP1 ${currentPlan.takeProfit1.toLocaleString()}
                            <ArrowRight size={10} className="mx-1 inline" />
                            <span className="text-emerald-700">${p.takeProfit1.toLocaleString()}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {ambushPlans.length > 0 ? (
              <div className="space-y-3.5">
                {ambushPlans.map((plan, idx) => {
                  const planPrice = pricePool[plan.symbol] || (plan.symbol === symbol ? curPrice : 0);
                  const isLong = plan.direction === 'LONG';
                  let statusText = '等待回踩中';
                  let statusType: 'WAITING' | 'TRIGGERED' | 'EXPIRED' | 'BELOW' = 'WAITING';

                  if (planPrice > 0) {
                    if (isLong) {
                      if (planPrice <= plan.invalidationPrice) {
                        statusType = 'EXPIRED';
                        statusText = `已击穿失效线 $${plan.invalidationPrice.toLocaleString()}！结构破坏，请立即撤单！`;
                      } else if (planPrice >= plan.entryMin && planPrice <= plan.entryMax) {
                        statusType = 'TRIGGERED';
                        statusText = `现价已进入入场区间！密切关注 15m 企稳收线！`;
                      } else if (planPrice > plan.entryMax) {
                        const dist = ((planPrice - plan.entryMax) / planPrice) * 100;
                        statusText = `等待回踩中 (距入场区上方 +${dist.toFixed(2)}%)`;
                      } else {
                        statusType = 'BELOW';
                        statusText = `已跌破入场区，严密盯防失效位 $${plan.invalidationPrice.toLocaleString()}`;
                      }
                    } else {
                      if (planPrice >= plan.invalidationPrice) {
                        statusType = 'EXPIRED';
                        statusText = `已冲破失效线 $${plan.invalidationPrice.toLocaleString()}！空头逻辑失效，请立即撤单！`;
                      } else if (planPrice >= plan.entryMin && planPrice <= plan.entryMax) {
                        statusType = 'TRIGGERED';
                        statusText = `现价已进入入场区间！密切关注 15m 滞涨收线！`;
                      } else if (planPrice < plan.entryMin) {
                        const dist = ((plan.entryMin - planPrice) / planPrice) * 100;
                        statusText = `等待反弹中 (距入场区下方 -${dist.toFixed(2)}%)`;
                      } else {
                        statusType = 'BELOW';
                        statusText = `已突破入场区，严密盯防失效位 $${plan.invalidationPrice.toLocaleString()}`;
                      }
                    }
                  }

                  const isEditing = editingPlanId === plan.id;
                  const isActivelyWatched = serverSentinelEnabled && plan.watchEnabled !== false;

                  return (
                    <div
                      key={plan.id}
                      className="rounded-xl border border-black/[0.08] bg-slate-50/70 p-3.5 space-y-3"
                    >
                      {/* 卡片头部 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-black text-slate-700">
                            #{idx + 1}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                              isLong ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {plan.symbol} {isLong ? '做多' : '做空'}
                          </span>
                          <span className="text-xs font-black text-slate-900">{plan.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditing) {
                                setEditingPlanId(null);
                              } else {
                                setEditingPlanId(plan.id);
                                setEditForm({
                                  entryMin: plan.entryMin,
                                  entryMax: plan.entryMax,
                                  stopLoss: plan.stopLoss,
                                  takeProfit1: plan.takeProfit1,
                                  invalidationPrice: plan.invalidationPrice,
                                });
                              }
                            }}
                            className="text-slate-400 hover:text-slate-700 cursor-pointer p-1"
                            title="修改点位"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAmbushPlan(plan.id)}
                            className="text-slate-300 hover:text-rose-600 cursor-pointer p-1"
                            title="撤销此单"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {monitoringUiEnabled && <div
                        className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs transition ${
                          !serverSentinelEnabled
                            ? 'bg-slate-100 border-slate-200 text-slate-400'
                            : plan.watchEnabled !== false
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-slate-900'
                            : 'bg-emerald-50/50 border-emerald-200/50 text-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              !serverSentinelEnabled
                                ? 'bg-slate-300'
                                : plan.watchEnabled !== false
                                ? 'bg-emerald-500 animate-ping'
                                : 'bg-slate-300'
                            }`}
                          />
                          <span className="font-black text-xs">
                            {!serverSentinelEnabled
                              ? '⏸️ 云端总控已关闭 (暂停盯防)'
                              : plan.watchEnabled !== false
                              ? '伏击盯防中'
                              : '盯防已暂停'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <label
                            className={`flex items-center gap-1 text-[11px] font-bold cursor-pointer transition ${
                              plan.notifyQQ !== false && isActivelyWatched ? 'text-blue-700' : 'text-slate-400'
                            }`}
                            title="触碰入场区间或击穿失效线时，是否推手机 QQ"
                          >
                            <input
                              type="checkbox"
                              checked={plan.notifyQQ !== false}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setAmbushPlans((prev) =>
                                  prev.map((p) => (p.id === plan.id ? { ...p, notifyQQ: checked } : p))
                                );
                              }}
                              className="rounded cursor-pointer"
                            />
                            <span>📱 QQ通知</span>
                          </label>

                          {/* 该单独立盯防开关 */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={plan.watchEnabled !== false}
                            onClick={() => {
                              const next = plan.watchEnabled === false ? true : false;
                              setAmbushPlans((prev) =>
                                prev.map((p) => (p.id === plan.id ? { ...p, watchEnabled: next } : p))
                              );
                              setSyncNotification(
                                next
                                  ? `🟢 已开启【#${idx + 1} ${plan.symbol} ${plan.name}】离线盯防！`
                                  : `⏸️ 已暂停【#${idx + 1} ${plan.symbol} ${plan.name}】盯防。`
                              );
                              setTimeout(() => setSyncNotification(null), 4000);
                            }}
                            className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                              plan.watchEnabled !== false ? 'bg-emerald-600' : 'bg-slate-300'
                            }`}
                            title={plan.watchEnabled !== false ? '点击暂停此单盯防' : '点击开启此单盯防'}
                          >
                            <span
                              className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                plan.watchEnabled !== false ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>}

                      {/* 点位展示或行内编辑 */}
                      {isEditing ? (
                        <div className="rounded-lg bg-indigo-50/50 p-2.5 border border-indigo-200/80 space-y-2 text-xs">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-slate-500 font-bold block mb-0.5">入场区间下沿</label>
                              <input
                                type="number"
                                value={editForm.entryMin}
                                onChange={(e) => setEditForm((f) => ({ ...f, entryMin: parseFloat(e.target.value) || 0 }))}
                                className="w-full rounded bg-white px-2 py-1 border border-black/10 font-black text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-500 font-bold block mb-0.5">入场区间上沿</label>
                              <input
                                type="number"
                                value={editForm.entryMax}
                                onChange={(e) => setEditForm((f) => ({ ...f, entryMax: parseFloat(e.target.value) || 0 }))}
                                className="w-full rounded bg-white px-2 py-1 border border-black/10 font-black text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-rose-600 font-bold block mb-0.5">止损 / 失效位</label>
                              <input
                                type="number"
                                value={editForm.stopLoss}
                                onChange={(e) => setEditForm((f) => ({ ...f, stopLoss: parseFloat(e.target.value) || 0, invalidationPrice: parseFloat(e.target.value) || 0 }))}
                                className="w-full rounded bg-white px-2 py-1 border border-rose-200 text-rose-700 font-black text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-blue-600 font-bold block mb-0.5">第一目标 TP1</label>
                              <input
                                type="number"
                                value={editForm.takeProfit1}
                                onChange={(e) => setEditForm((f) => ({ ...f, takeProfit1: parseFloat(e.target.value) || 0 }))}
                                className="w-full rounded bg-white px-2 py-1 border border-blue-200 text-blue-700 font-black text-xs"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingPlanId(null)}
                              className="rounded px-2 py-0.5 text-[11px] font-bold text-slate-500 hover:bg-slate-200 cursor-pointer"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAmbushPlans((prev) =>
                                  prev.map((p) =>
                                    p.id === plan.id
                                      ? {
                                          ...p,
                                          entryMin: editForm.entryMin || p.entryMin,
                                          entryMax: editForm.entryMax || p.entryMax,
                                          stopLoss: editForm.stopLoss || p.stopLoss,
                                          invalidationPrice: editForm.stopLoss || p.invalidationPrice,
                                          takeProfit1: editForm.takeProfit1 || p.takeProfit1,
                                        }
                                      : p
                                  )
                                );
                                setEditingPlanId(null);
                              }}
                              className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-0.5 text-[11px] font-black text-white hover:bg-indigo-700 cursor-pointer"
                            >
                              <Save size={11} />
                              保存修改
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div className="rounded-lg bg-white p-2 border border-black/[0.04]">
                            <span className="text-slate-400 font-semibold text-[10px]">挂单区间</span>
                            <div className="text-xs font-black text-slate-900 mt-0.5 truncate">
                              ${plan.entryMin.toLocaleString()} - ${plan.entryMax.toLocaleString()}
                            </div>
                          </div>
                          <div className="rounded-lg bg-rose-50/70 p-2 border border-rose-100">
                            <span className="text-rose-600 font-semibold text-[10px]">失效防守</span>
                            <div className="text-xs font-black text-rose-700 mt-0.5 truncate">
                              ${plan.invalidationPrice.toLocaleString()}
                            </div>
                          </div>
                          <div className="rounded-lg bg-blue-50/70 p-2 border border-blue-100">
                            <span className="text-blue-600 font-semibold text-[10px]">第一目标</span>
                            <div className="text-xs font-black text-blue-700 mt-0.5 truncate">
                              ${plan.takeProfit1.toLocaleString()}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 实时距离与战备提示条 */}
                      <div
                        className={`rounded-lg p-2 text-xs font-black flex items-center justify-between ${
                          statusType === 'EXPIRED'
                            ? 'bg-rose-100 text-rose-800 border border-rose-200'
                            : statusType === 'TRIGGERED'
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          {statusType === 'EXPIRED' && <AlertTriangle size={13} className="shrink-0" />}
                          {statusType === 'TRIGGERED' && <Zap size={13} className="shrink-0" />}
                          {statusType === 'WAITING' && <Clock size={13} className="shrink-0" />}
                          <span className="truncate">{statusText}</span>
                        </span>
                        {planPrice > 0 && (
                          <span className="text-[11px] text-slate-500 font-semibold shrink-0 ml-2">
                            现价: ${planPrice.toLocaleString()}
                          </span>
                        )}
                      </div>

                      {/* 底部流转按钮组 */}
                      <div className="flex items-center gap-2 pt-1 border-t border-black/[0.05]">
                        <button
                          type="button"
                          onClick={() => openSimulationDraft(plan)}
                          className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2 text-xs font-black text-white hover:bg-emerald-700 cursor-pointer shadow-sm"
                        >
                          <CheckCircle2 size={13} />
                          建立模拟仓位
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onShareToSpace?.(
                              `@凌风 · 盘面K线先锋 @幽影 · 巨鲸雷达 @雷震 · 铁面风控官
【继续研判观察计划】
- 观察计划 ID：${plan.id}
- 方案：${plan.name}
- 标的与方向：${plan.symbol} ${plan.direction}
- 入场区间：$${plan.entryMin.toLocaleString()} - $${plan.entryMax.toLocaleString()}
- 止损：$${plan.stopLoss.toLocaleString()}
- 结构失效：$${plan.invalidationPrice.toLocaleString()}
- TP1 / TP2：$${plan.takeProfit1.toLocaleString()} / $${plan.takeProfit2.toLocaleString()}
- 计划建立时间：${plan.createdAt}
- 当前价格：$${planPrice.toLocaleString()}

请基于最新行情重新研判。凌风检查结构，幽影检查 OI 与费率，雷震最终给出“维持原计划 / 调整计划 / 原计划失效 / 立即建立模拟仓位”之一。`
                            );
                            onBackToChat?.();
                          }}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-black/[0.1] bg-white px-2.5 text-[11px] font-black text-slate-700 hover:bg-slate-50 cursor-pointer"
                          title="携带当前计划与最新价格，请特战队继续研判"
                        >
                          <RefreshCw size={11} />
                          继续研判
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400 font-semibold space-y-2">
                <p>当前无埋伏中的伏击方案</p>
                <button
                  type="button"
                  onClick={() => {
                    onShareToSpace?.('帮我看看当前 BTC 和 ETH 的盘面结构，分别制定一个盈亏比大于 1:2 的右侧挂单计划！');
                    onBackToChat?.();
                  }}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-white font-black text-xs cursor-pointer"
                >
                  呼叫特战队制定方案
                </button>
              </div>
            )}
          </div>

          {/* ----------------- 右侧：模拟仓位 ----------------- */}
          <div className="rounded-2xl border-2 border-blue-500/20 bg-white p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-2.5 w-2.5 rounded-full ${
                    activePositions.length > 0 ? 'bg-blue-600 animate-ping' : 'bg-slate-300'
                  }`}
                />
                <h3 className="text-sm font-black text-slate-950">
                  模拟仓位（{activePositions.length} 笔）
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  const basePrice = curPrice || 1;
                  openSimulationDraft({
                    id: `manual-plan-${Date.now()}`,
                    symbol,
                    name: `${symbol} 手动模拟仓位`,
                    direction: 'LONG',
                    entryMin: basePrice,
                    entryMax: basePrice,
                    stopLoss: basePrice * 0.985,
                    takeProfit1: basePrice * 1.025,
                    takeProfit2: basePrice * 1.05,
                    invalidationPrice: basePrice * 0.985,
                    createdAt: new Date().toISOString(),
                    expiresInHours: 8,
                  });
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] font-black text-blue-800 hover:bg-blue-100 cursor-pointer"
              >
                <Plus size={11} />
                新建模拟仓位
              </button>
            </div>

            {activePositions.length > 0 ? (
              <div className="space-y-3.5">
                {activePositions.map((pos, idx) => {
                  const posPrice = pricePool[pos.symbol] || (pos.symbol === symbol ? curPrice : 0);
                  const isLong = pos.direction === 'LONG';
                  const priceDiff = posPrice > 0 ? (isLong ? posPrice - pos.entryPrice : pos.entryPrice - posPrice) : 0;
                  const pnlPercent = pos.entryPrice > 0 ? (priceDiff / pos.entryPrice) * 100 * pos.leverage : 0;
                  const pnlUsd = pos.entryPrice > 0 ? (priceDiff / pos.entryPrice) * pos.positionSizeUsd : 0;
                  const isProfit = pnlUsd >= 0;

                  const hitTP1 = isLong ? posPrice >= pos.takeProfit1 : posPrice <= pos.takeProfit1;
                  const nearSL = isLong
                    ? posPrice - pos.stopLoss < (pos.entryPrice - pos.stopLoss) * 0.3
                    : pos.stopLoss - posPrice < (pos.stopLoss - pos.entryPrice) * 0.3;

                  const isActivelyEscorted = serverSentinelEnabled && pos.watchEnabled !== false;

                  return (
                    <div
                      key={pos.id}
                      className="rounded-xl border border-black/[0.08] bg-slate-50/70 p-3.5 space-y-3"
                    >
                      {/* 卡片头部与盈亏大字 */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-black text-slate-700">
                            #{idx + 1}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                              isLong ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {pos.symbol} {isLong ? '多' : '空'}单 ({pos.leverage}x)
                          </span>
                          <span className="text-xs font-black text-slate-900">{pos.name}</span>
                        </div>

                        <div className="text-right">
                          <span
                            className={`text-sm font-black ${
                              isProfit ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {isProfit ? '+' : ''}${Math.round(pnlUsd)} ({pnlPercent.toFixed(2)}%)
                          </span>
                        </div>
                      </div>

                      {monitoringUiEnabled && <div
                        className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs transition ${
                          !serverSentinelEnabled
                            ? 'bg-slate-100 border-slate-200 text-slate-400'
                            : pos.watchEnabled !== false
                            ? 'bg-blue-500/10 border-blue-500/20 text-slate-900'
                            : 'bg-blue-50/50 border-blue-200/50 text-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              !serverSentinelEnabled
                                ? 'bg-slate-300'
                                : pos.watchEnabled !== false
                                ? 'bg-blue-600 animate-ping'
                                : 'bg-slate-300'
                            }`}
                          />
                          <span className="font-black text-xs">
                            {!serverSentinelEnabled
                              ? '⏸️ 云端总控已关闭 (暂停护航)'
                              : pos.watchEnabled !== false
                              ? '持仓护航中'
                              : '护航已暂停'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <label
                            className={`flex items-center gap-1 text-[11px] font-bold cursor-pointer transition ${
                              pos.notifyQQ !== false && isActivelyEscorted ? 'text-blue-700' : 'text-slate-400'
                            }`}
                            title="触达TP1目标或逼近止损线时，是否推手机 QQ"
                          >
                            <input
                              type="checkbox"
                              checked={pos.notifyQQ !== false}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setActivePositions((prev) =>
                                  prev.map((p) => (p.id === pos.id ? { ...p, notifyQQ: checked } : p))
                                );
                              }}
                              className="rounded cursor-pointer"
                            />
                            <span>📱 QQ通知</span>
                          </label>

                          {/* 该持仓独立护航开关 */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={pos.watchEnabled !== false}
                            onClick={() => {
                              const next = pos.watchEnabled === false ? true : false;
                              setActivePositions((prev) =>
                                prev.map((p) => (p.id === pos.id ? { ...p, watchEnabled: next } : p))
                              );
                              setSyncNotification(
                                next
                                  ? `🟢 已开启【#${idx + 1} ${pos.symbol} ${pos.name}】实时护航！`
                                  : `⏸️ 已暂停【#${idx + 1} ${pos.symbol} ${pos.name}】护航。`
                              );
                              setTimeout(() => setSyncNotification(null), 4000);
                            }}
                            className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                              pos.watchEnabled !== false ? 'bg-blue-600' : 'bg-slate-300'
                            }`}
                            title={pos.watchEnabled !== false ? '点击暂停此单护航' : '点击开启此单护航'}
                          >
                            <span
                              className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                pos.watchEnabled !== false ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>}

                      {/* 点位参数 */}
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-lg bg-white p-2 border border-black/[0.04]">
                          <span className="text-slate-400 font-semibold text-[10px]">模拟成交价</span>
                          <div className="text-xs font-black text-slate-900 mt-0.5 truncate">
                            ${pos.entryPrice.toLocaleString()}
                          </div>
                        </div>
                        <div className="rounded-lg bg-rose-50/70 p-2 border border-rose-100">
                          <span className="text-rose-600 font-semibold text-[10px]">防守止损</span>
                          <div className="text-xs font-black text-rose-700 mt-0.5 truncate">
                            ${pos.stopLoss.toLocaleString()}
                          </div>
                        </div>
                        <div className="rounded-lg bg-blue-50/70 p-2 border border-blue-100">
                          <span className="text-blue-600 font-semibold text-[10px]">TP1保本</span>
                          <div className="text-xs font-black text-blue-700 mt-0.5 truncate">
                            ${pos.takeProfit1.toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {/* 警报与状态 */}
                      {hitTP1 && (
                        <div className="rounded-lg bg-blue-100 border border-blue-200 p-2 text-xs font-black text-blue-900 flex items-center gap-1.5">
                          <CheckCircle2 size={14} className="text-blue-700 shrink-0" />
                          <span>🎯 已触达 TP1！请立即平仓 50% 并将止损拉至开仓价保本！</span>
                        </div>
                      )}

                      {nearSL && (
                        <div className="rounded-lg bg-rose-100 border border-rose-200 p-2 text-xs font-black text-rose-900 flex items-center gap-1.5">
                          <AlertTriangle size={14} className="text-rose-700 shrink-0" />
                          <span>🚨 逼近止损线！严禁抗单与加仓，坚决服从风控！</span>
                        </div>
                      )}

                      {/* 操作按钮 */}
                      <div className="flex items-center gap-2 pt-1 border-t border-black/[0.05]">
                        <button
                          type="button"
                          onClick={() => {
                            onShareToSpace?.(
                              `@凌风 · 盘面K线先锋 @幽影 · 巨鲸雷达 @雷震 · 铁面风控官
【继续研判模拟仓位】
- 模拟仓位 ID：${pos.id}
- 来源观察计划 ID：${pos.sourcePlanId || '手动建立'}
- 标的与方向：${pos.symbol} ${pos.direction}
- 模拟成交价：$${pos.entryPrice.toLocaleString()}
- 当前价格：$${posPrice.toLocaleString()}
- 模拟名义仓位：$${pos.positionSizeUsd.toLocaleString()}，杠杆：${pos.leverage}x
- 当前模拟盈亏：${pnlUsd >= 0 ? '+' : ''}$${Math.round(pnlUsd)} (${pnlPercent.toFixed(2)}%)
- 止损：$${pos.stopLoss.toLocaleString()}
- TP1 / TP2：$${pos.takeProfit1.toLocaleString()} / $${pos.takeProfit2.toLocaleString()}

请基于最新行情判断继续持有、调整止损、分批止盈或模拟平仓。本次只分析已有模拟仓位，不要生成新的开单战术卡。`
                            );
                            onBackToChat?.();
                          }}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 text-[11px] font-black text-blue-700 hover:bg-blue-50 cursor-pointer"
                        >
                          <RefreshCw size={11} />
                          继续研判
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSettlingPosition(pos);
                            setSettleExitPrice(posPrice || pos.entryPrice);
                            setSettleReason(hitTP1 ? 'TP_HIT' : nearSL ? 'SL_HIT' : 'MANUAL_EXIT');
                            setSettleNote(`${pos.name} 平仓出局`);
                          }}
                          className="flex-1 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2 text-xs font-black text-white hover:bg-blue-700 cursor-pointer shadow-sm"
                        >
                          <FileText size={13} />
                          模拟平仓
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemovePosition(pos.id)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-black/[0.1] bg-white px-2.5 text-[11px] font-black text-slate-600 hover:bg-slate-50 cursor-pointer"
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400 font-semibold space-y-2">
                <p>当前模拟仓位为空</p>
                <p className="text-[11px] text-slate-400">从左侧观察计划建立，或点击右上角手动新建</p>
              </div>
            )}
          </div>
        </div>

        {/* ==================== 底部：战绩与对局复盘 (历史已平仓，不常用收纳于此) ==================== */}
        <div className="rounded-2xl border border-black/[0.08] bg-white p-4 sm:p-5 shadow-sm space-y-3.5">
          <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setHistoryExpanded(!historyExpanded)}
                className="flex items-center gap-1.5 text-sm font-black text-slate-950 hover:text-blue-600 cursor-pointer"
              >
                <span>📋 模拟交易复盘（历史已结束）</span>
                {historyExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {reviews.length > 0 && (
                <div className="flex items-center gap-2 text-xs font-black">
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      reviewStats.totalPnl >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    累计净盈亏: {reviewStats.totalPnl >= 0 ? '+' : ''}${reviewStats.totalPnl} U
                  </span>
                  <span className="rounded-full bg-blue-100 text-blue-800 px-2 py-0.5">
                    胜率: {reviewStats.winRate}% ({reviewStats.winCount}/{reviewStats.totalCount})
                  </span>
                </div>
              )}
            </div>

            {reviews.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('确定要清空历史复盘记录吗？')) {
                    setReviews([]);
                  }
                }}
                className="text-slate-400 hover:text-rose-600 text-[11px] font-bold cursor-pointer"
              >
                清空记录
              </button>
            )}
          </div>

          {historyExpanded && (
            <div>
              {reviews.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {reviews.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl border border-black/[0.06] bg-slate-50/80 p-3 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                              r.pnlUsd >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {r.reason === 'TP_HIT'
                              ? '🎯 止盈达成'
                              : r.reason === 'SL_HIT'
                              ? '🛑 止损出局'
                              : r.reason === 'BREAKEVEN'
                              ? '⚪ 保本出局'
                              : '⚠️ 手动出局'}
                          </span>
                          <span className="font-black text-slate-900">{r.symbol} {r.planName}</span>
                        </div>
                        <span
                          className={`font-black text-xs ${
                            r.pnlUsd >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {r.pnlUsd >= 0 ? '+' : ''}${r.pnlUsd} U ({r.pnlPercent.toFixed(1)}%)
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-500 font-semibold flex items-center justify-between">
                        <span>
                          入场: ${r.entryPrice.toLocaleString()} ➔ 平仓: ${r.exitPrice.toLocaleString()}
                        </span>
                        <span>{r.date}</span>
                      </div>

                      <p className="text-[11px] text-slate-600 font-semibold bg-white p-2 rounded-lg border border-black/[0.04]">
                        {r.summary}
                      </p>

                      <div className="flex items-center justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            const prompt = `📋 【专项模拟交易复盘请求】
- 订单名称：${r.planName} (${r.symbol} ${r.direction}单)
- 入场价：$${r.entryPrice.toLocaleString()} ➔ 出局价: $${r.exitPrice.toLocaleString()}
- 最终盈亏：${r.pnlUsd >= 0 ? '+' : ''}${r.pnlUsd} USDT (${r.pnlPercent.toFixed(2)}%)
- 出局原因：${r.reason}
- 复盘备注：${r.summary}

请特战队对该单进行战术复盘：
1. @凌风 · 盘面K线先锋：评估当时入场与离场收线是否合理？
2. @雷震 · 铁面风控官：评估盈亏比与风控执行度，给出复盘改进建议！`;
                            onShareToSpace?.(prompt);
                            onBackToChat?.();
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-black text-blue-600 hover:text-blue-800 cursor-pointer"
                        >
                          <MessagesSquare size={12} />
                          呼叫特战队复盘此单
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-xs text-slate-400 font-semibold">
                  暂无历史平仓记录。持仓单在上方平仓后，将自动归档于此。
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {simulationDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900">建立模拟仓位</h3>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
                  {simulationDraft.sourcePlan.symbol} {simulationDraft.sourcePlan.direction === 'LONG' ? '做多' : '做空'} · {simulationDraft.sourcePlan.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSimulationDraft(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="关闭模拟建仓弹窗"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1 font-bold text-slate-600">
                <span>模拟成交价</span>
                <input
                  type="number"
                  value={simulationDraft.entryPrice}
                  onChange={(event) => setSimulationDraft((prev) => prev ? { ...prev, entryPrice: Number(event.target.value) } : prev)}
                  className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 font-black text-slate-900"
                />
              </label>
              <label className="space-y-1 font-bold text-slate-600">
                <span>模拟名义仓位 (USDT)</span>
                <input
                  type="number"
                  value={simulationDraft.positionSizeUsd}
                  onChange={(event) => setSimulationDraft((prev) => prev ? { ...prev, positionSizeUsd: Number(event.target.value) } : prev)}
                  className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 font-black text-slate-900"
                />
              </label>
              <label className="space-y-1 font-bold text-slate-600">
                <span>杠杆倍数</span>
                <input
                  type="number"
                  min="1"
                  value={simulationDraft.leverage}
                  onChange={(event) => setSimulationDraft((prev) => prev ? { ...prev, leverage: Number(event.target.value) } : prev)}
                  className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 font-black text-slate-900"
                />
              </label>
              <label className="space-y-1 font-bold text-slate-600">
                <span>止损</span>
                <input
                  type="number"
                  value={simulationDraft.stopLoss}
                  onChange={(event) => setSimulationDraft((prev) => prev ? { ...prev, stopLoss: Number(event.target.value) } : prev)}
                  className="w-full rounded-lg border border-rose-200 bg-rose-50/50 px-2.5 py-1.5 font-black text-rose-800"
                />
              </label>
              <label className="space-y-1 font-bold text-slate-600">
                <span>TP1</span>
                <input
                  type="number"
                  value={simulationDraft.takeProfit1}
                  onChange={(event) => setSimulationDraft((prev) => prev ? { ...prev, takeProfit1: Number(event.target.value) } : prev)}
                  className="w-full rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-1.5 font-black text-emerald-800"
                />
              </label>
              <label className="space-y-1 font-bold text-slate-600">
                <span>TP2</span>
                <input
                  type="number"
                  value={simulationDraft.takeProfit2}
                  onChange={(event) => setSimulationDraft((prev) => prev ? { ...prev, takeProfit2: Number(event.target.value) } : prev)}
                  className="w-full rounded-lg border border-emerald-200 bg-emerald-50/50 px-2.5 py-1.5 font-black text-emerald-800"
                />
              </label>
            </div>

            <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
              预计止损金额约 ${(
                Math.abs(simulationDraft.entryPrice - simulationDraft.stopLoss)
                / Math.max(simulationDraft.entryPrice, 1)
                * simulationDraft.positionSizeUsd
              ).toFixed(2)} USDT
              （价格风险 {(
                Math.abs(simulationDraft.entryPrice - simulationDraft.stopLoss)
                / Math.max(simulationDraft.entryPrice, 1)
                * 100
              ).toFixed(2)}%）
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-black/[0.06] pt-3">
              <button
                type="button"
                onClick={() => setSimulationDraft(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmSimulation}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-black text-white hover:bg-emerald-700 cursor-pointer shadow-sm"
              >
                确认建立模拟仓位
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 模拟平仓结算弹窗 ==================== */}
      {settlingPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <FileText size={17} className="text-blue-600" />
                <h3 className="text-sm font-black text-slate-900">
                  平仓结算与战绩归档：{settlingPosition.symbol}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSettlingPosition(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 font-bold mb-1">平仓单子名称</label>
                <div className="font-black text-slate-900">{settlingPosition.name}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-500 font-bold mb-1">模拟成交价</label>
                  <div className="font-black text-slate-900">${settlingPosition.entryPrice.toLocaleString()}</div>
                </div>
                <div>
                  <label className="block text-blue-600 font-bold mb-1">模拟平仓价格 (可微调)</label>
                  <input
                    type="number"
                    value={settleExitPrice}
                    onChange={(e) => setSettleExitPrice(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-lg border border-blue-200 bg-blue-50/50 px-2.5 py-1 text-xs font-black text-blue-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1">平仓出局原因</label>
                <select
                  value={settleReason}
                  onChange={(e) => setSettleReason(e.target.value as any)}
                  className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-black text-slate-900 cursor-pointer"
                >
                  <option value="TP_HIT">🎯 触达 TP1/TP2 止盈 (盈利离场)</option>
                  <option value="SL_HIT">🛑 触碰止损出局 (断臂保命)</option>
                  <option value="BREAKEVEN">⚪ 触碰成本线保本离场 (平局无伤)</option>
                  <option value="MANUAL_EXIT">⚠️ 主动提前手动平仓</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-500 font-bold mb-1">一句话战术复盘心得</label>
                <input
                  type="text"
                  value={settleNote}
                  onChange={(e) => setSettleNote(e.target.value)}
                  placeholder="例如: 顺势突破拿到底，坚决服从保本纪律"
                  className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-black text-slate-900"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1 font-bold text-slate-700">
                <input
                  type="checkbox"
                  checked={settleShareToChat}
                  onChange={(e) => setSettleShareToChat(e.target.checked)}
                  className="rounded cursor-pointer"
                />
                <span>📢 同步把平仓战报发送到特战队群聊</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/[0.06]">
              <button
                type="button"
                onClick={() => setSettlingPosition(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmSettle}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-black text-white hover:bg-blue-700 cursor-pointer shadow-sm"
              >
                确认平仓并归档
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
