'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  Clock3,
  Compass,
  Flame,
  Heart,
  MessageCircle,
  Search,
  Skull,
  Sparkles,
  Swords,
  Trophy,
  WandSparkles,
} from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import AgentCard from '@/components/agent/AgentCard';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getAgentsGroupedByCategory, getBuiltInAgents } from '@/lib/agents-data';
import { agents as agentsApi, conversations as conversationsApi, favorites as favoritesApi } from '@/lib/api';
import type { Agent } from '@/types';

const genreLinks = [
  { label: '悬疑推理', description: '调查现场，审问嫌疑人，拼出真相。', icon: Search, href: '/agents?category=悬疑推理', color: '#5b5bd6' },
  { label: '浪漫言情', description: '在关系与选择里写出你的心动章节。', icon: Heart, href: '/agents?category=浪漫言情', color: '#d94e73' },
  { label: '奇幻冒险', description: '踏入王国、遗迹和未知边境。', icon: Swords, href: '/agents?category=奇幻冒险', color: '#6657d8' },
  { label: '恐怖惊悚', description: '保持冷静，别让黑暗先找到你。', icon: Skull, href: '/agents?category=恐怖惊悚', color: '#19172a' },
];

const playStyles = [
  { label: '破解谜案', note: '线索、嫌疑人、反转结局', icon: Search },
  { label: '扮演角色', note: '选择身份，进入关系网', icon: MessageCircle },
  { label: '探索世界', note: '场景、任务、隐藏事件', icon: Compass },
  { label: '短篇冒险', note: '十分钟开启一段故事', icon: Clock3 },
];

const storyMoments = [
  { title: '先看世界观', text: '快速判断这是不是你今晚想进入的气氛。', icon: BookOpen },
  { title: '再选身份', text: '玩家角色会影响 AI 推进故事的方式。', icon: WandSparkles },
  { title: '最后开局', text: '从第一幕直接进入互动，不绕路。', icon: Trophy },
];

function getAgentSource(agent: Agent): 'builtin' | 'custom' {
  return agent.creatorId ? 'custom' : 'builtin';
}

function getFavoriteKey(agent: Agent) {
  return `${getAgentSource(agent)}:${agent.id}`;
}

function getCategoryAgents(grouped: Record<string, Agent[]>, category: string, count: number) {
  return (grouped[category] || []).slice(0, count);
}

