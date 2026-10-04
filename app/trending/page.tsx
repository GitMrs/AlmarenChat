'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Flame,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  Bot,
  PanelsTopLeft,
  Sparkles,
  Search,
} from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { GAMING_AGENTS } from '@/lib/gaming-agents';
import { TRENDING_CATEGORIES } from '@/lib/trending/sources';
import type { TrendingCategory } from '@/lib/trending/types';

interface HotItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  url: string;
  heat?: string;
  desc?: string;
  thumbnail?: string;
}

interface SourceData {
  source: string;
  sourceName: string;
  category?: string;
  categoryName?: string;
  icon?: string;
  updatedAt: string;
  total: number;
  items: HotItem[];
}

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.max(1, Math.floor(diffSec / 60))}分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '刚刚';
  }
}

export default function TrendingPage() {
  const router = useRouter();
  const [data, setData] = useState<SourceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingSources, setRefreshingSources] = useState<Record<string, boolean>>({});
  const [activeCategory, setActiveCategory] = useState<TrendingCategory | 'all'>('all');
  const [activeSource, setActiveSource] = useState<string>('zhihu');
  const [searchQuery, setSearchQuery] = useState('');
  const loadedCategoriesRef = React.useRef<Set<string>>(new Set());

  // Agent 选择弹窗状态
  const [selectedTopic, setSelectedTopic] = useState<HotItem | null>(null);
  const [agentModalOpen, setAgentModalOpen] = useState(false);

  const mergeSources = (newSources: SourceData[]) => {
    setData((prev) => {
      const map = new Map<string, SourceData>(prev.map((s) => [s.source, s]));
      newSources.forEach((s) => {
        if (s.items && s.items.length > 0) {
          map.set(s.source, s);
        }
      });
      return Array.from(map.values());
    });
  };

  // 1. 按需加载分类数据：只有初次访问或用户主动刷新时才请求
  const loadCategoryData = async (cat: TrendingCategory | 'all', force = false) => {
    if (!force && loadedCategoriesRef.current.has(cat)) {
      return;
    }

    if (force) setRefreshing(true);
    else setLoading(!loadedCategoriesRef.current.has(cat));

    try {
      const url =
        cat === 'all'
          ? `/api/trending?source=all&limit=20${force ? '&refresh=true' : ''}`
          : `/api/trending?category=${cat}&limit=20${force ? '&refresh=true' : ''}`;

      const res = await fetch(url);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        mergeSources(json.data);
        loadedCategoriesRef.current.add(cat);
        if (cat === 'all') {
          TRENDING_CATEGORIES.forEach((c) => loadedCategoriesRef.current.add(c.id));
        }
      }
    } catch (err) {
      console.error('Failed to load trending data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 2. 精准刷新单个平台数据源
  const refreshSingleSource = async (sourceId: string) => {
    setRefreshingSources((prev) => ({ ...prev, [sourceId]: true }));
    setRefreshing(true);
    try {
      const res = await fetch(`/api/trending?source=${sourceId}&limit=20&refresh=true`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        mergeSources(json.data);
      }
    } catch (err) {
      console.error(`Failed to refresh source ${sourceId}:`, err);
    } finally {
      setRefreshing(false);
      setRefreshingSources((prev) => {
        const next = { ...prev };
        delete next[sourceId];
        return next;
      });
    }
  };

  // 3. 顶部智能按需刷新：根据当前选中的平台或分类进行针对性刷新
  const handleSmartRefresh = async () => {
    if (activeSource !== 'all') {
      await refreshSingleSource(activeSource);
    } else if (activeCategory !== 'all') {
      await loadCategoryData(activeCategory, true);
    } else {
      await loadCategoryData('all', true);
    }
  };

  // 页面初次载入仅拉取默认专区（全民热议）
  useEffect(() => {
    loadCategoryData(activeCategory);
  }, []);

  // 切换专区时按需加载
  const handleCategoryChange = (cat: TrendingCategory | 'all') => {
    setActiveCategory(cat);
    setActiveSource('all');
    loadCategoryData(cat);
  };

  const getRefreshButtonLabel = () => {
    if (refreshing) return '正在获取最新...';
    if (activeSource !== 'all') {
      const s = data.find((d) => d.source === activeSource);
      return `刷新${s?.sourceName || '当前平台'}`;
    }
    if (activeCategory !== 'all') {
      const c = TRENDING_CATEGORIES.find((cat) => cat.id === activeCategory);
      return `刷新${c?.name || '当前专区'}`;
    }
    return '全量刷新 (21平台)';
  };

  // 找 Agent 锐评
  const handleTalkToAgent = (item: HotItem) => {
    setSelectedTopic(item);
    setAgentModalOpen(true);
  };

  const startChatWithAgent = (agentId: string) => {
    if (!selectedTopic) return;
    const prompt = `你怎么看待今天${selectedTopic.sourceName}上的这个热搜：\n《${selectedTopic.title}》${selectedTopic.heat ? `（热度：${selectedTopic.heat}）` : ''}\n从你的独特视角来锐评一下吧！`;
    setAgentModalOpen(false);
    router.push(`/chat/${agentId}?initialPrompt=${encodeURIComponent(prompt)}`);
  };

  // 引入空间讨论
  const handleDiscussInSpace = (item: HotItem) => {
    const prompt = `【今日全网热议】看看这个来自${item.sourceName}的实时热搜：\n《${item.title}》${item.heat ? `（${item.heat}）` : ''}\n大家根据各自的专业或立场，各抒己见讨论一下！`;
    router.push(`/spaces?initialTopic=${encodeURIComponent(prompt)}`);
  };

  // 1. 先按分类过滤
  const categoryFiltered = data.filter((src) => {
    if (activeCategory === 'all') return true;
    return src.category === activeCategory;
  });

  // 2. 再按源与关键词过滤
  const filteredSources = categoryFiltered
    .filter((src) => activeSource === 'all' || src.source === activeSource)
    .map((src) => {
      if (!searchQuery.trim()) return src;
      const q = searchQuery.toLowerCase();
      return {
        ...src,
        items: src.items.filter(
          (it) => it.title.toLowerCase().includes(q) || it.desc?.toLowerCase().includes(q)
        ),
      };
    })
    .filter((src) => src.items.length > 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-orange-500/20">
                <Flame size={24} className="fill-white" />
              </span>
              <div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">全网实时热榜中心</h1>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  精选 21 个全网主流平台 · 全民热议 · 二次元游戏 · 科技商业 · 数码极客 · 文化生活 · 实时热榜
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Refresh Button */}
            <button
              onClick={handleSmartRefresh}
              disabled={refreshing || loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              title="按当前所选分类或平台精准刷新，避免无谓全量请求"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin text-amber-500' : ''} />
              <span>{getRefreshButtonLabel()}</span>
            </button>
          </div>
        </div>

        {/* 1. 大分类导航条 (5大专区) */}
        <div className="mb-4 flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {TRENDING_CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => handleCategoryChange(cat.id)}
                className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black transition ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-md shadow-slate-900/10 dark:bg-white dark:text-slate-900'
                    : 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.name}</span>
              </button>
            );
          })}
        </div>

        {/* 2. 细分平台选择与搜索条 */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scrollbar-none pb-1">
            <button
              onClick={() => setActiveSource('all')}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                activeSource === 'all'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <span>{activeCategory === 'all' ? '全部平台' : '专区全部'}</span>
              <span className="rounded-full bg-black/10 px-1.5 py-0.2 text-[10px] dark:bg-white/10">
                {categoryFiltered.length} 平台
              </span>
            </button>
            {categoryFiltered.map((src) => {
              const isSourceRefreshing = Boolean(refreshingSources[src.source]);
              return (
                <button
                  key={src.source}
                  onClick={() => setActiveSource(src.source)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    activeSource === src.source
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <span>{src.sourceName}</span>
                  {isSourceRefreshing ? (
                    <RefreshCw size={10} className="animate-spin text-white" />
                  ) : (
                    <span className="rounded-full bg-black/10 px-1.5 py-0.2 text-[10px] dark:bg-white/10">
                      {src.items.length}条
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search box */}
          <div className="relative w-full sm:w-60 shrink-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索当前热点..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-medium text-slate-800 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3">
            <LoadingSpinner />
            <p className="text-xs font-semibold text-slate-400">正在装载全网实时热榜...</p>
          </div>
        ) : filteredSources.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center dark:border-slate-800 dark:bg-slate-900/20">
            <p className="text-sm font-bold text-slate-500">该分类下暂无热搜话题或正在刷新中</p>
            <p className="text-xs text-slate-400">点击右上角「实时刷新」获取最新数据</p>
          </div>
        ) : filteredSources.length === 1 ? (
            /* Single Platform Spread-Out View (单个平台铺开全屏) */
            <div className="flex flex-col gap-4">
              {/* Single Platform Sub-Header (轻量紧凑的状态条，消除大白卡片冗余) */}
              <div className="flex items-center justify-between px-1 py-0.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-base dark:bg-amber-500/20">
                    {filteredSources[0].icon || '🔥'}
                  </span>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-black text-slate-900 dark:text-white">
                      {filteredSources[0].sourceName}
                    </h2>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                      TOP {filteredSources[0].items.length} 热榜
                    </span>
                    {refreshing ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 animate-pulse">
                        <RefreshCw size={11} className="animate-spin" />
                        正在连接官方接口同步最新...
                      </span>
                    ) : (
                      <span className="hidden sm:inline-block text-xs text-slate-400">
                        · {formatTimeAgo(filteredSources[0].updatedAt)}更新
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveSource('all')}
                    className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400 transition"
                  >
                    <span>← 返回全平台对比</span>
                  </button>
                </div>
              </div>

              {/* Spread-out Hot Items Grid (3 columns on desktop) */}
              <div
                className={`grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3 transition-opacity duration-200 ${
                  refreshing ? 'opacity-50 pointer-events-none' : 'opacity-100'
                }`}
              >
                {filteredSources[0].items.map((item, idx) => {
                  const rank = idx + 1;
                  const isTop3 = rank <= 3;
                  const cleanDesc = item.desc ? item.desc.replace(/\[图片\]/g, '').replace(/\[视频\]/g, '').trim() : '';

                  return (
                    <div
                      key={item.id || idx}
                      className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-amber-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-amber-500/40"
                    >
                      <div className="flex-1">
                        <div className="flex items-start gap-3">
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-black ${
                              isTop3
                                ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {rank}
                          </span>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-bold leading-snug text-slate-900 group-hover:text-amber-600 dark:text-slate-100 dark:group-hover:text-amber-400 line-clamp-2">
                              {item.title}
                            </h4>
                            {cleanDesc ? (
                              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">
                                {cleanDesc}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom Bar */}
                      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800/80">
                        <span className="font-bold text-amber-600 dark:text-amber-400 text-xs whitespace-nowrap shrink-0">
                          {item.heat && `🔥 ${item.heat}`}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
                              title="查看原文"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                          <button
                            onClick={() => handleTalkToAgent(item)}
                            className="flex items-center gap-1 rounded-xl bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100 transition dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
                            title="选角色锐评此话题"
                          >
                            <Bot size={13} />
                            <span>AI锐评</span>
                          </button>
                          <button
                            onClick={() => handleDiscussInSpace(item)}
                            className="flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 transition dark:bg-slate-800 dark:text-slate-200"
                            title="投喂到空间引发智能体群聊"
                          >
                            <PanelsTopLeft size={13} />
                            <span>进空间</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Multi-Board Grid (多个看板并排) */
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredSources.map((src) => (
                <div
                  key={src.source}
                  className="flex flex-col rounded-3xl border border-slate-100 bg-slate-50/50 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/40"
                >
                {/* Board Header */}
                <div className="mb-4 flex items-center justify-between border-b border-slate-200/60 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                      {src.sourceName}
                    </h3>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                      TOP {src.items.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">
                      {formatTimeAgo(src.updatedAt)}
                    </span>
                    <button
                      onClick={() => refreshSingleSource(src.source)}
                      disabled={Boolean(refreshingSources[src.source])}
                      title={`仅刷新 ${src.sourceName}`}
                      className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
                    >
                      <RefreshCw
                        size={11}
                        className={refreshingSources[src.source] ? 'animate-spin text-amber-500' : ''}
                      />
                    </button>
                  </div>
                </div>

                {/* Items */}
                <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[680px] pr-1">
                  {src.items.map((item, idx) => {
                    const rank = idx + 1;
                    const isTop3 = rank <= 3;
                    const cleanDesc = item.desc ? item.desc.replace(/\[图片\]/g, '').replace(/\[视频\]/g, '').trim() : '';
                    return (
                      <div
                        key={item.id || idx}
                        className="group relative flex flex-col justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm transition hover:border-amber-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-800/90 dark:hover:border-amber-500/30"
                      >
                        <div className="flex items-start gap-2.5">
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-black ${
                              isTop3
                                ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {rank}
                          </span>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs font-bold leading-snug text-slate-900 group-hover:text-amber-600 dark:text-slate-100 dark:group-hover:text-amber-400 line-clamp-2">
                              {item.title}
                            </h4>
                            {cleanDesc ? (
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">
                                {cleanDesc}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {/* Card bottom bar */}
                        <div className="flex items-center justify-between gap-2 border-t border-slate-50 pt-2 text-[11px] dark:border-slate-800/60">
                          <span className="font-bold text-amber-600 dark:text-amber-400 text-[10px] whitespace-nowrap shrink-0">
                            {item.heat && `🔥 ${item.heat}`}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {item.url && (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
                                title="查看原文"
                              >
                                <ExternalLink size={12} />
                              </a>
                            )}
                            <button
                              onClick={() => handleTalkToAgent(item)}
                              className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-100 transition dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
                              title="找 Agent 锐评"
                            >
                              <Bot size={12} />
                              <span>AI锐评</span>
                            </button>
                            <button
                              onClick={() => handleDiscussInSpace(item)}
                              className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-200 transition dark:bg-slate-700 dark:text-slate-200"
                              title="引入群聊空间"
                            >
                              <PanelsTopLeft size={12} />
                              <span>进空间</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 选 Agent 弹窗 */}
        {agentModalOpen && selectedTopic && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in">
            <div className="flex w-full max-w-md flex-col rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                    <Sparkles size={16} />
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">选择哪位角色为你锐评？</h3>
                </div>
                <button
                  onClick={() => setAgentModalOpen(false)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  ✕
                </button>
              </div>

              <div className="mb-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="text-[11px] font-semibold text-slate-400">选中的热搜话题：</p>
                <p className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-2 mt-0.5">
                  {selectedTopic.title}
                </p>
              </div>

              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {GAMING_AGENTS.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => startChatWithAgent(agent.id)}
                    className="flex items-center gap-3 rounded-2xl border border-slate-100 p-2.5 text-left transition hover:border-amber-300 hover:bg-amber-50/50 dark:border-slate-800 dark:hover:border-amber-500/30 dark:hover:bg-slate-800"
                  >
                    <span className="text-2xl">{agent.avatar}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 dark:text-white">{agent.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">{agent.description}</div>
                    </div>
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-bold">对话 →</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
