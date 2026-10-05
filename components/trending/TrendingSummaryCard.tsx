'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  X,
  Zap,
  Clock,
  ShieldCheck,
  Flame,
  Headphones,
  Volume2,
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
}

function buildPodcastScript(summary: string, dateLabel: string): string {
  if (!summary) return '';
  let text = summary;

  // 1. Convert markdown section headers into natural radio anchor transitions
  text = text.replace(/###?\s*[🌟✨💡]*\s*(?:全网|市场)?核心定调/g, '首先是核心定调：');
  text = text.replace(/###?\s*[🔥🎯]*\s*(?:核心)?(?:舆论|热点)?主线/g, '接下来是今日核心热点主线：');
  text = text.replace(/###?\s*[💡📊]*\s*(?:独家洞察与反思|交易员与从业者洞察|深度行业洞察|舆情情绪指数)/g, '最后来看深度洞察：');

  // 2. Strip emojis and markdown formatting
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
  text = text.replace(/[*#~`_]/g, '');

  // 3. Spoken list numerals
  text = text.replace(/(?:^|\n)\s*1[、.]\s*/g, '\n第一、');
  text = text.replace(/(?:^|\n)\s*2[、.]\s*/g, '\n第二、');
  text = text.replace(/(?:^|\n)\s*3[、.]\s*/g, '\n第三、');

  // 4. Normalize spaces and punctuation
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '。').replace(/\n/g, '，').trim();
  text = text.replace(/，{2,}/g, '，').replace(/。{2,}/g, '。');

  // 5. Ensure the spoken brief stays punchy and avoids lengthy table or runaway paragraphs
  if (text.length > 1500) {
    const slice = text.slice(0, 1400);
    const lastPeriod = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'));
    text = (lastPeriod > 800 ? slice.slice(0, lastPeriod + 1) : slice) + ' 以上是今日核心早报。';
  }

  const intro = dateLabel.includes('今日') || dateLabel.includes('实时')
    ? '各位听众早上好，为您带来今日全网热点情报速递。'
    : `各位听众好，为您回顾${dateLabel}全网热点脉络速递。`;

  return `${intro} ${text}`.trim();
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
}: TrendingSummaryCardProps) {
  const [copied, setCopied] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = React.useRef<string | null>(null);
  const currentSummaryRef = React.useRef<string>('');

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setIsAudioLoading(false);
  };

  React.useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (currentSummaryRef.current && currentSummaryRef.current !== summary) {
      stopAudio();
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    }
    currentSummaryRef.current = summary;
  }, [summary]);

  const handleTogglePodcast = async () => {
    if (!summary || loading) return;

    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    if (audioRef.current && audioUrlRef.current) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Audio resume error:', err);
      }
      return;
    }

    setIsAudioLoading(true);
    setAudioError(null);
    try {
      const podcastText = buildPodcastScript(summary, dateLabel);
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text: podcastText,
          voice: 'zh-CN-YunxiNeural', // 专业沉稳新闻播音男声
          rate: '+5%',
          cacheNamespace: 'trending',
          timeoutMs: 60000,
        }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error || `TTS synthesis failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      audioUrlRef.current = audioUrl;

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setIsPlaying(false);
      };

      audio.onerror = () => {
        setIsPlaying(false);
        setIsAudioLoading(false);
      };

      await audio.play();
      setIsPlaying(true);
    } catch (err: any) {
      console.error('Failed to play podcast:', err);
      setAudioError(err?.message?.includes('timed out') ? '语音合成超时，请重试' : '语音生成失败，请重试');
      setTimeout(() => setAudioError(null), 4000);
    } finally {
      setIsAudioLoading(false);
    }
  };

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

  const handleClose = () => {
    stopAudio();
    onClose?.();
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
        {/* Action buttons (Icon only) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 🎧 播报早报 Button */}
          <button
            onClick={handleTogglePodcast}
            disabled={loading || !summary}
            className={`flex h-8 w-8 items-center justify-center rounded-xl shadow-sm transition disabled:opacity-50 ${
              audioError
                ? 'border border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                : isPlaying
                ? 'border border-amber-400 bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-amber-500/20 ring-2 ring-amber-400/40'
                : isAudioLoading
                ? 'border border-amber-300 bg-amber-100/90 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/60 dark:text-amber-200'
                : 'border border-amber-200/80 bg-white/90 text-slate-700 hover:bg-amber-50 dark:border-amber-800/40 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
            title={audioError || (isPlaying ? '暂停播报' : isAudioLoading ? '正在合成播音 (通常需 3-6 秒)...' : '听早报 (微软神经元新闻主播云希)')}
          >
            {isAudioLoading ? (
              <RefreshCw size={14} className="animate-spin text-amber-600 dark:text-amber-400" />
            ) : isPlaying ? (
              <span className="flex items-center gap-0.5 h-3">
                <span className="w-0.5 h-3 bg-white rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-0.5 h-2 bg-white rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-0.5 h-3.5 bg-white rounded-full animate-bounce" />
              </span>
            ) : (
              <Headphones size={14} className="text-amber-600 dark:text-amber-400" />
            )}
          </button>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            disabled={loading || !summary}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-amber-200/80 bg-white/90 text-slate-700 shadow-sm transition hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800/40 dark:bg-slate-800/90 dark:text-slate-200 dark:hover:bg-slate-700"
            title={copied ? '已复制到剪贴板' : '复制简报全文'}
          >
            {copied ? (
              <Check size={14} className="text-emerald-500" />
            ) : (
              <Copy size={14} className="text-slate-500 dark:text-slate-400" />
            )}
          </button>

          {/* Re-generate (only for today or user forced) */}
          {onRefresh && !isHistorical && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200/80 bg-white/80 text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
              title="重新向大模型发起全网数据提炼"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-amber-500' : ''} />
            </button>
          )}

          {/* Close button */}
          {onClose && (
            <button
              onClick={handleClose}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-black/5 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-200"
              title="收起 AI 汇总面板"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Card Content Area */}
      <div className="relative z-10 pt-4">
        {/* Active Audio Broadcast Bar */}
        {(isPlaying || (audioRef.current && !isPlaying && !isAudioLoading)) && (
          <div className="mb-3.5 flex items-center justify-between rounded-2xl bg-amber-500/10 px-3.5 py-2 border border-amber-500/20 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-300">
                <Volume2 size={13} className={isPlaying ? 'animate-pulse' : ''} />
              </span>
              <div className="flex items-center gap-2">
                <span className="font-bold">
                  {isPlaying ? '🎙️ AI 主播正在语音播报今日早报' : '⏸️ 语音播报已暂停'}
                </span>
                <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80 hidden sm:inline-block">
                  · 微软 Edge 神经元原声主播（云希）
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTogglePodcast}
                className="rounded-lg bg-amber-500/20 px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-500/30 dark:text-amber-200 transition"
              >
                {isPlaying ? '暂停' : '继续播放'}
              </button>
              <button
                onClick={stopAudio}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition"
              >
                结束
              </button>
            </div>
          </div>
        )}
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

      {/* Footer */}
      {!loading && summary && (
        <div className="relative z-10 mt-4 flex items-center justify-between border-t border-amber-200/40 pt-3 text-xs dark:border-amber-800/30">
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <Flame size={12} className="text-orange-500 fill-orange-500" />
            <span>全网舆情深度洞察</span>
          </div>
          <span className="text-[10px] text-slate-400">
            Almaren AI 智能脱水调度引擎 · 核心热点脉络梳理
          </span>
        </div>
      )}
    </div>
  );
}
