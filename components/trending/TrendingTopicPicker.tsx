'use client';

import React, { useState, useEffect } from 'react';
import { Flame, RefreshCw, ExternalLink, MessageSquare, X } from 'lucide-react';

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

interface TrendingSource {
  id: string;
  name: string;
  icon: string;
  category?: string;
  categoryName: string;
}

interface TrendingCategoryItem {
  id: string;
  name: string;
  icon: string;
}

interface TrendingTopicPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTopic: (prompt: string, item: HotItem) => void;
  agentName?: string;
  mode?: 'chat' | 'space' | 'assistant';
}

export default function TrendingTopicPicker({
  isOpen,
  onClose,
  onSelectTopic,
  agentName,
  mode = 'chat',
}: TrendingTopicPickerProps) {
  const [sources, setSources] = useState<TrendingSource[]>([]);
  const [categories, setCategories] = useState<TrendingCategoryItem[]>([
    { id: 'all', name: '全部', icon: '🔥' },
    { id: 'hot', name: '全民热议', icon: '⚡' },
    { id: 'anime', name: '二次元游戏', icon: '🎮' },
    { id: 'tech', name: '科技商业', icon: '💡' },
    { id: 'dev', name: '数码极客', icon: '💻' },
    { id: 'culture', name: '文化生活', icon: '🎬' },
  ]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeSource, setActiveSource] = useState<string>('zhihu');
  const [items, setItems] = useState<HotItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // 1. 加载可用数据源列表与分类
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/trending?source=sources')
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          if (Array.isArray(res.categories) && res.categories.length > 0) {
            setCategories(res.categories);
          }
          if (Array.isArray(res.sources) && res.sources.length > 0) {
            setSources(res.sources);
          }
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // 2. 加载当前选中的热榜数据
  const loadTrendingData = async (sourceId: string, force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/trending?source=${sourceId}&limit=25${force ? '&refresh=true' : ''}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        setItems(data.items);
      } else {
        setError(data.error || '获取热榜失败');
      }
    } catch (err: any) {
      setError(err?.message || '网络请求异常');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeSource) {
      loadTrendingData(activeSource);
    }
  }, [isOpen, activeSource]);

  if (!isOpen) return null;

  const handlePick = (item: HotItem) => {
    let prompt = '';
    if (mode === 'space') {
      prompt = `【今日热搜讨论】@所有人 看看这个来自${item.sourceName}的实时热点：\n《${item.title}》${item.heat ? `（热度：${item.heat}）` : ''}\n大家结合各自擅长的视角和立场，来展开聊聊你们的看法吧！`;
    } else {
      const target = agentName ? `${agentName}，` : '';
      prompt = `${target}你怎么看待今天${item.sourceName}上的这个热搜：\n《${item.title}》${item.heat ? `（${item.heat}）` : ''}\n谈谈你的独到看法或者观点吧！`;
    }
    onSelectTopic(prompt, item);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="flex h-[80vh] max-h-[680px] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl transition-all dark:bg-slate-900 border border-slate-100 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
              <Flame size={20} className="fill-amber-500" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">今日实时热榜灵感</h2>
              <p className="hidden sm:block text-xs text-slate-400">一键将全网真实热点投喂给 Agent 或空间展开讨论</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href="/trending"
              target="_blank"
              rel="noopener noreferrer"
              title="在新窗口打开完整全网热榜"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            >
              <ExternalLink size={16} />
            </a>
            <button
              onClick={() => loadTrendingData(activeSource, true)}
              disabled={refreshing || loading}
              title="强制刷新最新数据"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 px-6 py-2 dark:border-slate-800 scrollbar-none bg-slate-50/80 dark:bg-slate-900/80">
          {categories.map((cat) => {
            const isCatActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id);
                  const matching = cat.id === 'all' ? sources : sources.filter((s) => s.category === cat.id);
                  if (matching.length > 0 && !matching.some((s) => s.id === activeSource)) {
                    setActiveSource(matching[0].id);
                  }
                }}
                className={`flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-bold transition ${
                  isCatActive
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-white/80 text-slate-600 hover:bg-white dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.name}</span>
              </button>
            );
          })}
        </div>

        {/* Source Tabs */}
        <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-6 py-2.5 dark:border-slate-800 scrollbar-none bg-white dark:bg-slate-900">
          {((activeCategory === 'all' ? sources : sources.filter((s) => s.category === activeCategory)).length > 0
            ? (activeCategory === 'all' ? sources : sources.filter((s) => s.category === activeCategory))
            : [
                { id: 'zhihu', name: '知乎热榜', icon: '🔮', categoryName: '热议' },
                { id: 'bilibili', name: 'B站热门', icon: '📺', categoryName: '视频' },
                { id: 'baidu', name: '百度热搜', icon: '🔍', categoryName: '大众' },
              ]
          ).map((src) => {
            const isActive = activeSource === src.id;
            return (
              <button
                key={src.id}
                onClick={() => setActiveSource(src.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <span>{src.icon}</span>
                <span>{src.name}</span>
              </button>
            );
          })}
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 text-slate-400">
              <RefreshCw size={24} className="animate-spin text-amber-500" />
              <span className="text-xs font-medium">正在获取最新热榜数据...</span>
            </div>
          ) : error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-400">
              <p className="text-xs text-rose-500">{error}</p>
              <button
                onClick={() => loadTrendingData(activeSource, true)}
                className="mt-2 text-xs font-bold text-amber-500 underline"
              >
                点击重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-xs text-slate-400">
              该平台暂无热榜数据
            </div>
          ) : (
            items.map((item, idx) => {
              const rank = idx + 1;
              const isTop3 = rank <= 3;
              return (
                <div
                  key={item.id || idx}
                  className="group relative flex flex-col gap-1.5 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm transition hover:border-amber-200 hover:shadow-md dark:border-slate-800/80 dark:bg-slate-800/60 dark:hover:border-amber-500/30"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-black ${
                        isTop3
                          ? 'bg-amber-500 text-white'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900 group-hover:text-amber-600 dark:text-slate-100 dark:group-hover:text-amber-400 line-clamp-2 leading-snug">
                          {item.title}
                        </h4>
                      </div>
                      {item.desc && (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                          {item.desc}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Footer info & action */}
                  <div className="mt-1.5 flex items-center justify-between border-t border-slate-50 pt-2 text-[11px] text-slate-400 dark:border-slate-800">
                    <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap shrink-0">
                      {item.heat && `🔥 ${item.heat}`}
                    </span>
                    <div className="flex items-center gap-2">
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={12} />
                          原文
                        </a>
                      )}
                      <button
                        onClick={() => handlePick(item)}
                        className="flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 hover:bg-amber-100 transition dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
                      >
                        <MessageSquare size={12} />
                        {mode === 'space' ? '发起群聊' : '就聊这个'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-2 sm:px-6 sm:py-2.5 text-[11px] text-slate-400 dark:border-slate-800 dark:bg-slate-900/50">
          <span>💡 数据每 15 分钟自动更新，点击「就聊这个」直接注入上下文</span>
          <a
            href="/trending"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-bold text-amber-600 hover:text-amber-700 hover:underline dark:text-amber-400"
          >
            <span>在新窗口打开全网热榜大厅</span>
            <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </div>
  );
}
