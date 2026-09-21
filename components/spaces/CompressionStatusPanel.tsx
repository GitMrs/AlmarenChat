'use client';

import { useState } from 'react';
import {
  TrendingDown,
  Info,
  History,
  ChevronDown,
  ChevronUp,
  Zap,
  Activity,
  CheckCircle2,
  X,
  Loader2,
} from 'lucide-react';
import { useContextCompression } from '@/hooks/useContextCompression';
import { spaces as spacesApi } from '@/lib/api';

interface CompressionStatusPanelProps {
  spaceId: string;
  compact?: boolean;
  showMessageCount?: boolean;
}

export function CompressionStatusPanel({
  spaceId,
  compact = false,
  showMessageCount = true,
}: CompressionStatusPanelProps) {
  const { stats, isLoading, refetch } = useContextCompression({
    spaceId,
    autoRefresh: true,
    refreshInterval: 60000, // 每分钟刷新一次
  });

  const [showDetails, setShowDetails] = useState(true);
  const [showHistory, setShowHistory] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [actionError, setActionError] = useState('');

  if (isLoading && !stats) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <div className="h-4 w-4 animate-pulse rounded-full bg-slate-200" />
        加载压缩统计...
      </div>
    );
  }

  if (!stats || stats.compressionLevel === 'none') {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600">
        <CheckCircle2 size={14} />
        <span>上下文正常</span>
        {showMessageCount && (
          <span className="ml-auto text-emerald-500">{stats?.messageCount || 0} 条消息</span>
        )}
      </div>
    );
  }

  const config = {
    light: {
      icon: TrendingDown,
      color: 'text-sky-600',
      bgColor: 'bg-sky-50',
      borderColor: 'border-sky-200',
      label: '轻度压缩',
    },
    moderate: {
      icon: TrendingDown,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
      label: '中度压缩',
    },
    aggressive: {
      icon: Zap,
      color: 'text-rose-600',
      bgColor: 'bg-rose-50',
      borderColor: 'border-rose-200',
      label: '激进压缩',
    },
  }[stats.compressionLevel];

  const Icon = config.icon;

  const handleCompress = async () => {
    if (compressing) return;
    setCompressing(true);
    setActionError('');
    try {
      await spacesApi.createCheckpoint(spaceId);
      await refetch();
    } catch (err: any) {
      setActionError(err.message || '归档压缩失败');
    } finally {
      setCompressing(false);
    }
  };

  const handleClearCheckpoint = async () => {
    if (compressing) return;
    if (!window.confirm('确认清除检查点？空间将恢复为常规消息滑动窗口模式。')) return;
    setCompressing(true);
    setActionError('');
    try {
      await spacesApi.clearCheckpoint(spaceId);
      await refetch();
    } catch (err: any) {
      setActionError(err.message || '清除检查点失败');
    } finally {
      setCompressing(false);
    }
  };

  const renderFullContent = () => (
    <div className="space-y-3">
      {/* 主状态卡片 */}
      <div
        className={`rounded-lg border ${config.bgColor} ${config.borderColor} transition-all`}
      >
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.bgColor} ${config.color}`}>
            <Icon size={16} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-black ${config.color}`}>
                {config.label}
              </span>
              <span className="text-xs font-semibold text-slate-500">
                上下文优化
              </span>
            </div>
            <div className="mt-0.5 text-xs font-semibold text-slate-600">
              {stats.originalCount} → {stats.compressedCount} 条消息
              {' · '}
              {stats.reductionPercentage}% 更少 tokens
            </div>
          </div>

          <div className="flex items-center gap-2">
            {showMessageCount && (
              <span className="text-xs font-semibold text-slate-500">
                {stats.messageCount} 总消息
              </span>
            )}
            {showDetails ? (
              <ChevronUp size={16} className="text-slate-400" />
            ) : (
              <ChevronDown size={16} className="text-slate-400" />
            )}
          </div>
        </button>

        {/* 展开的详细信息 */}
        {showDetails && (
          <div className="border-t border-slate-200 px-4 py-3">
            {stats.checkpoint ? (
              <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50/80 p-3 text-xs">
                <div className="flex items-center justify-between font-black text-slate-800">
                  <span className="flex items-center gap-1.5 text-sky-700">
                    <CheckCircle2 size={14} /> 增量检查点生效中
                  </span>
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">
                    已归档 {stats.checkpoint.sourceMessageCount} 条历史
                  </span>
                </div>
                <div className="mt-1.5 leading-relaxed text-slate-600">
                  已将早期长对话浓缩为结构化背景摘要（约 {Math.round(stats.checkpoint.sourceTokenCount / 1000)}k Tokens 提炼为紧凑前情提要）。当前大模型仅携带该摘要与最新活跃对话，大幅降低 Token 消耗并彻底避免超长遗忘。
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>检查点时间：{new Date(stats.checkpoint.updatedAt).toLocaleString('zh-CN')}</span>
                </div>
              </div>
            ) : (
              <div className="mb-4 rounded-lg border border-slate-200/80 bg-white/70 p-3 text-xs">
                <div className="flex items-center justify-between font-black text-slate-700">
                  <span>增量上下文检查点</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">未建立</span>
                </div>
                <div className="mt-1.5 leading-relaxed text-slate-500">
                  当前为常规滑动窗口模式。点击下方<b>“立即归档为检查点”</b>，可将早期对话一键提炼为浓缩摘要，无需机械截断条数，高保真节省 60%~80% 上下文 Token！
                </div>
              </div>
            )}
            {/* Token 使用可视化 */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Token 使用对比</span>
                <span className="text-slate-500">
                  {Math.round(stats.originalTokens / 1000)}k → {Math.round(stats.compressedTokens / 1000)}k
                </span>
              </div>
              <div className="flex h-6 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="flex items-center justify-center bg-emerald-500 text-[10px] font-black text-white transition-all"
                  style={{
                    width: `${Math.max(12, stats.reductionPercentage)}%`,
                  }}
                >
                  -{stats.reductionPercentage}%
                </div>
                <div
                  className="flex items-center justify-center bg-slate-400 text-[10px] font-black text-white transition-all"
                  style={{
                    width: `${Math.min(88, 100 - stats.reductionPercentage)}%`,
                  }}
                >
                  纳入上下文
                </div>
              </div>
            </div>

            {/* 详细统计 */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded bg-white/50 p-2">
                <div className="font-semibold text-slate-600">历史总消息</div>
                <div className="mt-1 font-black text-slate-800">{stats.originalCount} 条</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  ~{Math.round(stats.originalTokens / 1000)}k tokens
                </div>
              </div>
              <div className="rounded bg-white/50 p-2">
                <div className="font-semibold text-slate-600">已纳入上下文</div>
                <div className="mt-1 font-black text-slate-800">{stats.compressedCount} 条</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  ~{Math.round(stats.compressedTokens / 1000)}k tokens
                </div>
              </div>
            </div>

            {/* 压缩说明 */}
            <div className="mt-3 rounded bg-white/30 p-2.5 text-[11px] leading-relaxed text-slate-600">
              <div className="flex items-start gap-2">
                <Info size={12} className="mt-0.5 shrink-0 text-slate-500" />
                <div>
                  系统智能分析了每条消息的重要性，保留了最相关的内容，确保 AI 能够理解当前任务。
                  压缩后的上下文保持了对话的关键信息和连贯性。
                </div>
              </div>
              {stats.budgetExceeded && (
                <div className="mt-2 font-semibold text-rose-600">
                  最新单条消息超过目标 token 预算，系统已保留其完整内容。
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCompress}
                disabled={compressing}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-50 shadow-xs cursor-pointer"
                title="将早期历史提炼为检查点摘要，大幅降低 Token 负载"
              >
                {compressing ? <Loader2 className="animate-spin" size={13} /> : <Zap size={13} className="text-amber-300 fill-amber-300" />}
                {stats.checkpoint ? '重新更新检查点' : '立即归档为检查点（深度压缩）'}
              </button>

              <button
                type="button"
                onClick={() => refetch()}
                disabled={compressing}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <Activity size={13} />
                刷新
              </button>

              {stats.checkpoint && (
                <button
                  type="button"
                  onClick={handleClearCheckpoint}
                  disabled={compressing}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 disabled:opacity-50"
                  title="清除检查点摘要，恢复常规全量滑动模式"
                >
                  清除检查点
                </button>
              )}

              {stats.compressionHistory && stats.compressionHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <History size={13} />
                  历史 ({stats.compressionHistory.length})
                </button>
              )}
            </div>

            {actionError && (
              <div className="mt-2 text-xs font-semibold text-rose-600">
                {actionError}
              </div>
            )}

            {/* 压缩历史 */}
            {showHistory && stats.compressionHistory && stats.compressionHistory.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-xs font-semibold text-slate-700">最近压缩记录</div>
                {stats.compressionHistory.slice(0, 3).map((record, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded bg-white/30 px-3 py-2 text-xs"
                  >
                    <div className="font-semibold text-slate-700">
                      {new Date(record.timestamp).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="font-black text-emerald-600">
                      -{record.reductionPercentage}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // 紧凑模式
  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`mx-6 my-4 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${config.bgColor} ${config.borderColor} ${config.color} transition hover:opacity-85 hover:shadow-xs active:scale-[0.99] cursor-pointer text-left w-[calc(100%-3rem)]`}
          title="点击查看上下文压缩与优化详情"
        >
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{config.label}</span>
          <span className="ml-auto font-black">{stats.reductionPercentage}%</span>
        </button>

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6 animate-in fade-in duration-150">
            <button
              type="button"
              aria-label="关闭"
              className="absolute inset-0 cursor-default"
              onClick={() => setModalOpen(false)}
            />
            <section className="relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl">
              <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.06] px-5">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                  <Icon size={17} className={config.color} />
                  上下文优化详情
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  title="关闭"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                >
                  <X size={16} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {renderFullContent()}
              </div>
            </section>
          </div>
        )}
      </>
    );
  }

  // 完整模式
  return renderFullContent();
}
