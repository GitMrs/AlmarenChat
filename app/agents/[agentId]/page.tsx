'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, Coffee, Code, Gamepad2, Heart as HeartIcon, MessageCircle, Palette, Sparkles, Wrench, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppShell from '@/components/layout/AppShell';
import Avatar from '@/components/shared/Avatar';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getBuiltInAgents } from '@/lib/agents-data';
import { agents as agentsApi } from '@/lib/api';
import { CATEGORY_COLORS } from '@/types';
import type { Agent } from '@/types';

const CATEGORY_CAPABILITIES: Record<string, { icon: typeof Zap; items: string[] }> = {
  写作: { icon: BookOpen, items: ['文章撰写', '文案润色', '创意写作', '内容策划'] },
  编程: { icon: Code, items: ['代码编写', 'Bug 调试', '架构设计', '代码审查'] },
  学习: { icon: BookOpen, items: ['知识讲解', '学习规划', '概念解析', '考试辅导'] },
  心理: { icon: HeartIcon, items: ['情绪疏导', '压力管理', '自我认知', '正念练习'] },
  创意: { icon: Palette, items: ['创意构思', '头脑风暴', '方案设计', '灵感激发'] },
  生活: { icon: Coffee, items: ['生活建议', '健康管理', '旅行规划', '美食推荐'] },
  工具: { icon: Wrench, items: ['效率提升', '数据处理', '文档编写', '自动化'] },
  娱乐: { icon: Gamepad2, items: ['游戏推荐', '影视点评', '趣味问答', '冷知识'] },
};

const CATEGORY_SUGGESTIONS: Record<string, (name: string) => string[]> = {
  写作: (name) => [`帮我想一个${name}主题的文章大纲`, '帮我润色这段文字', '生成 5 个标题'],
  编程: (name) => [`${name}，帮我定位这个报错`, '解释这段代码的思路', '给我一个更简单的实现'],
  学习: (name) => [`${name}，用简单例子解释这个概念`, '帮我总结重点', '出 3 道练习题'],
  心理: (name) => [`${name}，我最近有点焦虑`, '陪我做一次放松练习', '帮我分析这个选择'],
  创意: (name) => [`${name}，给我 10 个新点子`, '帮我扩展这个设定', '换一个更有趣的方向'],
  生活: (name) => [`${name}，帮我规划一周安排`, '给我一个实用清单', '帮我比较几个选择'],
  工具: (name) => [`${name}，帮我整理成表格`, '提炼成待办事项', '把内容压缩成摘要'],
  娱乐: (name) => [`${name}，推荐点有趣的内容`, '来一个轻松的话题', '我们玩个小游戏'],
};

export default function AgentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const agentId = params.agentId as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

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

  const capabilities = useMemo(() => {
    if (!agent) return null;
    return CATEGORY_CAPABILITIES[agent.category || ''] || {
      icon: Zap,
      items: ['智能对话', '问题解答', '知识分享', '任务协助'],
    };
  }, [agent]);

  const suggestedPrompts = useMemo(() => {
    if (!agent) return [];
    const generator = CATEGORY_SUGGESTIONS[agent.category || ''];
    return generator ? generator(agent.name) : ['你能帮我做什么？', '给我介绍一下你的能力', '我们从一个小任务开始'];
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
          <p className="font-semibold text-slate-500">Agent 不存在</p>
          <button onClick={() => router.push('/agents')} className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white">
            返回广场
          </button>
        </div>
      </AppShell>
    );
  }

  const categoryColor = CATEGORY_COLORS[agent.category || ''] || '#6366f1';
  const CapIcon = capabilities?.icon || Zap;

  return (
    <AppShell>
      <div className="space-y-6 py-8">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:text-slate-950"
        >
          <ArrowLeft size={16} />
          返回
        </button>

        <section className="overflow-hidden rounded-[32px] border border-black/[0.06] bg-white shadow-sm">
          <div className="h-2" style={{ backgroundColor: categoryColor }} />
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-8">
            <div className="min-w-0">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[28px] bg-[#fbfaf7] shadow-sm">
                  <Avatar src={agent.avatar} alt={agent.name} size="xl" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full px-3 py-1.5 text-xs font-black text-white" style={{ backgroundColor: categoryColor }}>
                      {agent.category || 'Agent'}
                    </span>
                    {agent.tone && <span className="rounded-full bg-[#fbfaf7] px-3 py-1.5 text-xs font-black text-slate-600">{agent.tone}</span>}
                    <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                      {agent.isPublic ? '公开' : '私有'}
                    </span>
                  </div>
                  <h1 className="text-4xl font-black leading-tight text-slate-950 sm:text-5xl">{agent.name}</h1>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-slate-500">
                    {agent.description || '这个 Agent 会根据你的问题给出清晰、具体、可执行的帮助。'}
                  </p>
                </div>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {capabilities?.items.map((item) => (
                  <div key={item} className="rounded-2xl bg-[#fbfaf7] px-4 py-3">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-white shadow-sm" style={{ color: categoryColor }}>
                      <CapIcon size={16} />
                    </div>
                    <div className="text-sm font-black text-slate-800">{item}</div>
                  </div>
                ))}
              </div>
            </div>

            <aside className="rounded-[28px] bg-[#fbfaf7] p-5">
              <div className="mb-4 text-sm font-black text-slate-950">快速开始</div>
              <div className="space-y-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => router.push(`/chat/${agent.id}?prompt=${encodeURIComponent(prompt)}`)}
                    className="w-full rounded-2xl bg-white px-4 py-3 text-left text-sm font-bold leading-6 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:text-slate-950"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <button
                onClick={() => router.push(`/chat/${agent.id}`)}
                className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <MessageCircle size={17} />
                开始聊天
              </button>
            </aside>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="rounded-[28px] border border-black/[0.06] bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
              <Sparkles size={17} style={{ color: categoryColor }} />
              开场白
            </div>
            <p className="text-sm leading-7 text-slate-600">
              {agent.greeting || `你好，我是 ${agent.name}。告诉我你想完成什么，我们从第一步开始。`}
            </p>
          </div>

          <div className="rounded-[28px] border border-black/[0.06] bg-white p-6 shadow-sm">
            <div className="mb-3 text-sm font-black text-slate-950">行为设定</div>
            <div className="markdown-body max-h-[420px] overflow-y-auto rounded-2xl bg-[#fbfaf7] p-5 text-sm leading-7 text-slate-600">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {agent.systemPrompt || '这个 Agent 会根据用户的问题给出清晰、具体、可执行的帮助。'}
              </ReactMarkdown>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
