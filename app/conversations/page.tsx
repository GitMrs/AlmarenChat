'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Clock3, MessageSquare, Search, Sparkles } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';

const sampleConversations = [
  {
    id: 'writing',
    agentId: 'academic-writing',
    avatar: '📝',
    agentName: '小鹿写作官',
    title: '小红书标题和开头优化',
    excerpt: '把这段内容改得更有网感，同时保留原来的观点。',
    time: '刚刚',
    category: '写作',
    color: '#f59e0b',
  },
  {
    id: 'code',
    agentId: 'node-js-devoloper',
    avatar: '🤖',
    agentName: '代码教练 Kai',
    title: 'Next.js 页面样式排查',
    excerpt: '先确认 CSS 是否注入，再看 layout 和全局样式链路。',
    time: '今天',
    category: '编程',
    color: '#2563eb',
  },
  {
    id: 'study',
    agentId: 'philosophical-analysis',
    avatar: '📘',
    agentName: '学习导师',
    title: '把复杂概念讲简单',
    excerpt: '用一个生活里的例子解释，然后给我三道练习题。',
    time: '昨天',
    category: '学习',
    color: '#10b981',
  },
];

export default function ConversationsPage() {
  const router = useRouter();

  return (
    <AppShell>
      <div className="space-y-8 py-8">
        <section className="rounded-[32px] border border-black/[0.06] bg-white/82 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
                <MessageSquare size={16} />
                会话空间
              </div>
              <h1 className="text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
                继续那些还没聊完的想法。
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-500">
                这里不是普通聊天列表，而是你和不同 Agent 一起推进过的任务、灵感和问题。
              </p>
            </div>

            <div className="min-w-0 flex-1 lg:max-w-md">
              <div className="relative">
                <Search size={19} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="搜索会话、Agent 或关键词..."
                  className="h-14 w-full rounded-full border border-black/[0.08] bg-[#fbfaf7] pl-13 pr-5 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-400">Recent Conversations</p>
                <h2 className="text-2xl font-black text-slate-950">最近对话</h2>
              </div>
              <button
                onClick={() => router.push('/agents')}
                className="hidden items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:text-slate-950 sm:flex"
              >
                找新 Agent
                <ArrowRight size={15} />
              </button>
            </div>

            <div className="grid gap-4">
              {sampleConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => router.push(`/chat/${conversation.agentId}`)}
                  className="group overflow-hidden rounded-[28px] border border-black/[0.06] bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="h-1.5" style={{ backgroundColor: conversation.color }} />
                  <div className="flex gap-4 p-5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-[#fbfaf7] text-3xl shadow-sm">
                      {conversation.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-slate-950">{conversation.agentName}</span>
                        <span
                          className="rounded-full px-2.5 py-1 text-xs font-bold text-white"
                          style={{ backgroundColor: conversation.color }}
                        >
                          {conversation.category}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                          <Clock3 size={13} />
                          {conversation.time}
                        </span>
                      </div>
                      <h3 className="truncate text-lg font-black text-slate-950">{conversation.title}</h3>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{conversation.excerpt}</p>
                    </div>
                    <div className="hidden items-center text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-950 sm:flex">
                      <ArrowRight size={20} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-[28px] border border-black/[0.06] bg-slate-950 p-6 text-white shadow-sm">
              <Sparkles size={22} className="text-amber-300" />
              <h3 className="mt-4 text-xl font-black">让对话变成你的工作记忆。</h3>
              <p className="mt-3 text-sm leading-6 text-white/60">
                后续这里会展示真实历史、收藏回答和自动生成的会话标题。
              </p>
              <button
                onClick={() => router.push('/')}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-950"
              >
                回到发现
                <ArrowRight size={15} />
              </button>
            </div>

            <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-6">
              <h3 className="text-lg font-black text-slate-950">真实数据接入后</h3>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-500">
                <p>1. 显示用户真实会话。</p>
                <p>2. 支持按 Agent 和关键词搜索。</p>
                <p>3. 自动生成会话标题和摘要。</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
