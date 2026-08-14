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
} from 'lucide-react';
import { useContextCompression } from '@/hooks/useContextCompression';

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

  const [showDetails, setShowDetails] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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

  // 紧凑模式
  if (compact) {
    return (
      <div className={`mx-6 my-4 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${config.bgColor} ${config.borderColor} ${config.color}`}>
        <Icon size={14} />
        <span>{config.label}</span>
        <span className="ml-auto font-black">{stats.reductionPercentage}%</span>
      </div>
    );
  }

  // 完整模式
  return (
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
                    width: `${stats.reductionPercentage}%`,
                  }}
                >
                  {stats.reductionPercentage > 15 ? `-${stats.reductionPercentage}%` : ''}
                </div>
                <div
                  className="flex items-center justify-center bg-slate-400 text-[10px] font-black text-white transition-all"
                  style={{
                    width: `${100 - stats.reductionPercentage}%`,
                  }}
                >
                  剩余
                </div>
              </div>
            </div>

            {/* 详细统计 */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded bg-white/50 p-2">
                <div className="font-semibold text-slate-600">原始消息</div>
                <div className="mt-1 font-black text-slate-800">{stats.originalCount} 条</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  ~{Math.round(stats.originalTokens / 1000)}k tokens
                </div>
              </div>
              <div className="rounded bg-white/50 p-2">
                <div className="font-semibold text-slate-600">压缩后</div>
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
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <Activity size={13} />
                刷新统计
              </button>

              {stats.compressionHistory && stats.compressionHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  <History size={13} />
                  历史记录 ({stats.compressionHistory.length})
                </button>
              )}
            </div>

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
}
