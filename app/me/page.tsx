'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Bot,
  Clock3,
  Edit3,
  Heart,
  Loader2,
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
      setError(err.message || '删除 Agent 失败');
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
        <section className="rounded-[32px] border border-black/[0.06] bg-white/82 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
                <Sparkles size={16} />
                我的空间
              </div>
              <h1 className="text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
                管理你的 Agent、模型和账号。
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-500">
                这里是用户自己的空间。创建后的 Agent 默认先在这里维护，账号和模型配置也统一放在这里。
              </p>
            </div>

            <button
              onClick={() => router.push('/create-agent')}
              className="inline-flex w-fit cursor-pointer items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <Plus size={17} />
              创建新 Agent
            </button>
          </div>
        </section>

        <section className="flex flex-wrap gap-2 rounded-[28px] border border-black/[0.06] bg-white p-2 shadow-sm">
          {[
            { id: 'assets', label: '我的资产', icon: Bot },
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
                  active ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'
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
        </section>}

        {error && (
          <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
            {error}
          </div>
        )}

        {needsLogin && (
          <LoginRequired
            title="登录后维护你的 Agent"
            description="我的空间会保存你创建的 Agent、发布状态、收藏和最近会话。登录后就能继续维护。"
          />
        )}

        {!needsLogin && activeTab === 'settings' && <SettingsPanel />}

        {!needsLogin && activeTab === 'assets' && <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-400">My Agents</p>
                <h2 className="text-2xl font-black text-slate-950">我创建的 Agent</h2>
              </div>
              <button
                onClick={() => router.push('/create-agent')}
                className="hidden cursor-pointer items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:text-slate-950 sm:flex"
              >
                新建 Agent
                <ArrowRight size={15} />
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center rounded-[28px] border border-black/[0.06] bg-white py-20 text-slate-400">
                <Loader2 className="animate-spin" size={24} />
              </div>
            ) : myAgents.length > 0 ? (
              <div className="grid gap-4">
                {myAgents.map((agent) => {
                  const isUpdating = updatingId === agent.id;
                  return (
                    <article
                      key={agent.id}
                      className="cursor-default overflow-hidden rounded-[28px] border border-black/[0.06] bg-white shadow-sm"
                    >
                      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-[#fbfaf7] text-3xl shadow-sm">
                          {agent.avatar || '🤖'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-black text-slate-950">{agent.name}</h3>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                                agent.isPublic ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {agent.isPublic ? '已发布' : '私有'}
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                              <Clock3 size={13} />
                              {formatDate(agent.updatedAt)}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-sm leading-6 text-slate-500">{agent.description || '还没有简介。'}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            onClick={() => router.push(`/create-agent?agentId=${agent.id}`)}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm"
                          >
                            <Edit3 size={15} />
                            编辑
                          </button>
                          <button
                            onClick={() => router.push(`/chat/${agent.id}`)}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm"
                          >
                            <MessageSquare size={15} />
                            测试
                          </button>
                          <button
                            onClick={() => togglePublish(agent)}
                            disabled={isUpdating}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm disabled:cursor-default disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            {isUpdating ? <Loader2 className="animate-spin" size={15} /> : <Rocket size={15} />}
                            {agent.isPublic ? '下架' : '发布'}
                          </button>
                          <button
                            onClick={() => setPendingDeleteAgent(agent)}
                            disabled={isUpdating}
                            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-rose-100 bg-rose-50 text-rose-500 shadow-sm transition hover:bg-rose-100 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-300"
                            title="删除 Agent"
                            aria-label="删除 Agent"
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
              <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-12 text-center">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-3xl bg-[#fbfaf7] text-slate-400">
                  <Bot size={24} />
                </div>
                <h3 className="text-lg font-black text-slate-950">还没有创建 Agent</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">先创建一个私有 Agent，测试满意后再发布到广场。</p>
                <button
                  onClick={() => router.push('/create-agent')}
                  className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white"
                >
                  <Plus size={16} />
                  创建 Agent
                </button>
              </div>
            )}
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
                {favoriteAgents.length > 0 ? favoriteAgents.map((fav) => {
                  const agent = fav.agent;
                  return (
                    <button
                      key={fav.id}
                      onClick={() => router.push(`/chat/${agent.id}`)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-[#fbfaf7] p-3 text-left transition hover:bg-slate-100"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-xl">
                        {agent.avatar || '🤖'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-slate-950">{agent.name}</div>
                        <div className="truncate text-xs text-slate-500">{agent.description}</div>
                      </div>
                      <ArrowRight size={15} className="text-slate-300" />
                    </button>
                  );
                }) : (
                  <p className="text-sm text-slate-400 text-center py-4">还没有收藏 Agent</p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-black/[0.06] bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-950">最近会话</h3>
                <button
                  onClick={() => router.push('/conversations')}
                  className="cursor-pointer text-xs font-bold text-slate-400 hover:text-slate-950"
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
                    className="w-full cursor-pointer rounded-2xl bg-[#fbfaf7] p-3 text-left transition hover:bg-slate-100"
                  >
                    <div className="truncate text-sm font-black text-slate-950">{item.title || '新对话'}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{item.agentName || '未知 Agent'}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-400">
                      {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(item.updatedAt))}
                    </div>
                  </button>
                )) : (
                  <p className="text-sm text-slate-400 text-center py-4">还没有会话记录</p>
                )}
              </div>
            </div>
          </aside>
        </section>}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDeleteAgent)}
        title="删除这个 Agent？"
        description={
          <>
            「{pendingDeleteAgent?.name}」删除后不能恢复，已保存的历史会话仍会保留当时的 Agent 快照。
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
            <Loader2 className="animate-spin text-slate-400" size={24} />
          </div>
        </AppShell>
      }
    >
      <MeContent />
    </Suspense>
  );
}
