'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Calendar,
  AlertTriangle,
  Flame,
  Clock,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  ArrowRight,
  BookOpen,
  Send,
  Zap,
  Info,
} from 'lucide-react';
import { cryptoEvents, type CryptoEventsData } from '@/lib/client/api';
import { toast } from '@/lib/client/toast';
import { formatEventSource, formatLocalTime, getVerifiedEventImpact, formatEventSurprise, formatEventImpactPercent, formatEventMarketResult } from '@/lib/workspace/crypto/event-temporal.ts';
import type { CryptoEvent } from '@/lib/workspace/crypto/event-temporal.ts';
import { canTrackEventMarket, EVENT_MARKET_WINDOWS, getEventMarketResult, formatMarketPercent, type EventMarketWindow } from '@/lib/workspace/crypto/event-market.ts';

function lifecycleLabel(state?: string) {
  return state === 'REVIEWED' ? '已核验复盘'
    : state === 'REVIEW_PENDING' ? '行情已完成 · 待复盘'
    : state === 'TRACKING_MARKET' ? '行情采集中'
    : '待公布';
}

export interface SpaceCryptoEventRadarProps {
  currentSymbol?: string;
  onShareToSpace?: (content: string) => void;
  onBackToChat?: () => void;
  onEventsChange?: (data: CryptoEventsData) => void;
}

