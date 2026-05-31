'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  Clock3,
  Edit3,
  Heart,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import LoginRequired from '@/components/auth/LoginRequired';
import SettingsPanel from '@/components/settings/SettingsPanel';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { agents as agentsApi, auth, conversations as conversationsApi, favorites as favoritesApi } from '@/lib/api';
import type { Agent } from '@/types';
import { cn } from '@/lib/utils';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function MeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'settings' ? 'settings' : 'assets';
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [favoriteAgents, setFavoriteAgents] = useState<any[]>([]);
  const [recentConversations, setRecentConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pendingDeleteAgent, setPendingDeleteAgent] = useState<Agent | null>(null);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setNeedsLogin(true);
      setLoading(false);
      return;
    }

    auth
      .me()
      .then(() =>
        Promise.all([
          agentsApi.mine().then((result) => setMyAgents(result.agents)),
          favoritesApi.list().then((result) => setFavoriteAgents(result.favorites)),
          conversationsApi.list().then((result) => setRecentConversations(result.conversations.slice(0, 5))),
        ])
      )
      .catch((err: any) => {
        if (err.message === 'Unauthorized') {
          localStorage.removeItem('token');
          setNeedsLogin(true);
          return;
        }
        setError(err.message || '加载数据失败');
      })
      .finally(() => setLoading(false));
  }, []);

  const togglePublish = async (agent: Agent) => {
    if (updatingId) return;

    setUpdatingId(agent.id);
    setError('');
    try {
      const result = await agentsApi.update(agent.id, { isPublic: !agent.isPublic });
      setMyAgents((items) => items.map((item) => (item.id === agent.id ? result.agent : item)));
    } catch (err: any) {
      setError(err.message || '更新发布状态失败');
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteAgent = async () => {
    if (updatingId) return;
    if (!pendingDeleteAgent) return;

    setUpdatingId(pendingDeleteAgent.id);
    setError('');
    try {
      await agentsApi.delete(pendingDeleteAgent.id);
      setMyAgents((items) => items.filter((item) => item.id !== pendingDeleteAgent.id));
      setPendingDeleteAgent(null);
    } catch (err: any) {
      setError(err.message || '删除世界失败');
    } finally {
      setUpdatingId(null);
    }
  };

  const switchTab = (tab: 'assets' | 'settings') => {
    router.push(tab === 'settings' ? '/me?tab=settings' : '/me');
  };

  return (
    <AppShell>
      <div className="space-y-8 py-8">
        <section className="rounded-[32px] border border-white/10 bg-[#19172a] p-6 backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/82 backdrop-blur">
                <Sparkles size={16} className="text-[#d89022]" />
                我的世界
              </div>
              <h1 className="text-4xl font-black leading-tight text-white sm:text-5xl">
                管理你创造的故事世界。
              </h1>
              <p className="mt-4 text-base leading-7 text-white/58">
                这里是你创作的所有世界、收藏的故事和冒险记录。
              </p>
            </div>

            <button
              onClick={() => router.push('/create-agent')}
              className="inline-flex w-fit cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-black text-[#19172a] shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <Plus size={17} />
              创作新世界
            </button>
          </div>
        </section>

        <section className="flex flex-wrap gap-2 rounded-[28px] border border-white/10 bg-[#242039] p-2">
          {[
            { id: 'assets', label: '我的世界', icon: MapPin },
            { id: 'settings', label: '账号设置', icon: SlidersHorizontal },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id as 'assets' | 'settings')}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition',
                  active ? 'bg-white text-[#19172a] shadow-sm' : 'text-white/54 hover:bg-white/[0.08] hover:text-white'
                )}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </section>

        {activeTab === 'assets' && <section className="grid gap-4 md:grid-cols-3">
          {[
            { label: '我的世界', value: myAgents.length, icon: MapPin, note: '可编辑、测试、发布' },
            { label: '收藏世界', value: favoriteAgents.length, icon: Heart, note: '随时回来继续' },
            { label: '冒险记录', value: recentConversations.length, icon: MessageSquare, note: '继续未完的故事' },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-[28px] border border-white/10 bg-[#242039] p-5">
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.08] text-white/70">
                  <Icon size={19} />
                </div>
                <div className="text-3xl font-black text-white">{item.value}</div>
                <div className="mt-1 text-sm font-bold text-white/70">{item.label}</div>
                <p className="mt-2 text-sm text-white/40">{item.note}</p>
              </div>
            );
          })}
        </section>}

        {error && (
          <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-400">
            {error}
          </div>
        )}

        {needsLogin && (
          <LoginRequired
            title="登录后管理你的世界"
            description="我的世界会保存你创作的故事世界、发布状态、收藏和冒险记录。"
          />
        )}

        {!needsLogin && activeTab === 'settings' && <SettingsPanel />}

        {!needsLogin && activeTab === 'assets' && <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-[#d89022]">我的创作</p>
                <h2 className="text-2xl font-black text-white">我创作的世界</h2>
              </div>
              <button
                onClick={() => router.push('/create-agent')}
                className="hidden cursor-pointer items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70 transition hover:text-white sm:flex"
              >
                创作新世界
                <ArrowRight size={15} />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center rounded-[28px] border border-white/10 bg-[#242039] py-20 text-white/40">
                <Loader2 className="animate-spin" size={24} />
              </div>
            ) : myAgents.length > 0 ? (
              <div className="grid gap-4">
                {myAgents.map((agent) => {
                  const isUpdating = updatingId === agent.id;
                  return (
                    <article
                      key={agent.id}
                      className="cursor-default overflow-hidden rounded-[28px] border border-white/10 bg-[#242039]"
                    >
                      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-white/[0.08] text-3xl">
                          {agent.avatar || '🎭'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-black text-white">{agent.name}</h3>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                                agent.isPublic ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.08] text-white/64'
                              }`}
                            >
                              {agent.isPublic ? '已发布' : '草稿'}
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-white/40">
                              <Clock3 size={13} />
                              {formatDate(agent.updatedAt)}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-sm leading-6 text-white/54">{agent.description || '还没有故事钩子。'}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            onClick={() => router.push(`/create-agent?agentId=${agent.id}`)}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70"
                          >
                            <Edit3 size={15} />
                            编辑
                          </button>
                          <button
                            onClick={() => router.push(`/chat/${agent.id}`)}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70"
                          >
                            <MessageSquare size={15} />
                            测试
                          </button>
                          <button
                            onClick={() => togglePublish(agent)}
                            disabled={isUpdating}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-[#19172a] shadow-sm disabled:cursor-default disabled:bg-white/[0.08] disabled:text-white/30"
                          >
                            {isUpdating ? <Loader2 className="animate-spin" size={15} /> : <Rocket size={15} />}
                            {agent.isPublic ? '下架' : '发布'}
                          </button>
                          <button
                            onClick={() => setPendingDeleteAgent(agent)}
                            disabled={isUpdating}
                            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-rose-500/20 bg-rose-500/10 text-rose-400 transition hover:bg-rose-500 hover:text-white disabled:cursor-default disabled:bg-white/[0.08] disabled:text-white/30"
                            title="删除世界"
                            aria-label="删除世界"
                          >
                            {isUpdating ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-white/18 bg-white/[0.04] p-12 text-center">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-3xl bg-white/[0.08] text-white/40">
                  <BookOpen size={24} />
                </div>
                <h3 className="text-lg font-black text-white">还没有创作世界</h3>
                <p className="mt-2 text-sm leading-6 text-white/54">创建一个故事世界，邀请玩家来探索。</p>
                <button
                  onClick={() => router.push('/create-agent')}
                  className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#19172a]"
                >
                  <Plus size={16} />
                  创作世界
                </button>
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <div className="rounded-[28px] border border-white/10 bg-[#242039] p-6">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-white">
                <ShieldCheck size={18} />
                发布规则
              </div>
              <div className="space-y-3 text-sm leading-6 text-white/54">
                <p>1. 新创作的世界先进入草稿状态。</p>
                <p>2. 完成世界名称、故事钩子、开场白和设定后再发布。</p>
                <p>3. 广场只展示已发布的世界，随时可以下架。</p>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#242039] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-black text-white">我的收藏</h3>
                <Heart size={18} className="text-rose-400" />
              </div>
              <div className="space-y-3">
                {favoriteAgents.length > 0 ? favoriteAgents.map((fav) => {
                  const agent = fav.agent;
                  return (
                    <button
                      key={fav.id}
                      onClick={() => router.push(`/chat/${agent.id}`)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-white/[0.06] p-3 text-left transition hover:bg-white/[0.10]"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.08] text-xl">
                        {agent.avatar || '🎭'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-white">{agent.name}</div>
                        <div className="truncate text-xs text-white/54">{agent.description}</div>
                      </div>
                      <ArrowRight size={15} className="text-white/30" />
                    </button>
                  );
                }) : (
                  <p className="text-sm text-white/40 text-center py-4">还没有收藏世界</p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#242039] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-black text-white">最近冒险</h3>
                <button
                  onClick={() => router.push('/conversations')}
                  className="cursor-pointer text-xs font-bold text-white/40 hover:text-white"
                >
                  全部
                </button>
              </div>
              <div className="space-y-3">
                {recentConversations.length > 0 ? recentConversations.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      router.push(`/conversations/${item.id}`);
                    }}
                    className="w-full cursor-pointer rounded-2xl bg-white/[0.06] p-3 text-left transition hover:bg-white/[0.10]"
                  >
                    <div className="truncate text-sm font-black text-white">{item.title || '新的冒险'}</div>
                    <div className="mt-1 truncate text-xs text-white/54">{item.agentName || '未知世界'}</div>
                    <div className="mt-1 text-xs font-semibold text-white/40">
                      {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(item.updatedAt))}
                    </div>
                  </button>
                )) : (
                  <p className="text-sm text-white/40 text-center py-4">还没有冒险记录</p>
                )}
              </div>
            </div>
          </aside>
        </section>}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDeleteAgent)}
        title="删除这个世界？"
        description={
          <>
            「{pendingDeleteAgent?.name}」删除后不能恢复，已保存的冒险记录仍会保留当时的世界快照。
          </>
        }
        icon={<Trash2 size={20} />}
        cancelText="先保留"
        confirmText="确认删除"
        destructive
        loading={Boolean(pendingDeleteAgent && updatingId === pendingDeleteAgent.id)}
        onCancel={() => setPendingDeleteAgent(null)}
        onConfirm={deleteAgent}
      />
    </AppShell>
  );
}

export default function MePage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-white/40" size={24} />
          </div>
        </AppShell>
      }
    >
      <MeContent />
    </Suspense>
  );
}
