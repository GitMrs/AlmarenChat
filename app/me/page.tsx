'use client';

import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Bot,
  Clock3,
  Edit3,
  Heart,
  MessageSquare,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import AppShell from '@/components/layout/AppShell';

const myAgents = [
  {
    id: 'draft-writing-agent',
    name: '内容灵感伙伴',
    avatar: '✍️',
    description: '帮我把零散想法整理成可发布的内容。',
    status: '私有',
    statusTone: 'bg-slate-100 text-slate-600',
    updatedAt: '今天更新',
  },
  {
    id: 'published-study-agent',
    name: '学习拆解师',
    avatar: '📚',
    description: '把复杂知识拆成例子、步骤和练习。',
    status: '已发布',
    statusTone: 'bg-emerald-50 text-emerald-700',
    updatedAt: '昨天更新',
  },
];

const favoriteAgents = [
  { id: 'academic-writing', name: '小鹿写作官', avatar: '📝', reason: '常用来改文案' },
  { id: 'philosophical-analysis', name: '概念分析师', avatar: '💡', reason: '适合拆问题' },
];

const recentConversations = [
  { id: 'writing', agentId: 'academic-writing', title: '继续优化小红书标题', time: '刚刚' },
  { id: 'study', agentId: 'philosophical-analysis', title: '把复杂概念讲简单', time: '昨天' },
];

export default function MePage() {
  const router = useRouter();

  return (
    <AppShell>
      <div className="space-y-8 py-8">
        <section className="rounded-[32px] border border-black/[0.06] bg-white/82 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
                <Sparkles size={16} />
                我的空间
              </div>
              <h1 className="text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
                管理你的 Agent、收藏和会话。
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-500">
                这里是用户自己的资产中心。创建后的 Agent 默认先在这里维护，需要公开时再发布到广场。
              </p>
            </div>

            <button
              onClick={() => router.push('/create-agent')}
              className="inline-flex w-fit items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <Plus size={17} />
              创建新 Agent
            </button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            { label: '我的 Agent', value: myAgents.length, icon: Bot, note: '可编辑、测试、发布' },
            { label: '收藏 Agent', value: favoriteAgents.length, icon: Heart, note: '下次快速开始' },
            { label: '最近会话', value: recentConversations.length, icon: MessageSquare, note: '继续上次想法' },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fbfaf7] text-slate-700">
                  <Icon size={19} />
                </div>
                <div className="text-3xl font-black text-slate-950">{item.value}</div>
                <div className="mt-1 text-sm font-bold text-slate-700">{item.label}</div>
                <p className="mt-2 text-sm text-slate-400">{item.note}</p>
              </div>
            );
          })}
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-400">My Agents</p>
                <h2 className="text-2xl font-black text-slate-950">我创建的 Agent</h2>
              </div>
              <button
                onClick={() => router.push('/my-agents')}
                className="hidden items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:text-slate-950 sm:flex"
              >
                查看全部
                <ArrowRight size={15} />
              </button>
            </div>

            <div className="grid gap-4">
              {myAgents.map((agent) => (
                <article
                  key={agent.id}
                  className="overflow-hidden rounded-[28px] border border-black/[0.06] bg-white shadow-sm"
                >
                  <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-[#fbfaf7] text-3xl shadow-sm">
                      {agent.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-black text-slate-950">{agent.name}</h3>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${agent.statusTone}`}>
                          {agent.status}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                          <Clock3 size={13} />
                          {agent.updatedAt}
                        </span>
                      </div>
                      <p className="text-sm leading-6 text-slate-500">{agent.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
                        <Edit3 size={15} />
                        编辑
                      </button>
                      <button className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm">
                        <Rocket size={15} />
                        发布
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-[28px] border border-black/[0.06] bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-950">
                <ShieldCheck size={18} />
                发布规则
              </div>
              <div className="space-y-3 text-sm leading-6 text-slate-500">
                <p>1. 新建 Agent 先进入私有维护。</p>
                <p>2. 完成名称、简介、开场白和行为设定后再发布。</p>
                <p>3. 广场只展示已发布 Agent，用户可随时下架。</p>
              </div>
            </div>

            <div className="rounded-[28px] border border-black/[0.06] bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-950">我的收藏</h3>
                <Heart size={18} className="text-rose-400" />
              </div>
              <div className="space-y-3">
                {favoriteAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => router.push(`/chat/${agent.id}`)}
                    className="flex w-full items-center gap-3 rounded-2xl bg-[#fbfaf7] p-3 text-left transition hover:bg-slate-100"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-xl">
                      {agent.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-slate-950">{agent.name}</div>
                      <div className="truncate text-xs text-slate-500">{agent.reason}</div>
                    </div>
                    <ArrowRight size={15} className="text-slate-300" />
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-black/[0.06] bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-950">最近会话</h3>
                <button
                  onClick={() => router.push('/conversations')}
                  className="text-xs font-bold text-slate-400 hover:text-slate-950"
                >
                  全部
                </button>
              </div>
              <div className="space-y-3">
                {recentConversations.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => router.push(`/chat/${item.agentId}`)}
                    className="w-full rounded-2xl bg-[#fbfaf7] p-3 text-left transition hover:bg-slate-100"
                  >
                    <div className="truncate text-sm font-black text-slate-950">{item.title}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-400">{item.time}</div>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
