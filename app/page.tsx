'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Bot, Code2, GraduationCap, HeartHandshake, MessageCircle, PenLine, Search, Sparkles } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import AgentCard from '@/components/agent/AgentCard';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getAgentsGroupedByCategory, getBuiltInAgents } from '@/lib/agents-data';
import { agents as agentsApi, conversations as conversationsApi, favorites as favoritesApi } from '@/lib/api';
import type { Agent } from '@/types';

const scenarioLinks = [
  { label: '写作', description: '文案、标题、改写', icon: PenLine, href: '/agents?category=写作', color: '#f59e0b' },
  { label: '编程', description: 'Debug、解释、方案', icon: Code2, href: '/agents?category=编程', color: '#2563eb' },
  { label: '学习', description: '讲解、总结、练习', icon: GraduationCap, href: '/agents?category=学习', color: '#10b981' },
  { label: '心理', description: '倾听、梳理、陪伴', icon: HeartHandshake, href: '/agents?category=心理', color: '#ec4899' },
];

function getAgentSource(agent: Agent): 'builtin' | 'custom' {
  return agent.creatorId ? 'custom' : 'builtin';
}

function getFavoriteKey(agent: Agent) {
  return `${getAgentSource(agent)}:${agent.id}`;
}

export default function HomePage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [recentConversations, setRecentConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsLoggedIn(!!token);

    Promise.all([
      getBuiltInAgents(),
      token ? agentsApi.list().catch(() => ({ agents: [] })) : Promise.resolve({ agents: [] }),
      token ? favoritesApi.list().catch(() => ({ favorites: [] })) : Promise.resolve({ favorites: [] }),
    ]).then(([builtInAgents, publicAgentsResult, favoritesResult]) => {
      setAgents([...publicAgentsResult.agents, ...builtInAgents]);
      setFavorites(new Set(favoritesResult.favorites.map((favorite: any) => `${favorite.source || 'custom'}:${favorite.agentId}`)));
      setLoading(false);
    });

    if (token) {
      conversationsApi.list({ limit: 3, includeLastMessage: false }).then((result) => {
        setRecentConversations(result.conversations);
      }).catch(() => {});
    }
  }, []);

  const grouped = getAgentsGroupedByCategory(agents);
  const categories = Object.keys(grouped);
  const livePicks = categories.slice(0, 3).flatMap((category) => grouped[category]?.slice(0, 1) || []);
  const featuredAgents = categories.slice(0, 4).flatMap((category) => grouped[category]?.slice(0, 1) || []);

  const handleChat = (agent: Agent) => {
    router.push(`/chat/${agent.id}`);
  };

  const handleViewAgent = (agent: Agent) => {
    router.push(`/agents/${agent.id}`);
  };

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

  const handleResumeConversation = (conversation: any) => {
    router.push(`/conversations/${conversation.id}`);
  };

  return (
    <AppShell>
      <div className="space-y-12 py-8">
        <section className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
          <div className="space-y-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
              <Sparkles size={16} className="text-amber-500" />
              面向个人用户的 AI Agent 宇宙
            </div>

            <div className="space-y-5">
              <h1 className="max-w-3xl text-5xl font-black leading-[1.06] text-slate-950 sm:text-6xl lg:text-7xl">
                今天，和一个真正懂你的 Agent 开始。
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-slate-600">
                首页负责帮你快速开始。想完整浏览、搜索和筛选 Agent，可以进入 Agent 广场。
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => router.push('/agents')}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                进入 Agent 广场
                <ArrowRight size={17} />
              </button>
              <button
                onClick={() => router.push('/create-agent')}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-black/[0.08] bg-white px-6 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <Bot size={17} />
                创建我的 Agent
              </button>
            </div>

            <button
              onClick={() => router.push('/agents')}
              className="flex h-14 w-full max-w-2xl items-center gap-3 rounded-full border border-black/[0.08] bg-white px-5 text-left text-sm font-medium text-slate-400 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <Search size={19} />
              搜索写作、编程、心理、学习 Agent...
            </button>
          </div>

          <div className="relative min-h-[500px]">
            <div className="absolute inset-0 rounded-[36px] bg-[linear-gradient(135deg,#fff7ed,#eef2ff_45%,#ecfdf5)]" />
            <div className="absolute left-6 right-12 top-6 rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-xl backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Live picks</p>
                  <h2 className="text-xl font-black text-slate-950">现在就能聊的 Agent</h2>
                </div>
                <MessageCircle className="text-slate-300" size={24} />
              </div>
              <div className="space-y-3">
                {loading ? (
                  <div className="flex justify-center py-20">
                    <LoadingSpinner size="lg" />
                  </div>
                ) : (
                  livePicks.map((agent) => (
                    <AgentCard key={agent.id} agent={agent} onChat={handleChat} variant="compact" />
                  ))
                )}
              </div>
            </div>

            <div className="absolute bottom-8 left-12 right-6 rounded-[32px] border border-black/[0.06] bg-white p-6 shadow-2xl">
              <p className="text-sm font-bold text-slate-400">Agent 创建器</p>
              <h3 className="mt-2 text-2xl font-black text-slate-950">把你的提示词变成一个可复用角色。</h3>
              <button
                onClick={() => router.push('/create-agent')}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white"
              >
                开始塑造
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-slate-400">Start by intent</p>
              <h2 className="text-2xl font-black text-slate-950">按今天的目标开始</h2>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {scenarioLinks.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => router.push(item.href)}
                  className="rounded-[28px] border border-black/[0.06] bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-white" style={{ backgroundColor: item.color }}>
                    <Icon size={20} />
                  </div>
                  <h3 className="text-lg font-black text-slate-950">{item.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {isLoggedIn && recentConversations.length > 0 && (
          <section>
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-400">Continue</p>
                <h2 className="text-2xl font-black text-slate-950">继续上次对话</h2>
              </div>
              <button
                onClick={() => router.push('/conversations')}
                className="hidden items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm sm:flex"
              >
                查看会话
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentConversations.map((conversation) => {
                return (
                  <button
                    key={conversation.id}
                    onClick={() => handleResumeConversation(conversation)}
                    className="group flex min-w-0 items-center gap-4 rounded-[28px] border border-black/[0.06] bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#fbfaf7] text-2xl">
                      {conversation.agentAvatar || '🤖'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-slate-950">
                        {conversation.agentName || '未知 Agent'}
                      </div>
                      <div className="mt-1 line-clamp-2 break-words text-xs leading-5 text-slate-500">{conversation.title || '继续对话'}</div>
                    </div>
                    <ArrowRight size={16} className="shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-950" />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-slate-400">Featured</p>
              <h2 className="text-2xl font-black text-slate-950">精选 Agent</h2>
            </div>
            <button
              onClick={() => router.push('/agents')}
              className="hidden items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm sm:flex"
            >
              去广场浏览全部
              <ArrowRight size={15} />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-4">
              {featuredAgents.slice(0, 4).map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onChat={handleChat}
                  onView={handleViewAgent}
                  onFavorite={handleFavorite}
                  isFavorited={favorites.has(getFavoriteKey(agent))}
                  showFavorite
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
