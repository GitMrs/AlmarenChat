'use client';

import React, { useState, useEffect } from 'react';
import { Flame, RefreshCw, ExternalLink, MessageSquare, X, Star, Clock } from 'lucide-react';

interface HotItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  url: string;
  heat?: string;
  desc?: string;
  thumbnail?: string;
  category?: string;
  publishTime?: string;
  extra?: Record<string, any>;
}

interface FavoriteItem {
  id: string;
  userId: string;
  source: string;
  sourceName: string;
  itemId: string;
  title: string;
  url: string;
  heat?: string | null;
  desc?: string | null;
  category?: string | null;
  date?: string | null;
  publishTime?: string | null;
  extra?: Record<string, any>;
  createdAt: string;
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

function formatSourceTime(publishTime?: string | number | null, extra?: Record<string, any>): string {
  const raw = publishTime || extra?.timestamp || extra?.created || extra?.pubDate || extra?.pTime;
  if (!raw) return '';

  let date: Date;
  if (typeof raw === 'number') {
    const ms = raw < 1e11 ? raw * 1000 : raw;
    date = new Date(ms);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      const ms = num < 1e11 ? num * 1000 : num;
      date = new Date(ms);
    } else {
      date = new Date(trimmed);
    }
  } else {
    return '';
  }

  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec >= 0 && diffSec < 60) return '刚刚';
  if (diffMin >= 1 && diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24 && now.getDate() === date.getDate() && now.getMonth() === date.getMonth()) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    yesterday.getDate() === date.getDate() &&
    yesterday.getMonth() === date.getMonth() &&
    yesterday.getFullYear() === date.getFullYear()
  ) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `昨天 ${hh}:${mm}`;
  }

  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (now.getFullYear() === date.getFullYear()) {
    return `${m}-${d} ${hh}:${mm}`;
  }

  return `${date.getFullYear()}-${m}-${d}`;
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
    { id: 'crypto', name: '加密Web3', icon: '🪙' },
  ]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeSource, setActiveSource] = useState<string>('zhihu');
  const [items, setItems] = useState<HotItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // 收藏状态
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [favoritesList, setFavoritesList] = useState<FavoriteItem[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState<boolean>(false);

  // 1. 加载收藏列表
  const loadFavorites = async () => {
    setFavoritesLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/trending/favorites', { headers });
      const json = await res.json();
      if (json.success && Array.isArray(json.favorites)) {
        setFavoritesList(json.favorites);
        setFavoriteKeys(new Set(json.favoriteKeys || []));
      }
    } catch (err) {
      console.warn('[TrendingTopicPicker] Failed to load favorites:', err);
    } finally {
      setFavoritesLoading(false);
    }
  };

  // 2. 切换收藏状态
  const toggleFavorite = async (
    item: HotItem,
    sourceInfo: { source: string; sourceName: string; category?: string }
  ) => {
    const itemId = item.id || item.title;
    const key = `${sourceInfo.source}:${itemId}`;
    const isAlreadyFav = favoriteKeys.has(key);

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // 乐观更新
    setFavoriteKeys((prev) => {
      const next = new Set(prev);
      if (isAlreadyFav) next.delete(key);
      else next.add(key);
      return next;
    });

    if (isAlreadyFav) {
      setFavoritesList((prev) => prev.filter((f) => !(f.source === sourceInfo.source && f.itemId === itemId)));
      try {
        await fetch(
          `/api/trending/favorites?source=${encodeURIComponent(sourceInfo.source)}&itemId=${encodeURIComponent(itemId)}`,
          { method: 'DELETE', headers }
        );
      } catch {
        loadFavorites();
      }
    } else {
      try {
        const res = await fetch('/api/trending/favorites', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source: sourceInfo.source,
            sourceName: sourceInfo.sourceName,
            itemId,
            title: item.title,
            url: item.url,
            heat: item.heat,
            desc: item.desc,
            category: sourceInfo.category,
            publishTime: item.publishTime,
          }),
        });
        const json = await res.json();
        if (json.success && json.favorite) {
          setFavoritesList((prev) => [json.favorite, ...prev.filter((f) => f.id !== json.favorite.id)]);
        }
      } catch {
        loadFavorites();
      }
    }
  };

  // 3. 加载可用数据源列表与分类
  useEffect(() => {
    if (!isOpen) return;
    loadFavorites();
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

  // 4. 加载当前选中的热榜数据
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
    if (isOpen && activeSource && activeCategory !== 'favorites') {
      loadTrendingData(activeSource);
    }
  }, [isOpen, activeSource, activeCategory]);

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
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                今日实时热榜灵感
              </h2>
              <p className="hidden sm:block text-xs text-slate-400">
                一键将全网真实热点投喂给 Agent 或空间展开讨论
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href="/trending"
              target="_blank"
              rel="noopener noreferrer"
              title="在新窗口打开完整全网热榜大厅"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            >
              <ExternalLink size={16} />
            </a>
            {activeCategory !== 'favorites' && (
              <button
                onClick={() => loadTrendingData(activeSource, true)}
                disabled={refreshing || loading}
                title="强制刷新最新数据"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
              >
                <RefreshCw size={15} className={refreshing ? 'animate-spin text-amber-500' : ''} />
              </button>
            )}
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Category Filter Pills (包含 ⭐ 我的收藏) */}
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

          {/* ⭐ 我的收藏 Tab */}
          <button
            onClick={() => {
              setActiveCategory('favorites');
              loadFavorites();
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-bold transition ${
              activeCategory === 'favorites'
                ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                : 'bg-white/80 text-slate-600 hover:bg-white dark:bg-slate-800/80 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Star
              size={12}
              className={activeCategory === 'favorites' ? 'fill-white text-white' : 'text-amber-500 fill-amber-500'}
            />
            <span>我的收藏</span>
            {favoritesList.length > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                  activeCategory === 'favorites'
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
                }`}
              >
                {favoritesList.length}
              </span>
            )}
          </button>
        </div>

        {/* Source Tabs or Favorites Bar */}
        {activeCategory === 'favorites' ? (
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-2.5 dark:border-slate-800 bg-amber-50/40 dark:bg-amber-950/20 text-xs">
            <span className="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <Star size={13} className="fill-amber-500 text-amber-500" />
              <span>已收藏的热点 ({favoritesList.length})</span>
            </span>
            <span className="text-[11px] text-slate-400">点击「就聊这个」直接以此热点展开对话</span>
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-6 py-2.5 dark:border-slate-800 scrollbar-none bg-white dark:bg-slate-900">
            {((activeCategory === 'all' ? sources : sources.filter((s) => s.category === activeCategory)).length > 0
              ? activeCategory === 'all'
                ? sources
                : sources.filter((s) => s.category === activeCategory)
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
        )}

        {/* Content list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {activeCategory === 'favorites' ? (
            /* Favorites List */
            favoritesLoading ? (
              <div className="flex h-48 flex-col items-center justify-center gap-3 text-slate-400">
                <RefreshCw size={24} className="animate-spin text-amber-500" />
                <span className="text-xs font-medium">正在读取收藏夹...</span>
              </div>
            ) : favoritesList.length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-center text-slate-400">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-500 dark:bg-amber-950/40">
                  <Star size={24} className="fill-amber-500/20 text-amber-500" />
                </div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">暂无收藏的热搜灵感</p>
                <p className="text-[11px] text-slate-400 max-w-xs">
                  在浏览各大分类热榜时，点击每条热点右侧的 ⭐ 收藏，即可在此随时唤起讨论
                </p>
              </div>
            ) : (
              favoritesList.map((fav, idx) => {
                const hotItem: HotItem = {
                  id: fav.itemId,
                  source: fav.source,
                  sourceName: fav.sourceName,
                  title: fav.title,
                  url: fav.url,
                  heat: fav.heat || undefined,
                  desc: fav.desc || undefined,
                  category: fav.category || undefined,
                  publishTime: fav.publishTime || undefined,
                  extra: fav.extra,
                };
                const timeStr = formatSourceTime(fav.publishTime, fav.extra);

                return (
                  <div
                    key={fav.id || `${fav.source}:${fav.itemId}`}
                    className="group relative flex flex-col gap-1.5 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm transition hover:border-amber-200 hover:shadow-md dark:border-slate-800/80 dark:bg-slate-800/60 dark:hover:border-amber-500/30"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-[11px] font-black text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            {fav.sourceName || fav.source}
                          </span>
                          <h4 className="text-sm font-bold text-slate-900 group-hover:text-amber-600 dark:text-slate-100 dark:group-hover:text-amber-400 line-clamp-2 leading-snug">
                            {fav.title}
                          </h4>
                        </div>
                        {fav.desc && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                            {fav.desc}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Footer info & action */}
                    <div className="mt-1.5 flex items-center justify-between border-t border-slate-50 pt-2 text-[11px] text-slate-400 dark:border-slate-800">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        {fav.heat && (
                          <span className="font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap shrink-0">
                            🔥 {fav.heat}
                          </span>
                        )}
                        {timeStr && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0"
                            title={`发布时间：${fav.publishTime || timeStr}`}
                          >
                            <Clock size={10} className="opacity-70" />
                            {timeStr}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {fav.url && (
                          <a
                            href={fav.url}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(hotItem, {
                              source: fav.source,
                              sourceName: fav.sourceName,
                              category: fav.category || undefined,
                            });
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition dark:bg-amber-900/60 dark:text-amber-300"
                          title="取消收藏"
                        >
                          <Star size={12} className="fill-amber-500 text-amber-500" />
                        </button>
                        <button
                          onClick={() => handlePick(hotItem)}
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
            )
          ) : (
            /* Regular Trending List */
            <>
              {refreshing && (
                <div className="flex items-center justify-center gap-2 rounded-xl bg-amber-500/10 py-2.5 text-xs font-bold text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 animate-in fade-in">
                  <RefreshCw size={12} className="animate-spin text-amber-500" />
                  <span>正在获取最新实时热榜数据...</span>
                </div>
              )}
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
                  const itemKey = `${item.source || activeSource}:${item.id || item.title}`;
                  const isFav = favoriteKeys.has(itemKey);
                  const timeStr = formatSourceTime(item.publishTime, item.extra);

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
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          {item.heat && (
                            <span className="font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap shrink-0">
                              🔥 {item.heat}
                            </span>
                          )}
                          {timeStr && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0"
                              title={`发布时间：${item.publishTime || timeStr}`}
                            >
                              <Clock size={10} className="opacity-70" />
                              {timeStr}
                            </span>
                          )}
                        </div>
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
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(item, {
                                source: item.source || activeSource,
                                sourceName:
                                  item.sourceName ||
                                  sources.find((s) => s.id === activeSource)?.name ||
                                  activeSource,
                                category: activeCategory !== 'all' ? activeCategory : undefined,
                              });
                            }}
                            className={`flex h-6 w-6 items-center justify-center rounded-lg transition ${
                              isFav
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600'
                            }`}
                            title={isFav ? '取消收藏' : '收藏此热点'}
                          >
                            <Star size={12} className={isFav ? 'fill-amber-500 text-amber-500' : ''} />
                          </button>
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
            </>
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
