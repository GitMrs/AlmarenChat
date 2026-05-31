'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Eye, Ghost, Heart as HeartIcon, MapPin, Palette, Scroll, Shield, Skull, Sparkles, Star, Swords, Target, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppShell from '@/components/layout/AppShell';
import Avatar from '@/components/shared/Avatar';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getBuiltInAgents } from '@/lib/agents-data';
import { agents as agentsApi, favorites as favoritesApi } from '@/lib/api';
import { CATEGORY_COLORS, DIFFICULTY_LABELS } from '@/types';
import type { Agent } from '@/types';

const CATEGORY_WORLD_INFO: Record<string, { icon: typeof Zap; hook: string; rules: string[] }> = {
  悬疑推理: {
    icon: Eye,
    hook: '一桩离奇案件等待你来破解',
    rules: ['仔细观察每个线索', '与角色对话获取信息', '不要轻信任何人', '推理需要证据支持'],
  },
  浪漫言情: {
    icon: HeartIcon,
    hook: '一段心跳加速的故事等你开启',
    rules: ['用心感受每个角色', '选择影响故事走向', '真诚是最好的策略', '每个结局都有意义'],
  },
  奇幻冒险: {
    icon: Swords,
    hook: '一个未知的世界等待探索',
    rules: ['勇敢面对挑战', '收集有用的物品', '与盟友建立信任', '智慧胜过蛮力'],
  },
  都市剧情: {
    icon: Star,
    hook: '都市里的人生百态由你演绎',
    rules: ['理解每个角色的立场', '选择反映你的价值观', '没有绝对的对错', '故事由你书写'],
  },
  社交推理: {
    icon: Shield,
    hook: '谁在说谎？找出隐藏的真相',
    rules: ['观察言行不一致', '建立联盟但保持警惕', '投票决定命运', '信任需要 earned'],
  },
  心理博弈: {
    icon: Target,
    hook: '一场心理层面的深度较量',
    rules: ['保持冷静和理性', '读懂对方的真实意图', '策略比力量更重要', '每个选择都有代价'],
  },
  喜剧搞笑: {
    icon: Sparkles,
    hook: '准备好笑到停不下来了吗？',
    rules: ['放飞想象力', '没有离谱只有更离谱', '享受每一个意外', '快乐是最好的奖励'],
  },
  恐怖惊悚: {
    icon: Skull,
    hook: '你敢踏入这片未知的黑暗吗？',
    rules: ['保持警惕', '光明不一定安全', '有些声音不要回应', '活着离开就是胜利'],
  },
  科幻探索: {
    icon: Zap,
    hook: '宇宙的未知角落等你探索',
    rules: ['科学是你的武器', '未知不代表危险', '记录每一个发现', '好奇心驱动一切'],
  },
};

const CATEGORY_SUGGESTIONS: Record<string, (name: string) => string[]> = {
  悬疑推理: (name) => [`${name}，带我进入案件现场`, '我发现了一个可疑线索', '我想审问嫌疑人'],
  浪漫言情: (name) => [`${name}，故事从哪里开始？`, '我想了解这个角色', '接下来会发生什么？'],
  奇幻冒险: (name) => [`${name}，我准备好了，出发！`, '这个世界有什么传说？', '我想探索那片森林'],
  都市剧情: (name) => [`${name}，我的角色是谁？`, '今天发生了什么事？', '我想和那个人谈谈'],
  社交推理: (name) => [`${name}，游戏开始了`, '我怀疑那个人', '我想进行一轮讨论'],
  心理博弈: (name) => [`${name}，来一场心理较量`, '你的策略是什么？', '我想分析当前局势'],
  喜剧搞笑: (name) => [`${name}，来点开心的`, '讲个笑话吧', '我们来玩个游戏'],
  恐怖惊悚: (name) => [`${name}，我准备好了...大概`, '那里有什么？', '我不该打开那扇门的...'],
  科幻探索: (name) => [`${name}，飞船准备就绪`, '前方有什么星球？', '启动跃迁引擎'],
};