export default function SpaceCryptoEventRadar({
  currentSymbol = 'BTC',
  onShareToSpace,
  onBackToChat,
  onEventsChange,
}: SpaceCryptoEventRadarProps) {
  const [data, setData] = useState<CryptoEventsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'historical'>('upcoming');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'macro' | 'unlock' | 'derivatives'>('ALL');
  const [expanded, setExpanded] = useState<boolean>(true);
  const [selectedHistoricalId, setSelectedHistoricalId] = useState<string | null>(null);
  const requestId = useRef(0);

  // 加载大事件列表
  const loadEvents = useCallback(async (quiet = false) => {
    const id = ++requestId.current;
    try {
      if (!quiet) setLoading(true);
      const res = await cryptoEvents.list({ symbol: currentSymbol });
      if (id === requestId.current && res?.success && res?.data) {
        setData(res.data);
        onEventsChange?.(res.data);
      }
    } catch (err: any) {
      console.warn('[SpaceCryptoEventRadar] fetch events failed:', err?.message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [currentSymbol, onEventsChange]);

  useEffect(() => {
    void loadEvents();
    const timer = window.setInterval(() => { void loadEvents(true); }, 30_000);
    return () => { requestId.current++; window.clearInterval(timer); };
  }, [loadEvents]);

  // 手动触发外部实时日历同步
  const handleSyncLiveCalendar = async () => {
    try {
      setSyncing(true);
      const res = await cryptoEvents.sync();
      if (res?.success) {
        toast.success(res.message || '真实财经日历同步成功！');
        await loadEvents();
      } else {
        toast.error('日历同步失败，请稍后重试');
      }
    } catch (err: any) {
      toast.error(err?.message || '日历同步发生异常');
    } finally {
      setSyncing(false);
    }
  };

  // 过滤后的临近事件
  const filteredUpcoming = useMemo(() => {
    if (!data?.upcoming) return [];
    if (categoryFilter === 'ALL') return data.upcoming;
    return data.upcoming.filter((item) => item.event.category === categoryFilter);
  }, [data?.upcoming, categoryFilter]);

  // 过滤后的历史回顾事件
  const filteredHistorical = useMemo(() => {
    if (!data?.historical) return [];
    if (categoryFilter === 'ALL') return data.historical;
    return data.historical.filter((item) => item.event.category === categoryFilter);
  }, [data?.historical, categoryFilter]);

  // 紧急状态判定
  const activeAlert = data?.activeAlerts?.[0];
  const isStormNow = activeAlert?.phase === 'IN_THE_STORM';
  const isImpendingSoon = activeAlert && activeAlert.deltaMinutes <= 120 && activeAlert.deltaMinutes >= -15;

  // 默认展开首个历史复盘
  useEffect(() => {
    if (!selectedHistoricalId && filteredHistorical.length > 0) {
      const firstWithImpact = filteredHistorical.find((h) => getVerifiedEventImpact(h.event)) || filteredHistorical[0];
      if (firstWithImpact) {
        setSelectedHistoricalId(firstWithImpact.event.id);
      }
    }
  }, [filteredHistorical, selectedHistoricalId]);

  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white p-4 sm:p-5 shadow-sm space-y-4 transition-all">
      {/* 头部状态与折叠条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 font-black">
            <Zap size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-black text-slate-950 flex items-center gap-1.5">
                宏观大事件雷达 & 历史复盘
              </h3>
              {isStormNow ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/20 px-2.5 py-0.5 text-[10px] font-black text-rose-600 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                  🚨 暴风雨窗口期（严禁高杠杆新开仓）
                </span>
              ) : isImpendingSoon ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[10px] font-black text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                  ⚠️ 临近大事件警报（{activeAlert?.countdownText}后）
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 px-2.5 py-0.5 text-[10px] font-black text-slate-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  盘面暂无冲突大事件
                </span>
              )}
            </div>
            <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
              自动同步本周 USD 重点日历 · 其他事件手工维护 · 每30秒刷新倒计时
            </p>
          </div>
        </div>

        {/* 顶部右侧控制区 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncLiveCalendar}
            disabled={syncing}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-slate-50 px-2.5 text-[11px] font-black text-slate-700 hover:bg-slate-100 transition disabled:opacity-50 cursor-pointer shadow-2xs"
            title="从 FairEconomy / ForexFactory 聚合源拉取本周 USD 重点事件的时间、市场预期与前值，不含公布值"
          >
            <RefreshCw size={11} className={syncing ? 'animate-spin text-amber-600' : 'text-slate-500'} />
            {syncing ? '同步中...' : '⚡ 同步日历'}
          </button>

          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-black/[0.08] bg-white text-slate-500 hover:bg-slate-50 transition cursor-pointer"
            title={expanded ? '折叠面板' : '展开详情'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* 当折叠时显示极简警报速览行 */}
      {!expanded && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-600 py-0.5">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-bold text-[11px]">速览:</span>
            {filteredUpcoming.length > 0 ? (
              <span className="font-bold text-slate-900">
                最近事件: {filteredUpcoming[0].event.title} ({filteredUpcoming[0].countdownText}后)
              </span>
            ) : (
              <span className="text-slate-400">近期暂无重大事件</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span>待发生: {data?.upcoming?.length || 0} 项</span>
            <span>·</span>
            <span>已核验复盘: {data?.historical?.filter((h) => getVerifiedEventImpact(h.event)).length || 0} 项</span>
          </div>
        </div>
      )}

      {/* 展开后的丰富内容区 */}
      {expanded && (
        <div className="space-y-4">
          {/* Tab 切换与类型过滤 */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5 rounded-xl bg-slate-100/80 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('upcoming')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-black transition cursor-pointer ${
                  activeTab === 'upcoming'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                <Clock size={12} />
                <span>临近事件展示</span>
                <span className="rounded-full bg-slate-200 px-1.5 py-0.2 text-[10px] text-slate-700">
                  {filteredUpcoming.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('historical')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-black transition cursor-pointer ${
                  activeTab === 'historical'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                <BookOpen size={12} />
                <span>实战历史回顾与剧本</span>
                <span className="rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.2 text-[10px]">
                  {filteredHistorical.filter((h) => getVerifiedEventImpact(h.event)).length}
                </span>
              </button>
            </div>

            {/* 分类过滤按钮组 */}
            <div className="flex items-center gap-1 text-[11px] font-bold">
              <span className="text-slate-400 mr-1">分类:</span>
              <button
                type="button"
                onClick={() => setCategoryFilter('ALL')}
                className={`rounded px-2 py-0.5 transition cursor-pointer ${
                  categoryFilter === 'ALL'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                全部
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('macro')}
                className={`rounded px-2 py-0.5 transition cursor-pointer ${
                  categoryFilter === 'macro'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                宏观央行
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('unlock')}
                className={`rounded px-2 py-0.5 transition cursor-pointer ${
                  categoryFilter === 'unlock'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                代币解锁
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('derivatives')}
                className={`rounded px-2 py-0.5 transition cursor-pointer ${
                  categoryFilter === 'derivatives'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                期权交割
              </button>
            </div>
          </div>

          {/* ===================== Tab 1: 临近事件展示 ===================== */}
          {activeTab === 'upcoming' && (
            <div className="space-y-3">
              {loading && filteredUpcoming.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 font-semibold animate-pulse">
                  正在同步宏观事件雷达...
                </div>
              ) : filteredUpcoming.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 font-semibold space-y-1">
                  <p>近期暂无重大经济事件或大额代币解锁</p>
                  <p className="text-[11px] text-slate-400">点击右上角「同步外部日历」可拉取本周最新日程</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {filteredUpcoming.map((item) => {
                    const e = item.event;
                    const isImpending = item.phase === 'IMPENDING';
                    const isStorm = item.phase === 'IN_THE_STORM';
                    const isTier3 = e.volatilityTier === 3;

                    return (
                      <div
                        key={e.id}
                        className={`rounded-xl border p-3.5 space-y-2.5 transition relative flex flex-col justify-between ${
                          isStorm
                            ? 'border-rose-400 bg-rose-50/40 shadow-xs'
                            : isImpending && item.deltaMinutes <= 120
                            ? 'border-amber-300 bg-amber-50/30 shadow-xs'
                            : 'border-black/[0.06] bg-slate-50/60 hover:bg-slate-50'
                        }`}
                      >
                        {/* 顶栏：标签与倒计时 */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                                  isTier3
                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                }`}
                              >
                                系统 {e.volatilityTier}星
                              </span>

                              <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                                {e.category === 'macro' ? '宏观指标' : e.category === 'unlock' ? '代币解锁' : e.category === 'derivatives' ? '期权交割' : '行业升级'}
                              </span>

                              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                                系统影响: {e.impactCoins.includes('ALL') ? '全市场' : e.impactCoins.join(', ')}
                              </span>
                            </div>

                            <span
                              className={`rounded-md px-2 py-0.5 text-[11px] font-black font-mono flex items-center gap-1 ${
                                isStorm
                                  ? 'bg-rose-600 text-white animate-pulse'
                                  : isImpending && item.deltaMinutes <= 60
                                  ? 'bg-amber-600 text-white'
                                  : 'bg-slate-200 text-slate-800'
                              }`}
                            >
                              <Clock size={11} />
                              {item.countdownText}
                            </span>
                          </div>

                          {/* 标题 */}
                          <div className="pt-1">
                            <h4 className="text-xs sm:text-sm font-black text-slate-900 leading-snug">
                              {e.title}
                            </h4>
                            <p className="text-[10px] text-slate-500 mt-1 break-words">{formatEventSource(e)}</p>
                            <div className="text-[11px] font-semibold text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span>公布时间: {item.formattedLocalTime} (北京时间)</span>
                              {(e.category === 'macro' || e.forecast || e.previous) && (
                                <>
                                  <span>·</span>
                                  <span>市场预期: <strong className="text-slate-800 font-mono">{e.forecast || '未提供'}</strong></span>
                                  <span>·</span>
                                  <span>前值: <strong className="text-slate-800 font-mono">{e.previous || '-'}</strong></span>
                                </>
                              )}
                            </div>
                            {e.eventGroupMembers?.length ? (
                              <details className="mt-1.5 text-[10px] text-slate-500">
                                <summary className="cursor-pointer font-bold text-indigo-600">同场事件与阶段（{e.eventGroupMembers.length + 1} 条日历记录）</summary>
                                <div className="mt-1 space-y-0.5 pl-2 border-l border-indigo-100">
                                  {[e, ...e.eventGroupMembers]
                                    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
                                    .map((member) => <div key={member.id}>{formatLocalTime(new Date(member.timestamp))} · {member.title}</div>)}
                                </div>
                              </details>
                            ) : null}
                          </div>
                        </div>

                        {/* 指引条目 */}
                        {e.guidance && (
                          <div className="rounded-lg bg-white/90 border border-black/[0.05] p-2.5 space-y-1.5 text-[11px]">
                            {e.guidance.bullishCondition && (
                              <div className="flex items-start gap-1.5 text-emerald-800">
                                <span className="font-black shrink-0">🟢 利多:</span>
                                <span className="font-medium text-slate-700">{e.guidance.bullishCondition}</span>
                              </div>
                            )}
                            {e.guidance.bearishCondition && (
                              <div className="flex items-start gap-1.5 text-rose-800">
                                <span className="font-black shrink-0">🔴 利空:</span>
                                <span className="font-medium text-slate-700">{e.guidance.bearishCondition}</span>
                              </div>
                            )}
                            {e.guidance.riskInstruction && (
                              <div className="flex items-start gap-1.5 text-amber-800 border-t border-black/[0.04] pt-1 mt-1">
                                <span className="font-black shrink-0">🛡️ 禁令:</span>
                                <span className="font-semibold text-amber-900">{e.guidance.riskInstruction}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {item.deltaMinutes <= 0 && <EventMarketTracking event={e} onRefresh={() => loadEvents(true)} />}

                        {/* 呼叫特战队推演按钮 */}
                        <div className="pt-1 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              onShareToSpace?.(
                                `@特战队 重点大事件预警研判！
【事件名称】：${e.title}
【公布时间】：${item.formattedLocalTime} (距离发布还有 ${item.countdownText})
【系统评级】：${e.volatilityTier}星（非来源评级）；影响币种由系统规则指定
【来源】：${formatEventSource(e)}
【市场预期/前值】：预期 ${e.forecast || '源未提供'} · 前值 ${e.previous || '源未提供'}

请凌风结合当前 ${currentSymbol} 的日线与4H形态，评估插针区间；幽影核实巨鲸对冲仓位与资金费率；雷震给出该事件发布前后的仓位防守指令与避险建议。`
                              );
                              onBackToChat?.();
                            }}
                            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-[11px] font-black text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                          >
                            <Sparkles size={11} />
                            呼叫特战队推演影响
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===================== Tab 2: 历史大事件回顾与实战剧本 ===================== */}
          {activeTab === 'historical' && (
            <div className="space-y-3">
              {filteredHistorical.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 font-semibold">
                  暂无历史大事件复盘记录
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
                  {/* 左侧：历史事件列表 (占 5 列) */}
                  <div className="lg:col-span-5 space-y-2 max-h-[420px] overflow-y-auto pr-1">
                    {filteredHistorical.map((item) => {
                      const e = item.event;
                      const impact = getVerifiedEventImpact(e);
                      const isSelected = selectedHistoricalId === e.id;

                      return (
                        <div
                          key={e.id}
                          onClick={() => setSelectedHistoricalId(e.id)}
                          className={`rounded-xl border p-3 text-left transition cursor-pointer space-y-1.5 ${
                            isSelected
                              ? 'border-indigo-400 bg-indigo-50/50 shadow-xs'
                              : 'border-black/[0.06] bg-slate-50/70 hover:bg-slate-100/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-black text-slate-700">
                              {item.formattedLocalTime.slice(0, 10)}
                            </span>
                            {impact ? (
                              <span
                                className={`rounded px-1.5 py-0.2 text-[10px] font-black ${
                                  impact.marketReaction.twentyFourHourResult === 'V_REVERSAL'
                                    ? 'bg-purple-100 text-purple-800'
                                    : impact.marketReaction.twentyFourHourResult === 'PUMP'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : impact.marketReaction.twentyFourHourResult === 'DUMP'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {formatEventMarketResult(impact.marketReaction.twentyFourHourResult)}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-semibold">{e.impact ? '复盘待核验' : lifecycleLabel(item.lifecycleState)}</span>
                            )}
                          </div>

                          <h5 className="text-xs font-black text-slate-900 line-clamp-1">
                            {e.title}
                          </h5>

                          {impact && (
                            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                              <span>
                                5m脉冲:{' '}
                                <strong
                                  className={
                                    (impact.marketReaction.fiveMinSpikePct ?? 0) >= 0
                                      ? 'text-emerald-600'
                                      : 'text-rose-600'
                                  }
                                >
                                  {formatEventImpactPercent(impact.marketReaction.fiveMinSpikePct)}
                                </strong>
                              </span>
                              <span>·</span>
                              <span>
                                1h趋势:{' '}
                                <strong
                                  className={
                                    (impact.marketReaction.oneHourTrendPct ?? 0) >= 0
                                      ? 'text-emerald-600'
                                      : 'text-rose-600'
                                  }
                                >
                                  {formatEventImpactPercent(impact.marketReaction.oneHourTrendPct)}
                                </strong>
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 右侧：选中事件的深度实战复盘与战术剧本 (占 7 列) */}
                  <div className="lg:col-span-7 rounded-xl border border-black/[0.08] bg-slate-50/80 p-4 space-y-3.5">
                    {(() => {
                      const selectedItem = filteredHistorical.find((h) => h.event.id === selectedHistoricalId);
                      if (!selectedItem) {
                        return (
                          <div className="py-12 text-center text-xs text-slate-400 font-semibold">
                            请从左侧选择一项大事件查看完整实战复盘与战术剧本
                          </div>
                        );
                      }

                      const e = selectedItem.event;
                      const impact = getVerifiedEventImpact(e);

                      return (
                        <div className="space-y-3">
                          {/* 标题栏 */}
                          <div className="border-b border-black/[0.06] pb-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-slate-400">
                                预定公布时间：{selectedItem.formattedLocalTime}
                              </span>
                              <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-700">
                                影响币种：{e.impactCoins.includes('ALL') ? '全市场 (BTC/ETH/主流山寨)' : e.impactCoins.join(', ')}
                              </span>
                            </div>
                            <h4 className="text-sm font-black text-slate-950 mt-1">
                              {e.title}
                            </h4>
                            <p className="text-[10px] text-slate-500 mt-1 break-words">{formatEventSource(e)}</p>
                          </div>

                          <EventMarketTracking event={e} onRefresh={() => loadEvents(true)} />

                          {impact ? (
                            <>
                              {/* 数据公布对比指标 */}
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="rounded-lg bg-white p-2.5 border border-black/[0.05] space-y-0.5">
                                  <div className="text-[10px] font-bold text-slate-400">公布数值 / 预期</div>
                                  <div className="font-mono font-black text-slate-900">
                                    {impact.actualValue || '未知'} / {impact.expectedValue || '未知'}
                                  </div>
                                </div>

                                <div className="rounded-lg bg-white p-2.5 border border-black/[0.05] space-y-0.5">
                                  <div className="text-[10px] font-bold text-slate-400">宏观偏向判定</div>
                                  <div className="font-bold text-indigo-700">
                                    {formatEventSurprise(impact)}
                                  </div>
                                </div>

                                <div className="rounded-lg bg-white p-2.5 border border-black/[0.05] space-y-0.5">
                                  <div className="text-[10px] font-bold text-slate-400">爆仓额（来源统计）</div>
                                  <div className="font-mono font-black text-rose-600">
                                    {typeof impact.marketReaction.liquidationsUsdMillion === 'number' &&
                                      Number.isFinite(impact.marketReaction.liquidationsUsdMillion) && impact.marketReaction.liquidationsUsdMillion >= 0
                                      ? `$${impact.marketReaction.liquidationsUsdMillion}M`
                                      : '未知'}
                                  </div>
                                </div>
                              </div>

                              {/* 实盘走势形态 */}
                              <div className="rounded-xl border border-black/[0.06] bg-white p-3 space-y-1.5">
                                <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                                  <span>24小时行情定性走势:</span>
                                  <span className="font-black text-indigo-700">
                                    {formatEventMarketResult(impact.marketReaction.twentyFourHourResult)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-4 text-xs font-medium text-slate-600 pt-1">
                                  <span>
                                    前 5 分钟插针幅度: <strong className="font-mono text-slate-900">{formatEventImpactPercent(impact.marketReaction.fiveMinSpikePct)}</strong>
                                  </span>
                                  <span>
                                    后 1 小时趋势走向: <strong className="font-mono text-slate-900">{formatEventImpactPercent(impact.marketReaction.oneHourTrendPct)}</strong>
                                  </span>
                                </div>
                              </div>

                              {/* 核心战术剧本总结 (Playbook Takeaway) */}
                              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-1.5">
                                <div className="flex items-center gap-1.5 text-xs font-black text-indigo-900">
                                  <BookOpen size={13} />
                                  <span>主力操盘手法与实战复盘 (Playbook Takeaway)</span>
                                </div>
                                <p className="text-xs font-semibold text-slate-700 leading-relaxed">
                                  {impact.playbookTakeaway || '未知'}
                                </p>
                              </div>

                              {/* 最优应对策略 */}
                              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 space-y-1 text-xs">
                                <div className="font-black text-emerald-900">
                                  💡 下次遇到该事件的最优操作策略:
                                </div>
                                <p className="font-semibold text-emerald-800 leading-relaxed">
                                  {impact.optimalAction || '未知'}
                                </p>
                              </div>

                              <p className="text-[10px] text-slate-500 break-words">
                                复盘来源：{impact.verification!.sourceUrls.join('、')} · 核验 {impact.verification!.verifiedAt}
                              </p>
                              {/* 引用战术剧本到聊天室 */}
                              <div className="pt-1 flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    onShareToSpace?.(
                                      `@雷震 · 铁面风控官 @凌风 · 盘面K线先锋
【引用历史大事件战术剧本】：
- 事件名称：${e.title}
- 历史形态：${formatEventMarketResult(impact.marketReaction.twentyFourHourResult)}
- 操盘复盘：${impact.playbookTakeaway || '未知'}
- 应对参考：${impact.optimalAction || '未知'}
- 复盘来源：${impact.verification!.sourceUrls.join('、')}；核验时间：${impact.verification!.verifiedAt}

请将以上实战经验纳入当前 ${currentSymbol} 的推演风控防线中，防范在相似节点被主力诱单！`
                                    );
                                    onBackToChat?.();
                                  }}
                                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-2.5 text-[11px] font-black text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                                >
                                  <Send size={11} />
                                  引用战术剧本到作战室
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="py-6 text-center text-xs text-slate-400 font-semibold space-y-1">
                              <p>{e.impact ? '原有复盘记录待核验，暂不展示数值与结论' : '暂无已核验的完整复盘'}</p>
                              <p className="text-[11px] text-slate-400">公布值与预期差尚未核验；行情统计单独展示，不推断事件因果</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventMarketTracking({ event, onRefresh }: { event: CryptoEvent; onRefresh: () => Promise<void> }) {
  const [collecting, setCollecting] = useState(false);
  if (!canTrackEventMarket(event)) return null;
  const now = new Date();
  const windows = Object.keys(EVENT_MARKET_WINDOWS) as EventMarketWindow[];
  const observation = event.marketObservation;
  const stages = observation && Date.parse(observation.scheduledAt) === Date.parse(event.timestamp) ? observation.stages : {};
  const canCollect = windows.some((window) => !getEventMarketResult(event, window, now) &&
    now.getTime() >= Date.parse(event.timestamp) + EVENT_MARKET_WINDOWS[window] * 60_000 &&
    !(stages[window]?.status === 'retry' && Date.parse(stages[window].retryAt) > now.getTime()));
  const collect = async () => {
    if (collecting) return;
    setCollecting(true);
    try {
      const response = await cryptoEvents.collectMarket(event.id);
      if (!response.success) toast.error('行情补采失败，请稍后重试');
      else if (response.data.status === 'retry') toast.error('行情暂不可用，稍后自动补采');
      else if (response.data.status === 'busy') toast.success('正在采集行情，请稍后查看');
      else if (response.data.status === 'complete') toast.success('已补采一个时段');
      await onRefresh();
    } catch { toast.error('行情补采失败，请稍后重试'); }
    finally { setCollecting(false); }
  };
  return (
    <div className="rounded-xl border border-black/[0.06] bg-white p-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-700">BTC 事件行情跟踪 · OKX 永续合约</span>
        <button type="button" disabled={collecting || !canCollect} onClick={collect}
          className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 disabled:opacity-40">
          {collecting ? '采集中…' : '补采到期数据'}
        </button>
      </div>
      <p className="text-[10px] text-slate-500">以预定公布前一分钟收盘价为基准；仅统计价格，不代表公布值或事件因果。</p>
      {windows.map((window) => {
        const result = getEventMarketResult(event, window, now);
        const stage = stages[window];
        const due = Date.parse(event.timestamp) + EVENT_MARKET_WINDOWS[window] * 60_000;
        return (
          <div key={window} className="border-t border-slate-100 pt-2 space-y-1">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <strong className="text-slate-700">{window}</strong>
              {result ? <>
                <span>期末 {formatMarketPercent(result.returnPct)}</span>
                <span>区间最高 / 最低 {formatMarketPercent(result.highPct)} / {formatMarketPercent(result.lowPct)}</span>
              </> : <span className="text-slate-400">{now.getTime() < due ? '等待窗口结束' : stage?.status === 'retry' ? '取数失败，等待补采' : '已到期，等待采集'}</span>}
            </div>
            {result && <details className="text-[10px] text-slate-500 break-words">
              <summary className="cursor-pointer">查看基准、区间与来源</summary>
              <p>基准价 {result.baselineClose} · K线起始 {result.baselineAt}</p>
              <p>区间 [{result.windowStart}, {result.windowEnd}) · {result.candleCount} 根已收盘1分钟K线</p>
              <p>采集 {result.collectedAt} · 时间均为 UTC</p>
              <div className="flex flex-wrap gap-2">{result.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="underline">K线来源 {index + 1}</a>)}</div>
            </details>}
            {!result && stage?.status === 'retry' && <p className="text-[10px] text-slate-400 break-words">{stage.error} · 下次重试 {stage.retryAt} (UTC)</p>}
          </div>
        );
      })}
    </div>
  );
}
