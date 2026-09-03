'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Bot,
  Code2,
  Compass,
  GraduationCap,
  HeartHandshake,
  MessageCircle,
  MessageCircleHeart,
  PanelsTopLeft,
  PenLine,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import AgentCard from '@/components/agent/AgentCard';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getAgentsGroupedByCategory, getBuiltInAgents } from '@/lib/agents-data';
import { agents as agentsApi, conversations as conversationsApi, favorites as favoritesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Agent } from '@/types';

const scenarioLinks = [
  { label: '写作与创作', description: '文案、故事、报告、润色改写', icon: PenLine, href: '/agents?category=写作', color: '#f59e0b' },
  { label: '编程与技术', description: 'Debug、架构解析、代码编写', icon: Code2, href: '/agents?category=编程', color: '#2563eb' },
  { label: '学习与进阶', description: '知识讲解、外语对话、考点梳理', icon: GraduationCap, href: '/agents?category=学习', color: '#10b981' },
  { label: '生活与倾听', description: '情绪疏导、作息建议、知心倾听', icon: HeartHandshake, href: '/agents?category=心理', color: '#ec4899' },
];

const hotKeywords = ['周报生成', 'Python 调试', '英语外教', '心理倾听', '商业计划', '文案润色'];

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
  const [searchQuery, setSearchQuery] = useState('');

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
  const featuredAgents = categories.slice(0, 4).flatMap((category) => grouped[category]?.slice(0, 1) || []);

  const handleSearchSubmit = (keyword?: string) => {
    const term = (keyword !== undefined ? keyword : searchQuery).trim();
    if (term) {
      router.push(`/agents?q=${encodeURIComponent(term)}`);
    } else {
      router.push('/agents');
    }
  };

  const handleOpenAssistant = () => {
    window.dispatchEvent(new CustomEvent('open-personal-assistant'));
  };

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
      <div className="space-y-16 py-8 md:py-12">
        {/* 1. Hero 区域：现代极简标语 + 真实交互搜索框 */}
        <section className="mx-auto max-w-4xl text-center space-y-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-xs font-black text-slate-700 shadow-xs animate-in fade-in duration-300">
            <Sparkles size={15} className="text-amber-500" />
            <span>AlmarenChat · 新一代个人 AI 智能体生态</span>
          </div>

          <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl leading-[1.12]">
            让单聊更深入，让多智能体协同为你所用。
          </h1>

          <p className="mx-auto max-w-2xl text-base sm:text-lg leading-relaxed text-slate-600 font-medium">
            连接 <span className="font-bold text-slate-900">单体专家 Agent</span>、融合 <span className="font-bold text-slate-900">多 Agent 协作空间 Spaces</span>、更有 24 小时常驻在侧的 <span className="font-bold text-slate-900">贴身小伴</span>，陪你思考，替你分忧。
          </p>

          {/* 交互式搜索输入框 */}
          <div className="mx-auto max-w-2xl pt-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearchSubmit();
              }}
              className="relative flex items-center rounded-full border border-black/10 bg-white p-1.5 shadow-lg transition-all focus-within:border-slate-400 focus-within:ring-4 focus-within:ring-slate-100"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-400 pl-2">
                <Search size={20} />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索感兴趣的 Agent、技能或应用场景..."
                className="h-11 flex-1 bg-transparent px-2 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-slate-950 px-5 text-sm font-black text-white shadow-xs transition hover:bg-slate-800 cursor-pointer shrink-0"
              >
                <span>探索</span>
                <ArrowRight size={15} />
              </button>
            </form>

            {/* 高频热词快速筛选 */}
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold text-slate-500">
              <span className="text-slate-400">试试搜索：</span>
              {hotKeywords.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setSearchQuery(tag);
                    handleSearchSubmit(tag);
                  }}
                  className="rounded-full bg-slate-100/80 px-3 py-1 text-slate-600 transition hover:bg-slate-200 hover:text-slate-950 cursor-pointer"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 2. 平台三大核心能力矩阵（The 3 Pillars） */}
        <section className="space-y-6">
          <div className="text-center space-y-1">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Core Capabilities</p>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-950">三大核心形态 · 覆盖全场景体验</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {/* 卡片 1: Agent 广场 */}
            <div className="group flex flex-col justify-between rounded-3xl border border-black/[0.08] bg-white p-6 shadow-xs transition-all duration-200 hover:-translate-y-1 hover:border-black/20 hover:shadow-xl">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 transition group-hover:scale-110">
                    <Bot size={28} />
                  </div>
                  <span className="rounded-full bg-indigo-100/70 px-2.5 py-1 text-xs font-black text-indigo-800">
                    单兵专家
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-black text-slate-950">Agent 广场</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 font-medium">
                  汇聚涵盖编程、写作、学习、心理等各垂直领域的专业角色。挂载知识库与独立设定，即选即聊。
                </p>
                <ul className="mt-4 space-y-1.5 text-xs font-semibold text-slate-500">
                  <li className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                    丰富专业人设与开箱即用 Prompt
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                    支持按场景分类与知识库检索
                  </li>
                </ul>
              </div>
              <div className="mt-6 pt-4 border-t border-black/[0.04]">
                <button
                  type="button"
                  onClick={() => router.push('/agents')}
                  className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5 text-xs font-black text-slate-800 transition hover:bg-slate-950 hover:text-white cursor-pointer"
                >
                  <span>进入 Agent 广场探索</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>

            {/* 卡片 2: 空间 Spaces（多智能体协作讨论） */}
            <div className="group flex flex-col justify-between rounded-3xl border border-emerald-200/80 bg-gradient-to-b from-emerald-50/30 to-white p-6 shadow-xs transition-all duration-200 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-xl relative overflow-hidden">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 transition group-hover:scale-110">
                    <PanelsTopLeft size={28} />
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800 flex items-center gap-1">
                    <Zap size={12} className="fill-emerald-700 text-emerald-700" />
                    团队协同
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-black text-slate-950">多智能体空间 (Spaces)</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 font-medium">
                  突破单聊天局限。将多位专家 Agent 引入同一协作空间，围绕复杂目标同台推演、分发任务与编写交付成果。
                </p>
                <ul className="mt-4 space-y-1.5 text-xs font-semibold text-slate-500">
                  <li className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    多 Agent 群聊激辩与交叉审阅
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    异步任务派发与产出完整交付物
                  </li>
                </ul>
              </div>
              <div className="mt-6 pt-4 border-t border-emerald-100/60">
                <button
                  type="button"
                  onClick={() => router.push('/spaces')}
                  className="flex w-full items-center justify-between rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 cursor-pointer"
                >
                  <span>探索多智能体协作空间</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>

            {/* 卡片 3: 贴身搭子「小伴」 */}
            <div className="group flex flex-col justify-between rounded-3xl border border-amber-200/80 bg-gradient-to-b from-amber-50/30 to-white p-6 shadow-xs transition-all duration-200 hover:-translate-y-1 hover:border-amber-300 hover:shadow-xl">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-13 w-13 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 transition group-hover:scale-110">
                    <MessageCircleHeart size={28} />
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-900">
                    全天候搭子
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-black text-slate-950">贴身小伴</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 font-medium">
                  常驻右下角的专属私人助理。拥有跨会话长期记忆，随口一句话记下便签待办，到点贴心声画闹钟唤醒。
                </p>
                <ul className="mt-4 space-y-1.5 text-xs font-semibold text-slate-500">
                  <li className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    自然语言“下午3点提醒我喝水”准点闹钟
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    长期生活习惯记忆回响与轻声陪伴
                  </li>
                </ul>
              </div>
              <div className="mt-6 pt-4 border-t border-amber-100/60">
                <button
                  type="button"
                  onClick={handleOpenAssistant}
                  className="flex w-full items-center justify-between rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-amber-600 cursor-pointer"
                >
                  <span>呼出右下角小伴聊聊</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* 3. 登录态无缝继续上次对话 */}
        {isLoggedIn && recentConversations.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Continue</p>
                <h2 className="text-2xl font-black text-slate-950">继续上次对话</h2>
              </div>
              <button
                type="button"
                onClick={() => router.push('/conversations')}
                className="hidden items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-4 py-1.5 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-50 sm:flex cursor-pointer"
              >
                <span>全部会话</span>
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => handleResumeConversation(conversation)}
                  className="group flex min-w-0 items-center gap-4 rounded-2xl border border-black/[0.06] bg-white p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md cursor-pointer"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl">
                    {conversation.agentAvatar || '🤖'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-slate-950">
                      {conversation.agentName || '未知 Agent'}
                    </div>
                    <div className="mt-0.5 line-clamp-1 truncate text-xs text-slate-500 font-medium">
                      {conversation.title || '继续对话'}
                    </div>
                  </div>
                  <ArrowRight size={16} className="shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-950" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 4. 按意图目标直达 */}
        <section className="space-y-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Scenarios</p>
            <h2 className="text-2xl font-black text-slate-950">按今天的目标开始</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {scenarioLinks.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => router.push(item.href)}
                  className="rounded-2xl border border-black/[0.06] bg-white p-5 text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md cursor-pointer group"
                >
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl text-white transition group-hover:scale-105" style={{ backgroundColor: item.color }}>
                    <Icon size={20} />
                  </div>
                  <h3 className="text-base font-black text-slate-950">{item.label}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500 font-medium">{item.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* 5. 热门精选 Agent 榜单 */}
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Featured Picks</p>
              <h2 className="text-2xl font-black text-slate-950">热门精选 Agent</h2>
            </div>
            <button
              type="button"
              onClick={() => router.push('/agents')}
              className="hidden items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-4 py-1.5 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-50 sm:flex cursor-pointer"
            >
              <span>去广场浏览全部</span>
              <ArrowRight size={14} />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
