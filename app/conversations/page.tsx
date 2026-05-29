'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Clock3, Edit3, Loader2, MessageSquare, Search, Sparkles, Trash2, X } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import LoginRequired from '@/components/auth/LoginRequired';
import { conversations as conversationsApi } from '@/lib/api';
import { CATEGORY_COLORS } from '@/types';

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

export default function ConversationsPage() {
  const router = useRouter();
  const [conversationList, setConversationList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setNeedsLogin(true);
      setLoading(false);
      return;
    }

    conversationsApi
      .list()
      .then((result) => setConversationList(result.conversations))
      .catch((err: any) => setError(err.message || '加载会话失败'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = searchQuery.trim()
    ? conversationList.filter(
        (c) =>
          c.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.agentName?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversationList;

  const startEditing = (conversation: any) => {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title || '');
    setError('');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const saveTitle = async (conversationId: string) => {
    const title = editingTitle.trim();
    if (!title || updatingId) return;

    setUpdatingId(conversationId);
    setError('');
    try {
      const result = await conversationsApi.update(conversationId, { title });
      setConversationList((items) =>
        items.map((item) => (item.id === conversationId ? { ...item, title: result.conversation.title } : item))
      );
      cancelEditing();
    } catch (err: any) {
      setError(err.message || '修改会话名称失败');
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteConversation = async (conversationId: string) => {
    if (deletingId) return;
    if (!window.confirm('确定删除这个会话吗？删除后不能恢复。')) return;

    setDeletingId(conversationId);
    setError('');
    try {
      await conversationsApi.delete(conversationId);
      setConversationList((items) => items.filter((item) => item.id !== conversationId));
    } catch (err: any) {
      setError(err.message || '删除会话失败');
    } finally {
      setDeletingId(null);
    }
  };

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
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
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

            {needsLogin ? (
              <LoginRequired
                title="登录后查看会话"
                description="会话记录会保存你和 Agent 一起推进过的任务、灵感和问题。登录后可以继续、重命名或删除。"
              />
            ) : loading ? (
              <div className="flex items-center justify-center rounded-[28px] border border-black/[0.06] bg-white py-20 text-slate-400">
                加载中...
              </div>
            ) : error ? (
              <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div>
            ) : filtered.length > 0 ? (
              <div className="grid gap-4">
                {filtered.map((conversation) => {
                  const category = conversation.agentCategory || '';
                  const color = CATEGORY_COLORS[category] || '#6366f1';
                  const lastMessage = conversation.messages?.[0];

                  return (
                    <article
                      key={conversation.id}
                      className="cursor-default overflow-hidden rounded-[28px] border border-black/[0.06] bg-white text-left shadow-sm"
                    >
                      <div className="h-1.5" style={{ backgroundColor: color }} />
                      <div className="flex gap-4 p-5">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-[#fbfaf7] text-3xl shadow-sm">
                          {conversation.agentAvatar || '🤖'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="text-sm font-black text-slate-950">
                              {conversation.agentName || '未知 Agent'}
                            </span>
                            {category && (
                              <span
                                className="rounded-full px-2.5 py-1 text-xs font-bold text-white"
                                style={{ backgroundColor: color }}
                              >
                                {category}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                              <Clock3 size={13} />
                              {formatTime(conversation.updatedAt)}
                            </span>
                          </div>
                          {editingId === conversation.id ? (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <input
                                value={editingTitle}
                                onChange={(event) => setEditingTitle(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') saveTitle(conversation.id);
                                  if (event.key === 'Escape') cancelEditing();
                                }}
                                className="h-11 min-w-0 flex-1 rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-bold text-slate-900 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveTitle(conversation.id)}
                                  disabled={updatingId === conversation.id || !editingTitle.trim()}
                                  className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white disabled:bg-slate-200 disabled:text-slate-400"
                                  aria-label="保存会话名称"
                                >
                                  {updatingId === conversation.id ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditing}
                                  className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                                  aria-label="取消修改"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => router.push(`/conversations/${conversation.id}`)}
                              className="inline-block max-w-full cursor-pointer text-left"
                            >
                              <h3 className="cursor-pointer truncate text-lg font-black text-slate-950 transition hover:text-slate-600 hover:underline hover:decoration-slate-300 hover:underline-offset-4">
                                {conversation.title || '新对话'}
                              </h3>
                            </button>
                          )}
                          {lastMessage && (
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                              {lastMessage.content}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-start gap-2">
                          <button
                            type="button"
                            onClick={() => startEditing(conversation)}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-950 hover:text-white"
                            aria-label="修改会话名称"
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteConversation(conversation.id)}
                            disabled={deletingId === conversation.id}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-rose-50 text-rose-500 transition hover:bg-rose-500 hover:text-white disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-300"
                            aria-label="删除会话"
                          >
                            {deletingId === conversation.id ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push(`/conversations/${conversation.id}`)}
                            className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-100 hover:text-slate-950 sm:flex"
                            aria-label="打开会话"
                          >
                            <ArrowRight size={18} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-12 text-center">
                <h3 className="text-lg font-black text-slate-950">还没有对话</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">去 Agent 广场找一个开始聊天吧。</p>
                <button
                  onClick={() => router.push('/agents')}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white"
                >
                  找 Agent
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-[28px] border border-black/[0.06] bg-slate-950 p-6 text-white shadow-sm">
              <Sparkles size={22} className="text-amber-300" />
              <h3 className="mt-4 text-xl font-black">让对话变成你的工作记忆。</h3>
              <p className="mt-3 text-sm leading-6 text-white/60">
                所有对话都会自动保存，你可以随时继续之前的思路。
              </p>
              <button
                onClick={() => router.push('/')}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-950"
              >
                回到发现
                <ArrowRight size={15} />
              </button>
            </div>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
