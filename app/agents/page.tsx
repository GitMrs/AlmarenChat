'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Globe, Search, SlidersHorizontal } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import AgentCard from '@/components/agent/AgentCard';
import CategoryFilter from '@/components/agent/CategoryFilter';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getAgentsByCategory, getBuiltInAgents, searchAgents } from '@/lib/agents-data';
import { agents as agentsApi, favorites as favoritesApi } from '@/lib/api';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { cn } from '@/lib/utils';
import type { Agent } from '@/types';

const AGENTS_PAGE_STATE_KEY = 'almaren:agents-page-state';

type AgentsPageState = {
  category?: string;
  searchQuery?: string;
  scrollY?: number;
  displayCount?: number;
};

function readAgentsPageState(): AgentsPageState {
  if (typeof window === 'undefined') return {};

  try {
    return JSON.parse(sessionStorage.getItem(AGENTS_PAGE_STATE_KEY) || '{}');
  } catch {
    return {};
  }
}

function getAgentSource(agent: Agent): 'builtin' | 'custom' {
  return agent.creatorId ? 'custom' : 'builtin';
}

function getFavoriteKey(agent: Agent) {
  return `${getAgentSource(agent)}:${agent.id}`;
}

function AgentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const restoredState = useMemo(() => readAgentsPageState(), []);
  const urlCategory = searchParams.get('category');
  const shouldUseRestoredState = !urlCategory || urlCategory === restoredState.category;
  const initialCategory = urlCategory || restoredState.category || '全部';
  const restoredScrollY = shouldUseRestoredState ? restoredState.scrollY || 0 : 0;
  const hasRestoredScrollRef = useRef(false);
  const pageStateRef = useRef<AgentsPageState>({});

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(shouldUseRestoredState ? restoredState.searchQuery || '' : '');
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [initialDisplayCount, setInitialDisplayCount] = useState(
    shouldUseRestoredState ? restoredState.displayCount || 18 : 18
  );
  const [showFloatingTools, setShowFloatingTools] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsLoggedIn(Boolean(token));

    Promise.all([
      getBuiltInAgents(),
      token ? agentsApi.list().catch(() => ({ agents: [] })) : Promise.resolve({ agents: [] }),
      token ? favoritesApi.list().catch(() => ({ favorites: [] })) : Promise.resolve({ favorites: [] }),
    ]).then(([builtInAgents, publicAgentsResult, favoritesResult]) => {
      setAgents([...publicAgentsResult.agents, ...builtInAgents]);
      setFavorites(new Set(favoritesResult.favorites.map((favorite: any) => `${favorite.source || 'custom'}:${favorite.agentId}`)));
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => getAgentsByCategory(agents, selectedCategory), [agents, selectedCategory]);
  const results = useMemo(
    () => (searchQuery ? searchAgents(filtered, searchQuery) : filtered),
    [filtered, searchQuery]
  );
  const { displayed, displayCount, hasMore, loading: loadingMore, sentinelRef } = useInfiniteScroll({
    items: results,
    pageSize: 18,
    initialDisplayCount,
  });

  const savePageState = (nextState: Partial<AgentsPageState> = {}) => {
    sessionStorage.setItem(
      AGENTS_PAGE_STATE_KEY,
      JSON.stringify({
        category: selectedCategory,
        searchQuery,
        scrollY: window.scrollY,
        displayCount,
        ...nextState,
      })
    );
  };

  useEffect(() => {
    pageStateRef.current = {
      category: selectedCategory,
      searchQuery,
      displayCount,
    };
  }, [displayCount, searchQuery, selectedCategory]);

  useEffect(() => {
    const saveCurrentPageState = () => {
      const current = pageStateRef.current;
      sessionStorage.setItem(
        AGENTS_PAGE_STATE_KEY,
        JSON.stringify({
          category: current.category || '全部',
          searchQuery: current.searchQuery || '',
          scrollY: window.scrollY,
          displayCount: current.displayCount || 18,
        })
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveCurrentPageState();
    };

    window.addEventListener('pagehide', saveCurrentPageState);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      saveCurrentPageState();
      window.removeEventListener('pagehide', saveCurrentPageState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleChat = (agent: Agent) => {
    savePageState();
    router.push(`/chat/${agent.id}`);
  };

  const handleView = (agent: Agent) => {
    savePageState();
    router.push(`/agents/${agent.id}`);
  };

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category);
    setInitialDisplayCount(18);
    savePageState({ category, scrollY: 0, displayCount: 18 });
    router.replace(category === '全部' ? '/agents' : `/agents?category=${encodeURIComponent(category)}`, { scroll: false });
    window.scrollTo({ top: 0 });
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setInitialDisplayCount(18);
    savePageState({ searchQuery: value, scrollY: 0, displayCount: 18 });
  };

  useEffect(() => {
    if (loading || hasRestoredScrollRef.current || !restoredScrollY) return;
    if (displayed.length < Math.min(restoredState.displayCount || 18, results.length)) return;

    hasRestoredScrollRef.current = true;
    window.setTimeout(() => {
      window.scrollTo({ top: restoredScrollY, behavior: 'auto' });
    }, 0);
  }, [displayed.length, loading, restoredScrollY, restoredState.displayCount, results.length]);

  useEffect(() => {
    const handleScroll = () => {
      setShowFloatingTools(window.scrollY > 360);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleFavorite = async (agent: Agent) => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }

    const nextFavorites = new Set(favorites);
    const source = getAgentSource(agent);
    const favoriteKey = getFavoriteKey(agent);
    const liked = nextFavorites.has(favoriteKey);
    if (liked) {
      nextFavorites.delete(favoriteKey);
      setFavorites(nextFavorites);
      await favoritesApi.remove(agent.id, source).catch(() => setFavorites(favorites));
      return;
    }

    nextFavorites.add(favoriteKey);
    setFavorites(nextFavorites);
    await favoritesApi.add(agent.id, source).catch(() => setFavorites(favorites));
  };

  const renderSearchInput = (compact = false) => (
    <div className="relative">
      <Search size={compact ? 16 : 19} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
      <input
        type="text"
        placeholder="搜索世界名称、类型或标签..."
        value={searchQuery}
        onChange={(event) => handleSearchChange(event.target.value)}
        className={cn(
          'w-full rounded-full border border-white/10 bg-white/[0.08] font-medium text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]',
          compact ? 'h-10 pl-10 pr-4 text-xs' : 'h-14 pl-13 pr-5 text-sm'
        )}
      />
    </div>
  );

  return (
    <div className="space-y-8 py-8">
      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 top-16 z-30 px-4 transition-all duration-200 sm:px-6 lg:px-8',
          showFloatingTools ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'
        )}
      >
        <div className="pointer-events-auto mx-auto max-w-7xl rounded-b-[28px] border-x border-b border-white/10 bg-[#19172a]/94 p-3 shadow-lg backdrop-blur-xl">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,360px)_minmax(0,1fr)_auto] lg:items-center">
            {renderSearchInput(true)}
            <CategoryFilter selected={selectedCategory} onSelect={handleCategorySelect} className="pb-0" />
            <div className="hidden whitespace-nowrap rounded-full bg-white/[0.08] px-3 py-2 text-xs font-black text-white/50 lg:block">
              共 {results.length} 个世界
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-[32px] border border-white/10 bg-[#19172a] p-5 shadow-sm backdrop-blur sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/82 backdrop-blur">
              <Globe size={16} className="text-[#d89022]" />
              故事广场
            </div>
            <h1 className="text-3xl font-black leading-tight text-white sm:text-4xl">
              发现一个你想进入的故事世界。
            </h1>
            <p className="mt-3 text-base leading-7 text-white/58">
              从悬疑推理到奇幻冒险，选择一个世界，开始你的故事。
            </p>
          </div>

          <div className="min-w-0 flex-1 lg:max-w-xl">
            {renderSearchInput()}
          </div>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5">
          <CategoryFilter selected={selectedCategory} onSelect={handleCategorySelect} />
        </div>
      </section>

      <section className="space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-[#d89022]">探索世界</p>
                <h2 className="text-2xl font-black text-white">
                  {selectedCategory === '全部' ? '全部世界' : selectedCategory}
                </h2>
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/50 shadow-sm">
                <SlidersHorizontal size={15} />
                共 {results.length} 个世界
                {displayed.length < results.length && <span className="text-white/30">已显示 {displayed.length}</span>}
              </div>
            </div>

            {displayed.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {displayed.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onChat={handleChat}
                    onView={handleView}
                    onFavorite={handleFavorite}
                    isFavorited={favorites.has(getFavoriteKey(agent))}
                    showFavorite
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-white/18 bg-white/[0.04] p-14 text-center">
                <p className="text-sm font-medium text-white/42">没有找到匹配的世界</p>
              </div>
            )}

            <div ref={sentinelRef} className="h-4" />
            {loadingMore && (
              <div className="flex justify-center py-6">
                <LoadingSpinner size="md" />
              </div>
            )}
            {!hasMore && displayed.length > 0 && (
              <p className="py-6 text-center text-xs font-semibold text-white/40">已加载全部世界</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="flex items-center justify-center py-24"><LoadingSpinner size="lg" /></div>}>
        <AgentsContent />
      </Suspense>
    </AppShell>
  );
}
