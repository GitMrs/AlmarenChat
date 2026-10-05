'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  Bot,
  PanelsTopLeft,
  X,
  Zap,
  Clock,
  ShieldCheck,
  Flame,
} from 'lucide-react';

export interface TrendingSummaryCardProps {
  summary: string;
  loading: boolean;
  cached?: boolean;
  updatedAt?: string;
  sampleCount?: number;
  dateLabel: string;
  isHistorical?: boolean;
  onRefresh?: () => void;
  onClose?: () => void;
  onTalkToAgent?: (content: string) => void;
  onDiscussInSpace?: (content: string) => void;
}

export default function TrendingSummaryCard({
  summary,
  loading,
  cached = false,
  updatedAt,
  sampleCount = 35,
  dateLabel,
  isHistorical = false,
  onRefresh,
  onClose,
  onTalkToAgent,
  onDiscussInSpace,
}: TrendingSummaryCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!summary) return;
    try {
      const fullText = `【${dateLabel} · AI 全网热点脉络速报】\n\n${summary}\n\n-- 来自 Almaren 全网实时热榜中心`;
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy summary:', err);
    }
  };

  const formattedTime = updatedAt
    ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="relative mb-6 overflow-hidden rounded-3xl border border-amber-300/60 bg-gradient-to-br from-amber-50/80 via-orange-50/40 to-indigo-50/60 p-5 shadow-sm backdrop-blur-md transition-all sm:p-6 dark:border-amber-700/30 dark:from-amber-950/20 dark:via-orange-950/10 dark:to-indigo-950/20">
      {/* Decorative background glow */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-gradient-to-br from-amber-400/20 to-orange-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-gradient-to-tr from-indigo-400/15 to-purple-500/10 blur-3xl" />

      {/* Header bar */}
      <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-amber-200/50 pb-4 dark:border-amber-800/30">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 text-white shadow-md shadow-orange-500/20">
            <Sparkles size={20} className="animate-pulse" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-black text-slate-900 dark:text-white">
                {isHistorical ? `📜 ${dateLabel} 舆情深度全景情报` : '✨ AI 全网热点脉络提炼'}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100/90 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                <Zap size={10} className="text-amber-600 fill-amber-600" />
                分层脱水 {sampleCount} 条代表事件
              </span>
              {cached && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/90 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                  <ShieldCheck size={10} />
                  已秒级极速命中
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              跨 21 平台 500+ 原始数据多级蒸馏 · 穿透全网情绪基调与深层趋势
              {formattedTime && ` · 更新于 ${formattedTime}`}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Copy Button */}
          <button
            onClick={handleCopy}
            disabled={loading || !summary}
            className="flex items-center gap-1.5 rounded-xl border border-amber-200/80 bg-white/90 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800/40 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-700"
            title="一键复制完整 AI 早报内容"
          >
            {copied ? (
              <>
                <Check size={13} className="text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">已复制简报</span>
              </>
            ) : (
              <>
                <Copy size={13} className="text-slate-500" />
                <span>复制简报</span>
              </>
            )}
          </button>

          {/* Talk to Agent */}
          {onTalkToAgent && (
            <button
              onClick={() => onTalkToAgent(summary)}
              disabled={loading || !summary}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-200/80 bg-indigo-50/90 px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-sm transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800/40 dark:bg-indigo-950/60 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
              title="挑选 AI Agent 就本期热点进行专属深度解读与对话"
            >
              <Bot size={13} className="text-indigo-600 dark:text-indigo-400" />
              <span>找 Agent 畅聊</span>
            </button>
          )}

          {/* Share to Space */}
          {onDiscussInSpace && (
            <button
              onClick={() => onDiscussInSpace(summary)}
              disabled={loading || !summary}
              className="flex items-center gap-1.5 rounded-xl border border-orange-200/80 bg-orange-50/90 px-3 py-1.5 text-xs font-bold text-orange-700 shadow-sm transition hover:bg-orange-100 disabled:opacity-50 dark:border-orange-800/40 dark:bg-orange-950/60 dark:text-orange-300 dark:hover:bg-orange-900/50"
              title="将热点脉络投递至群聊空间让多 Agent 自主研讨"
            >
              <PanelsTopLeft size={13} className="text-orange-600 dark:text-orange-400" />
              <span>投喂空间</span>
            </button>
          )}

          {/* Re-generate (only for today or user forced) */}
          {onRefresh && !isHistorical && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-1 rounded-xl border border-slate-200/80 bg-white/80 p-1.5 text-xs font-bold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
              title="重新向大模型发起全网数据提炼"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-amber-500' : ''} />
            </button>
          )}

          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-xl p-1.5 text-slate-400 transition hover:bg-black/5 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-200"
              title="收起 AI 汇总面板"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Card Content Area */}
      <div className="relative z-10 pt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="relative mb-3 flex h-12 w-12 items-center justify-center">
              <div className="absolute inset-0 animate-ping rounded-full bg-amber-400/30"></div>
              <Sparkles size={28} className="animate-spin text-amber-500 duration-1000" />
            </div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
              AI 正在分层蒸馏全网舆情大盘...
            </p>
            <p className="mt-1 text-xs text-slate-400 max-w-md">
              已将 21 平台 500+ 条原始数据脱水压缩至约 1500 Tokens，大模型正在梳理核心定调与底层主线...
            </p>
          </div>
        ) : !summary ? (
          <div className="py-6 text-center text-xs text-slate-400">
            暂无热点提炼结果，可点击「重新提炼」按钮生成。
          </div>
        ) : (
          <div className="prose prose-slate max-w-none text-xs sm:text-sm leading-relaxed dark:prose-invert">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h3: ({ children }) => (
                  <h3 className="mb-2 mt-4 flex items-center gap-2 border-b border-amber-200/40 pb-1.5 text-sm font-black text-amber-900 dark:border-amber-800/30 dark:text-amber-300">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="mb-2 text-slate-700 leading-relaxed dark:text-slate-300">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="mb-3 space-y-1.5 list-none pl-1">
                    {children}
                  </ul>
                ),
                li: ({ children }) => (
                  <li className="relative pl-4 text-slate-700 before:absolute before:left-0 before:top-2 before:h-1.5 before:w-1.5 before:rounded-full before:bg-amber-400 dark:text-slate-300 dark:before:bg-amber-500">
                    {children}
                  </li>
                ),
                strong: ({ children }) => (
                  <strong className="font-bold text-slate-900 dark:text-white">
                    {children}
                  </strong>
                ),
              }}
            >
              {summary}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Interactive Exploration Footer */}
      {!loading && summary && (
        <div className="relative z-10 mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-amber-200/40 pt-3 text-xs dark:border-amber-800/30">
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <Flame size={12} className="text-orange-500 fill-orange-500" />
            <span>智能延伸探讨：</span>
            <button
              onClick={() =>
                onTalkToAgent &&
                onTalkToAgent(`根据这份《${dateLabel}全网热点速报》，请深入剖析一下今天网民情绪的最大转向是什么？有什么深层社会心理学原因？`)
              }
              className="text-amber-700 hover:underline dark:text-amber-400"
            >
              #公众情绪深层解析
            </button>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <button
              onClick={() =>
                onTalkToAgent &&
                onTalkToAgent(`参考这份《${dateLabel}全网热点情报》，如果你是一位自媒体内容总编，你会策划哪三个爆款选题？给出具体切入角度。`)
              }
              className="text-amber-700 hover:underline dark:text-amber-400"
            >
              #自媒体爆款选题指南
            </button>
          </div>
          <span className="text-[10px] text-slate-400">
            Almaren AI 智能脱水调度引擎 · 保障 Token 安全与超低延迟
          </span>
        </div>
      )}
    </div>
  );
}
