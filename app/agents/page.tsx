'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, Search, SlidersHorizontal } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import AgentCard from '@/components/agent/AgentCard';
import CategoryFilter from '@/components/agent/CategoryFilter';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getAgentsByCategory, getBuiltInAgents, searchAgents } from '@/lib/agents-data';
import { agents as agentsApi, favorites as favoritesApi } from '@/lib/api';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import type { Agent } from '@/types';

function AgentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get('category') || '全部';

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsLoggedIn(Boolean(token));

    Promise.all([
      getBuiltInAgents(),
      token ? agentsApi.list().catch(() => ({ agents: [] })) : Promise.resolve({ agents: [] }),
      token ? favoritesApi.list().catch(() => ({ favorites: [] })) : Promise.resolve({ favorites: [] }),
    ]).then(([builtInAgents, publicAgentsResult, favoritesResult]) => {
      setAgents([...publicAgentsResult.agents, ...builtInAgents]);
      setFavorites(new Set(favoritesResult.favorites.map((favorite: any) => favorite.agentId)));
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => getAgentsByCategory(agents, selectedCategory), [agents, selectedCategory]);
  const results = useMemo(
    () => (searchQuery ? searchAgents(filtered, searchQuery) : filtered),
    [filtered, searchQuery]
  );
  const { displayed, hasMore, loading: loadingMore, sentinelRef } = useInfiniteScroll({
    items: results,
    pageSize: 18,
  });

  const handleChat = (agent: Agent) => {
    router.push(`/chat/${agent.id}`);
  };

  const handleFavorite = async (agent: Agent) => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }

    const nextFavorites = new Set(favorites);
    const liked = nextFavorites.has(agent.id);
    if (liked) {
      nextFavorites.delete(agent.id);
      setFavorites(nextFavorites);
      await favoritesApi.remove(agent.id).catch(() => setFavorites(favorites));
      return;
    }

    nextFavorites.add(agent.id);
    setFavorites(nextFavorites);
    await favoritesApi.add(agent.id).catch(() => setFavorites(favorites));
  };

  return (
    <div className="space-y-8 py-8">
      <section className="rounded-[32px] border border-black/[0.06] bg-white/82 p-5 shadow-sm backdrop-blur sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
              <Bot size={16} />
              Agent 广场
            </div>
            <h1 className="text-3xl font-black leading-tight text-slate-950 sm:text-4xl">
              找一个适合此刻任务的 AI 搭档。
            </h1>
            <p className="mt-3 text-base leading-7 text-slate-500">
              按用途浏览 Agent 身份卡，从写作、编程、学习到生活灵感，直接进入对话。
            </p>
          </div>

          <div className="min-w-0 flex-1 lg:max-w-xl">
            <div className="relative">
              <Search size={19} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索 Agent 名称、能力或分类..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-14 w-full rounded-full border border-black/[0.08] bg-[#fbfaf7] pl-13 pr-5 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-black/[0.06] pt-5">
          <CategoryFilter selected={selectedCategory} onSelect={setSelectedCategory} />
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
                <p className="text-sm font-bold text-slate-400">Browse Agents</p>
                <h2 className="text-2xl font-black text-slate-950">
                  {selectedCategory === '全部' ? '全部 Agent' : selectedCategory}
                </h2>
              </div>
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-500 shadow-sm">
                <SlidersHorizontal size={15} />
                共 {results.length} 个
                {displayed.length < results.length && <span className="text-slate-300">已显示 {displayed.length}</span>}
              </div>
            </div>

            {displayed.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {displayed.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onChat={handleChat}
                    onFavorite={handleFavorite}
                    isFavorited={favorites.has(agent.id)}
                    showFavorite={Boolean(agent.creatorId)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-14 text-center">
                <p className="text-sm font-medium text-slate-400">没有找到匹配的 Agent</p>
              </div>
            )}

            <div ref={sentinelRef} className="h-4" />
            {loadingMore && (
              <div className="flex justify-center py-6">
                <LoadingSpinner size="md" />
              </div>
            )}
            {!hasMore && displayed.length > 0 && (
              <p className="py-6 text-center text-xs font-semibold text-slate-400">已加载全部 Agent</p>
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