function getHeroLine(agent?: Agent) {
  if (!agent) return '选择一个世界，让故事开始回应你。';
  return agent.hook || agent.openingScene || agent.greeting || agent.description || '一个正在等待玩家进入的互动故事世界。';
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

    if (token) {
      conversationsApi
        .list()
        .then((result) => setRecentConversations(result.conversations.slice(0, 3)))
        .catch(() => {});
    }
  }, []);

  const grouped = useMemo(() => getAgentsGroupedByCategory(agents), [agents]);
  const categories = Object.keys(grouped);
  const mysteryWorlds = getCategoryAgents(grouped, '悬疑推理', 2);
  const romanceWorlds = getCategoryAgents(grouped, '浪漫言情', 2);
  const fantasyWorlds = getCategoryAgents(grouped, '奇幻冒险', 2);
  const trendingWorlds = categories.slice(0, 5).flatMap((category) => grouped[category]?.slice(0, 1) || []);
  const heroWorld = mysteryWorlds[0] || fantasyWorlds[0] || romanceWorlds[0] || trendingWorlds[0] || agents[0];
  const heroLine = getHeroLine(heroWorld);

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

  return (
    <AppShell>
      <div className="-mx-4 bg-[#19172a] px-4 pb-12 pt-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <section className="relative overflow-hidden rounded-[34px] bg-[#19172a] p-5 text-white shadow-xl sm:p-8 lg:grid lg:min-h-[560px] lg:grid-cols-[1fr_430px] lg:gap-8 lg:p-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(216,144,34,0.28),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(102,87,216,0.28),transparent_26%),linear-gradient(135deg,#19172a,#242039_55%,#141322)]" />

            <div className="relative z-10 flex flex-col justify-between gap-10">
              <div className="space-y-7">
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/12 bg-white/10 px-4 py-2 text-sm font-bold text-white/82 backdrop-blur">
                  <Sparkles size={16} className="text-[#d89022]" />
                  AI 互动故事大厅
                </div>

                <div className="max-w-3xl space-y-5">
                  <h1 className="text-5xl font-black leading-[1.04] sm:text-6xl lg:text-7xl">
                    今晚，进入一个会回应你的故事。
                  </h1>
                  <p className="max-w-2xl text-base leading-8 text-white/68 sm:text-lg">
                    推理、扮演、冒险和关系选择都由 AI 即时推进。你不是旁观者，你是每个世界的变量。
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => (heroWorld ? handleChat(heroWorld) : router.push('/agents'))}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-[#19172a] shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    开始一段故事
                    <ArrowRight size={17} />
                  </button>
                  <button
                    onClick={() => router.push('/create-agent')}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/14 bg-white/10 px-6 py-3 text-sm font-black text-white shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/16"
                  >
                    <BookOpen size={17} />
                    创作世界
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                {playStyles.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      onClick={() => router.push('/agents')}
                      className="rounded-2xl border border-white/10 bg-white/[0.08] p-4 text-left backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/[0.12]"
                    >
                      <Icon size={18} className="text-[#d89022]" />
                      <p className="mt-3 text-sm font-black text-white">{item.label}</p>
                      <p className="mt-1 text-xs leading-5 text-white/52">{item.note}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="relative z-10 mt-8 lg:mt-0">
              <div className="flex h-full flex-col overflow-hidden rounded-[30px] border border-white/12 bg-white/[0.08] text-white shadow-2xl backdrop-blur">
                <div className="border-b border-white/10 bg-white/[0.06] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-white/42">Tonight's World</p>
                      <h2 className="mt-1 text-2xl font-black">今日主推世界</h2>
                    </div>
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-[#d89022] shadow-sm">
                      <Flame size={22} />
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div className="flex min-h-[420px] items-center justify-center">
                    <LoadingSpinner size="lg" />
                  </div>
                ) : heroWorld ? (
                  <div className="flex min-h-[430px] flex-1 flex-col p-5">
                    <button
                      onClick={() => handleViewAgent(heroWorld)}
                      className="group overflow-hidden rounded-[26px] border border-white/10 bg-[#19172a] p-4 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg sm:p-5"
                    >
                      <div className="flex items-center gap-3 rounded-[22px] bg-white/[0.08] p-3 text-white">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-3xl">
                          {heroWorld.avatar || '🎭'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#d89022]">Picked World</p>
                          <p className="mt-1 truncate text-sm font-black text-white">{heroWorld.category || '故事世界'}</p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-black text-white/72">今日</span>
                      </div>
                      <h3 className="mt-6 line-clamp-2 text-3xl font-black leading-tight text-white transition group-hover:text-[#f2c27b]">
                        {heroWorld.name}
                      </h3>
                      <p className="mt-4 line-clamp-4 text-sm leading-7 text-white/62">{heroLine}</p>
                    </button>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      {[
                        ['时长', heroWorld.estimatedDuration || '10-20 分钟'],
                        ['难度', heroWorld.difficulty ? String(heroWorld.difficulty) : '普通'],
                        ['人数', heroWorld.playerCount || '单人'],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.08] px-3 py-3 shadow-sm">
                          <p className="text-xs font-bold text-white/40">{label}</p>
                          <p className="mt-1 truncate text-sm font-black text-white">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.08] p-4">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/40">Opening Scene</p>
                      <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/64">
                        {heroWorld.openingScene || heroWorld.worldSetting || heroWorld.description || '你站在故事的入口，下一句话会决定世界如何回应。'}
                      </p>
                    </div>

                    <div className="mt-auto grid gap-2 pt-4 sm:grid-cols-[1fr_auto]">
                      <button
                        onClick={() => handleChat(heroWorld)}
                        className="flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-[#19172a] transition hover:-translate-y-0.5 hover:shadow-lg"
                      >
                        进入世界
                        <ArrowRight size={16} />
                      </button>
                      <button
                        onClick={() => handleViewAgent(heroWorld)}
                        className="rounded-full border border-white/12 bg-white/10 px-5 py-3 text-sm font-black text-white transition hover:bg-white/16"
                      >
                        查看详情
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[420px] items-center justify-center p-5">
                    <div className="flex h-full min-h-[320px] w-full items-center justify-center rounded-[24px] border border-dashed border-white/18 text-sm font-bold text-white/42">
                      暂无可进入的故事
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="mt-10 space-y-10 rounded-t-[36px] bg-white/[0.045]  px-4 pb-4 pt-8 text-white shadow-[0_-18px_60px_rgba(0,0,0,0.18)] sm:px-6 lg:px-8">
            <section className="rounded-[32px] border border-white/10 bg-[#19172a]  p-5 shadow-sm backdrop-blur sm:p-6">
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-black text-[#d89022]">Choose A Mood</p>
                  <h2 className="mt-1 text-2xl font-black text-white">今晚想进入哪种故事？</h2>
                </div>
                <button
                  onClick={() => router.push('/agents')}
                  className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-[#19172a] transition hover:-translate-y-0.5"
                >
                  探索全部
                  <ArrowRight size={15} />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {genreLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      onClick={() => router.push(item.href)}
                    className="group relative overflow-hidden rounded-[24px] border border-white/10 bg-[#242039] p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-[#2d2844] hover:shadow-lg"
                  >
                      <div className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: item.color }} />
                      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl text-white transition group-hover:scale-105" style={{ backgroundColor: item.color }}>
                        <Icon size={20} />
                      </div>
                      <h3 className="text-lg font-black text-white">{item.label}</h3>
                      <p className="mt-2 text-sm leading-6 text-white/54">{item.description}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[32px] bg-[#19172a] p-5 text-white shadow-sm sm:p-6">
              <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
                <div>
                  <p className="text-sm font-black text-[#d89022]">Play Flow</p>
                  <h2 className="mt-2 text-3xl font-black">从灵感到开局，只保留关键一步。</h2>
                  <p className="mt-4 text-sm leading-7 text-white/58">
                    首页不再堆满 Agent，而是帮用户快速判断：想玩什么、进入哪个世界、要不要继续上次的故事。
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {storyMoments.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.title} className="rounded-[24px] border border-white/10 bg-white/[0.08] p-5">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-[#d89022]">
                          <Icon size={18} />
                        </div>
                        <h3 className="mt-4 text-base font-black text-white">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-white/54">{item.text}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {isLoggedIn && recentConversations.length > 0 && (
              <section className="rounded-[32px] bg-[#19172a] p-5 text-white shadow-sm sm:p-6">
                <div className="mb-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-[#d89022]">Continue Playing</p>
                    <h2 className="text-2xl font-black text-white">上次未完成的故事</h2>
                  </div>
                  <button
                    onClick={() => router.push('/conversations')}
                    className="hidden items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm sm:flex"
                  >
                    查看全部
                    <ArrowRight size={15} />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {recentConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      onClick={() => router.push(`/conversations/${conversation.id}`)}
                      className="group flex min-w-0 items-center gap-4 rounded-[24px] border border-white/10 bg-white/[0.08] p-4 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.12]"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-2xl">
                        {conversation.agentAvatar || '🎭'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-white">
                          {conversation.agentName || '未知世界'}
                        </div>
                        <div className="mt-1 line-clamp-2 break-words text-xs leading-5 text-white/54">
                          {conversation.title || '继续冒险'}
                        </div>
                      </div>
                      <ArrowRight size={16} className="shrink-0 text-white/30 transition group-hover:translate-x-1 group-hover:text-white" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-[32px] bg-[#19172a] p-5 text-[#17151f] shadow-sm sm:p-6">
              <div className="mb-5 flex items-end justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-[#d89022]">Featured</p>
                  <h2 className="text-2xl font-black text-white">正在流行的故事世界</h2>
                </div>
                <button
                  onClick={() => router.push('/agents')}
                  className="hidden items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm sm:flex"
                >
                  探索全部
                  <ArrowRight size={15} />
                </button>
              </div>

              {loading ? (
                <div className="flex justify-center py-16">
                  <LoadingSpinner size="lg" />
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-4">
                  {trendingWorlds.slice(0, 4).map((agent) => (
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

            {(mysteryWorlds.length > 0 || fantasyWorlds.length > 0 || romanceWorlds.length > 0) && (
            <section className="grid gap-6 rounded-[32px]bg-[#19172a] p-5 text-[#17151f] shadow-sm sm:p-6 lg:grid-cols-3">
                {[
                  ['悬疑案件', '破解谜案，寻找真相', mysteryWorlds, '/agents?category=悬疑推理'],
                  ['奇幻冒险', '踏入未知的世界', fantasyWorlds, '/agents?category=奇幻冒险'],
                  ['浪漫篇章', '让关系决定故事走向', romanceWorlds, '/agents?category=浪漫言情'],
                ].map(([title, subtitle, list, href]) => {
                  const items = list as Agent[];
                  if (items.length === 0) return null;

                  return (
                    <div key={title as string} className="rounded-[28px] border border-white/10 bg-white/[0.08] p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-white/54">{title as string}</p>
                          <h3 className="text-xl font-black text-white">{subtitle as string}</h3>
                        </div>
                        <button
                          onClick={() => router.push(href as string)}
                          className="shrink-0 rounded-full bg-white/10 p-2 text-white/30 transition hover:text-white"
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                      <div className="space-y-3">
                        {items.map((agent) => (
                          <AgentCard key={agent.id} agent={agent} onChat={handleChat} variant="compact" />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
