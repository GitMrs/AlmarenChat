'use client';

import { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { AgentDailyStudyRecord, AgentStudyItem } from '@/lib/agent-study/types';

interface AgentDailyStudyCardProps {
  study: AgentDailyStudyRecord | null;
  loading?: boolean;
  onRefresh?: () => void;
  onDiscuss?: (item: AgentStudyItem) => void;
  className?: string;
  defaultCollapsed?: boolean;
}

function getSourceStyle(source: string) {
  switch (source) {
    case 'bilibili':
      return {
        bg: 'bg-rose-50 text-rose-700 border-rose-200',
        badge: 'bg-rose-500 text-white',
        label: 'B站热门',
      };
    case 'zhihu':
      return {
        bg: 'bg-blue-50 text-blue-700 border-blue-200',
        badge: 'bg-blue-500 text-white',
        label: '知乎热榜',
      };
    case 'hellogithub':
    case 'juejin':
      return {
        bg: 'bg-purple-50 text-purple-700 border-purple-200',
        badge: 'bg-purple-600 text-white',
        label: '开发者热点',
      };
    case '36kr':
      return {
        bg: 'bg-amber-50 text-amber-800 border-amber-200',
        badge: 'bg-amber-600 text-white',
        label: '36氪创投',
      };
    default:
      return {
        bg: 'bg-slate-100 text-slate-700 border-slate-200',
        badge: 'bg-slate-700 text-white',
        label: '全网热点',
      };
  }
}

export default function AgentDailyStudyCard({
  study,
  loading = false,
  onRefresh,
  onDiscuss,
  className = '',
  defaultCollapsed = false,
}: AgentDailyStudyCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Set<string>>(new Set());

  if (!study && !loading) return null;

  const toggleExpand = (id: string) => {
    setExpandedSummaryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className={`overflow-hidden rounded-3xl border border-amber-200/60 bg-gradient-to-b from-[#fffefc] to-[#fbfaf7] p-4 sm:p-5 shadow-xs transition ${className}`}
    >
      {/* 头部标题区 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-black text-slate-900 sm:text-base">
                {study?.agentName || 'Agent'} 的今日学习手记
              </h3>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                今日 {study?.items.length || 0} 篇
              </span>
            </div>
            <p className="truncate text-xs font-medium text-slate-500">
              全网精选热门内容自主研读与心得沉淀
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="重新挑选并研读今日新内容"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-amber-600' : ''} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 active:scale-95 cursor-pointer"
            title={collapsed ? '展开学习手记' : '收起学习手记'}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {loading && !study && (
        <div className="mt-4 flex items-center justify-center gap-2 py-6 text-xs font-bold text-slate-500">
          <RefreshCw size={14} className="animate-spin text-amber-600" />
          <span>正在精选全网热点并由角色自主研读...</span>
        </div>
      )}

      {/* 展开内容区 */}
      {!collapsed && study && (
        <div className="mt-4 space-y-3.5">
          {/* 角色主动分享气泡 */}
          {study.greeting && (
            <div className="relative rounded-2xl bg-gradient-to-r from-amber-500/10 via-rose-500/5 to-transparent p-3.5 sm:p-4 text-xs sm:text-sm font-medium leading-relaxed text-amber-950 ring-1 ring-amber-300/40">
              <span className="font-bold text-amber-800 mr-1.5">【{study.agentName} 说】</span>
              “{study.greeting}”
            </div>
          )}

          {/* 3 篇学习项目网格列表 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {study.items.map((item) => {
              const style = getSourceStyle(item.source);
              const isExpanded = expandedSummaryIds.has(item.id);

              return (
                <div
                  key={item.id}
                  className="flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-white p-3.5 shadow-2xs transition hover:shadow-xs hover:border-black/[0.12]"
                >
                  <div>
                    {/* 标签行 */}
                    <div className="flex items-center justify-between gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${style.badge}`}>
                        {item.sourceName || style.label}
                      </span>
                      {item.heat && (
                        <span className="truncate text-[11px] font-semibold text-rose-500">
                          🔥 {item.heat}
                        </span>
                      )}
                    </div>

                    {/* 封面图 (若有) */}
                    {item.thumbnail && (
                      <div className="mt-2.5 aspect-video w-full overflow-hidden rounded-xl bg-slate-100">
                        <img
                          src={item.thumbnail}
                          alt={item.title}
                          className="h-full w-full object-cover transition duration-300 hover:scale-105"
                          loading="lazy"
                        />
                      </div>
                    )}

                    {/* 标题 */}
                    <h4 className="mt-2.5 line-clamp-2 text-xs font-black leading-snug text-slate-900">
                      {item.title}
                    </h4>

                    {/* 角色第一人称心得 */}
                    <div className="mt-2 rounded-xl bg-[#fcfbf9] border border-amber-200/50 p-2.5 text-[11px] leading-relaxed text-slate-700">
                      <span className="font-bold text-amber-700">💬 心得：</span>
                      {item.thoughts}
                    </div>

                    {/* 结构化干货要点 */}
                    {item.summary && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => toggleExpand(item.id)}
                          className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          <BookOpen size={12} />
                          <span>{isExpanded ? '收起知识要点' : '查看知识要点'}</span>
                        </button>
                        {isExpanded && (
                          <p className="mt-1.5 rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
                            {item.summary}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 底部操作区 */}
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-black/[0.04] pt-2.5">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-900"
                    >
                      <span>原文链接</span>
                      <ExternalLink size={11} />
                    </a>

                    {onDiscuss && (
                      <button
                        type="button"
                        onClick={() => onDiscuss(item)}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-black text-white transition hover:bg-slate-800 active:scale-95 cursor-pointer shadow-2xs"
                      >
                        <MessageCircle size={11} />
                        <span>聊聊这个</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
