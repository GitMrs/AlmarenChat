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
      .catch((err: any) => setError(err.message || '加载冒险记录失败'))
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
      setError(err.message || '修改冒险名称失败');
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteConversation = async (conversationId: string) => {
    if (deletingId) return;
    if (!window.confirm('确定删除这条冒险记录吗？删除后不能恢复。')) return;

    setDeletingId(conversationId);
    setError('');
    try {
      await conversationsApi.delete(conversationId);
      setConversationList((items) => items.filter((item) => item.id !== conversationId));
    } catch (err: any) {
      setError(err.message || '删除冒险记录失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell>
      <div className="space-y-8 py-8">
        <section className="rounded-[32px] border border-white/10 bg-[#19172a] p-6 backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/82 backdrop-blur">
                <MessageSquare size={16} className="text-[#d89022]" />
                冒险记录
              </div>
              <h1 className="text-4xl font-black leading-tight text-white sm:text-5xl">
                继续那些未完成的冒险。
              </h1>
              <p className="mt-4 text-base leading-7 text-white/58">
                每一条记录都是你在不同故事世界中的冒险旅程。
              </p>
            </div>

            <div className="min-w-0 flex-1 lg:max-w-md">
              <div className="relative">
                <Search size={19} className="absolute left-5 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索冒险、世界或关键词..."
                  className="h-14 w-full rounded-full border border-white/10 bg-white/[0.08] pl-13 pr-5 text-sm font-medium text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-[#d89022]">最近冒险</p>
                <h2 className="text-2xl font-black text-white">冒险旅程</h2>
              </div>
              <button
                onClick={() => router.push('/agents')}
                className="hidden items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70 transition hover:text-white sm:flex"
              >
                探索新世界
                <ArrowRight size={15} />
              </button>
            </div>

            {needsLogin ? (
              <LoginRequired
                title="登录后查看冒险记录"
                description="冒险记录会保存你在各个故事世界中的旅程。登录后可以继续、重命名或删除。"
              />
            ) : loading ? (
              <div className="flex items-center justify-center rounded-[28px] border border-white/10 bg-[#242039] py-20 text-white/40">
                加载中...
              </div>
            ) : error ? (
              <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-400">{error}</div>
            ) : filtered.length > 0 ? (
              <div className="grid gap-4">
                {filtered.map((conversation) => {
                  const category = conversation.agentCategory || '';
                  const color = CATEGORY_COLORS[category] || '#6366f1';
                  const lastMessage = conversation.messages?.[0];

                  return (
                    <article
                      key={conversation.id}
                      className="cursor-default overflow-hidden rounded-[28px] border border-white/10 bg-[#242039]"
                    >
                      <div className="h-1.5" style={{ backgroundColor: color }} />
                      <div className="flex gap-4 p-5">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-white/[0.08] text-3xl">
                          {conversation.agentAvatar || '🎭'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <span className="text-sm font-black text-white">
                              {conversation.agentName || '未知世界'}
                            </span>
                            {category && (
                              <span
                                className="rounded-full px-2.5 py-1 text-xs font-bold text-white"
                                style={{ backgroundColor: color }}
                              >
                                {category}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-white/40">
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
                                className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.08] px-4 text-sm font-bold text-white outline-none focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveTitle(conversation.id)}
                                  disabled={updatingId === conversation.id || !editingTitle.trim()}
                                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#19172a] disabled:bg-white/[0.08] disabled:text-white/30"
                                  aria-label="保存冒险名称"
                                >
                                  {updatingId === conversation.id ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditing}
                                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.08] text-white/54"
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
                              <h3 className="cursor-pointer truncate text-lg font-black text-white transition hover:text-white/70 hover:underline hover:decoration-white/30 hover:underline-offset-4">
                                {conversation.title || '新的冒险'}
                              </h3>
                            </button>
                          )}
                          {lastMessage && (
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/54">
                              {lastMessage.content}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-start gap-2">
                          <button
                            type="button"
                            onClick={() => startEditing(conversation)}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/[0.08] text-white/54 transition hover:bg-white hover:text-[#19172a]"
                            aria-label="修改冒险名称"
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteConversation(conversation.id)}
                            disabled={deletingId === conversation.id}
                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-rose-500/10 text-rose-400 transition hover:bg-rose-500 hover:text-white disabled:cursor-default disabled:bg-white/[0.08] disabled:text-white/30"
                            aria-label="删除冒险记录"
                          >
                            {deletingId === conversation.id ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push(`/conversations/${conversation.id}`)}
                            className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-full text-white/30 transition hover:bg-white/[0.08] hover:text-white sm:flex"
                            aria-label="继续冒险"
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
              <div className="rounded-[28px] border border-dashed border-white/18 bg-white/[0.04] p-12 text-center">
                <h3 className="text-lg font-black text-white">还没有冒险记录</h3>
                <p className="mt-2 text-sm leading-6 text-white/54">去探索一个故事世界，开始你的冒险吧。</p>
                <button
                  onClick={() => router.push('/agents')}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#19172a]"
                >
                  探索世界
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-[#242039] p-6">
              <Sparkles size={22} className="text-[#d89022]" />
              <h3 className="mt-4 text-xl font-black text-white">每一次冒险都值得记录。</h3>
              <p className="mt-3 text-sm leading-6 text-white/54">
                所有冒险都会自动保存，你可以随时回到任何故事世界继续探索。
              </p>
              <button
                onClick={() => router.push('/')}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-[#19172a]"
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