export default function AgentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const agentId = params.agentId as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFavorited, setIsFavorited] = useState(false);

  useEffect(() => {
    const loadAgent = async () => {
      try {
        const result = await agentsApi.get(agentId);
        setAgent(result.agent);
      } catch {
        const agents = await getBuiltInAgents();
        setAgent(agents.find((item) => item.id === agentId) || null);
      } finally {
        setLoading(false);
      }
    };

    loadAgent();
  }, [agentId]);

  const worldInfo = useMemo(() => {
    if (!agent) return null;
    return CATEGORY_WORLD_INFO[agent.category || ''] || {
      icon: MapPin,
      hook: '一段等你开启的故事',
      rules: ['探索未知', '做出选择', '创造属于你的故事'],
    };
  }, [agent]);

  const suggestedPrompts = useMemo(() => {
    if (!agent) return [];
    const generator = CATEGORY_SUGGESTIONS[agent.category || ''];
    return generator ? generator(agent.name) : ['故事从哪里开始？', '我的角色是谁？', '带我进入这个世界'];
  }, [agent]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <LoadingSpinner size="lg" />
        </div>
      </AppShell>
    );
  }

  if (!agent) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <p className="font-semibold text-white/54">这个世界不存在</p>
          <button onClick={() => router.push('/agents')} className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#19172a]">
            返回探索
          </button>
        </div>
      </AppShell>
    );
  }

  const categoryColor = CATEGORY_COLORS[agent.category || ''] || '#6366f1';
  const WorldIcon = worldInfo?.icon || MapPin;

  return (
    <AppShell>
      <div className="space-y-6 py-8">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70 transition hover:text-white"
        >
          <ArrowLeft size={16} />
          返回
        </button>

        {/* World Header */}
        <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[#242039]">
          <div className="h-2" style={{ backgroundColor: categoryColor }} />
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-8">
            <div className="min-w-0">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[28px] bg-white/[0.08] shadow-sm">
                  <Avatar src={agent.avatar} alt={agent.name} size="xl" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full px-3 py-1.5 text-xs font-black text-white" style={{ backgroundColor: categoryColor }}>
                      {agent.category || '世界'}
                    </span>
                    {agent.tone && <span className="rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-black text-white/64">{agent.tone}</span>}
                    {agent.difficulty && (
                      <span className="rounded-full bg-[#d89022]/20 px-3 py-1.5 text-xs font-black text-[#d89022]">
                        {DIFFICULTY_LABELS[agent.difficulty] || agent.difficulty}
                      </span>
                    )}
                  </div>
                  <h1 className="text-4xl font-black leading-tight text-white sm:text-5xl">{agent.name}</h1>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-white/58">
                    {agent.description || '一段等你来探索的故事。'}
                  </p>
                </div>
              </div>

              {/* World Rules */}
              <div className="mt-8 rounded-2xl bg-white/[0.06] p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
                  <Scroll size={16} style={{ color: categoryColor }} />
                  世界规则
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {worldInfo?.rules.map((rule, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-white/64">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-black text-white" style={{ backgroundColor: categoryColor }}>
                        {i + 1}
                      </span>
                      {rule}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Start Panel */}
            <aside className="rounded-[28px] bg-white/[0.06] p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl text-white" style={{ backgroundColor: categoryColor }}>
                  <WorldIcon size={16} />
                </div>
                <div className="text-sm font-black text-white">故事入口</div>
              </div>
              <p className="mb-4 text-sm leading-6 text-white/58">{worldInfo?.hook}</p>
              <div className="space-y-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => router.push(`/chat/${agent.id}?prompt=${encodeURIComponent(prompt)}`)}
                    className="w-full rounded-2xl bg-white/[0.08] px-4 py-3 text-left text-sm font-bold leading-6 text-white/70 transition hover:-translate-y-0.5 hover:bg-white/[0.12] hover:text-white"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <button
                onClick={() => router.push(`/chat/${agent.id}`)}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-black text-[#19172a] shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <Sparkles size={17} />
                开始冒险
              </button>
            </aside>
          </div>
        </section>

        {/* Opening Scene & System Prompt */}
        <section className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="rounded-[28px] border border-white/10 bg-[#242039] p-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-white">
              <BookOpen size={17} style={{ color: categoryColor }} />
              开场白
            </div>
            <p className="text-sm leading-7 text-white/64">
              {agent.greeting || `欢迎来到 ${agent.name}。你的冒险从这里开始。`}
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#242039] p-6">
            <div className="mb-3 text-sm font-black text-white">世界设定</div>
            <div className="markdown-body max-h-[420px] overflow-y-auto rounded-2xl bg-white/[0.06] p-5 text-sm leading-7 text-white/64">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {agent.systemPrompt || '这个世界等待你来探索和定义。'}
              </ReactMarkdown>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
