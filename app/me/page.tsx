'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Bot,
  Clock3,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Globe2,
  Heart,
  Link2Off,
  Loader2,
  MessageSquare,
  PanelsTopLeft,
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
import { agents as agentsApi, auth, conversations as conversationsApi, favorites as favoritesApi, spaceShares as spaceSharesApi, spaces as spacesApi } from '@/lib/api';
import type { Agent, SpaceFileShare } from '@/types';
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
  const requestedTab = searchParams.get('tab');
  const activeTab = requestedTab === 'settings' || requestedTab === 'shares' ? requestedTab : 'assets';
  const [myAgents, setMyAgents] = useState<Agent[]>([]);
  const [favoriteAgents, setFavoriteAgents] = useState<any[]>([]);
  const [recentConversations, setRecentConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [uploadingKnowledgeId, setUploadingKnowledgeId] = useState<string | null>(null);
  const [knowledgeNotice, setKnowledgeNotice] = useState('');
  const [pendingDeleteAgent, setPendingDeleteAgent] = useState<Agent | null>(null);
  const [sharedPages, setSharedPages] = useState<SpaceFileShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareActionId, setShareActionId] = useState<string | null>(null);
  const [pendingDisableShare, setPendingDisableShare] = useState<SpaceFileShare | null>(null);
  const [shareError, setShareError] = useState('');
  const [shareNotice, setShareNotice] = useState('');

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
          conversationsApi.list({ limit: 5, includeLastMessage: false }).then((result) => setRecentConversations(result.conversations)),
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

  useEffect(() => {
    if (activeTab !== 'shares' || !localStorage.getItem('token')) return;
    let active = true;
    setSharesLoading(true);
    setShareError('');
    spaceSharesApi.list()
      .then((result) => {
        if (active) setSharedPages(result.shares);
      })
      .catch((err: any) => {
        if (active) setShareError(err.message || '加载网页共享失败');
      })
      .finally(() => {
        if (active) setSharesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab]);

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

  const uploadKnowledge = async (agent: Agent, file?: File) => {
    if (!file || uploadingKnowledgeId) return;

    setUploadingKnowledgeId(agent.id);
    setError('');
    setKnowledgeNotice('');

    try {
      const result = await agentsApi.uploadKnowledge(agent.id, file);
      setKnowledgeNotice(`已为「${agent.name}」上传 ${file.name}，生成 ${result.chunkCount} 个知识片段。`);
      window.setTimeout(() => setKnowledgeNotice(''), 4000);
    } catch (err: any) {
      setError(err.message || '上传知识库失败');
    } finally {
      setUploadingKnowledgeId(null);
    }
  };

  const disableShare = async () => {
    if (!pendingDisableShare || shareActionId) return;
    setShareActionId(pendingDisableShare.id);
    setShareError('');
    setShareNotice('');
    try {
      await spacesApi.disableFileShare(pendingDisableShare.spaceId, pendingDisableShare.id);
      setSharedPages((items) => items.filter((item) => item.id !== pendingDisableShare.id));
      setShareNotice(`已关闭「${pendingDisableShare.fileName}」的公开共享`);
      setPendingDisableShare(null);
    } catch (err: any) {
      setShareError(err.message || '关闭网页共享失败');
    } finally {
      setShareActionId(null);
    }
  };

  const copyShareLink = async (item: SpaceFileShare) => {
    try {
      await navigator.clipboard.writeText(new URL(item.url, window.location.origin).toString());
      setShareError('');
      setShareNotice(`已复制「${item.fileName}」的共享链接`);
    } catch {
      setShareError('复制共享链接失败');
    }
  };

  const switchTab = (tab: 'assets' | 'shares' | 'settings') => {
    router.push(tab === 'assets' ? '/me' : `/me?tab=${tab}`);
  };

  return (
    <AppShell>
      <div className="space-y-8 py-8">
        <section className="rounded-[32px] border border-black/[0.06] bg-white/82 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
                <Sparkles size={16} />
                个人中心
              </div>
              <h1 className="text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
                管理你的 Agent、网页共享和账号。
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-500">
                在这里维护你创建的 Agent、公开网页和账号配置。
              </p>
            </div>

            {activeTab === 'assets' && (
              <button
                onClick={() => router.push('/create-agent')}
                className="inline-flex w-fit cursor-pointer items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <Plus size={17} />
                创建新 Agent
              </button>
            )}
          </div>
        </section>

        <section className="flex flex-wrap gap-2 rounded-[28px] border border-black/[0.06] bg-white p-2 shadow-sm">
          {[
            { id: 'assets', label: '我的资产', icon: Bot },
            { id: 'shares', label: '网页共享', icon: Globe2 },
            { id: 'settings', label: '账号设置', icon: SlidersHorizontal },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id as 'assets' | 'shares' | 'settings')}
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

        {knowledgeNotice && (
          <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            {knowledgeNotice}
          </div>
        )}

        {needsLogin && (
          <LoginRequired
            title="登录后维护你的 Agent"
            description="个人中心会保存你创建的 Agent、发布状态、收藏和最近会话。登录后就能继续维护。"
          />
        )}

        {!needsLogin && activeTab === 'settings' && <SettingsPanel />}

        {!needsLogin && activeTab === 'shares' && (
          <section className="space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-bold text-slate-400">Shared Pages</p>
                <h2 className="text-2xl font-black text-slate-950">网页共享</h2>
                <p className="mt-2 text-sm text-slate-500">集中管理从不同空间公开的 HTML 网页。</p>
              </div>
              {!sharesLoading && sharedPages.length > 0 && (
                <div className="text-sm font-bold text-slate-400">共 {sharedPages.length} 个</div>
              )}
            </div>

            {shareError && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{shareError}</div>}
            {shareNotice && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{shareNotice}</div>}

            {sharesLoading ? (
              <div className="flex items-center justify-center py-20 text-slate-400"><Loader2 className="animate-spin" size={24} /></div>
            ) : shareError ? null : sharedPages.length > 0 ? (
              <div className="grid gap-3">
                {sharedPages.map((item) => {
                  const busy = shareActionId === item.id;
                  return (
                    <article key={item.id} className="flex flex-col gap-4 rounded-lg border border-black/[0.07] bg-white p-4 shadow-sm sm:flex-row sm:items-center">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                        <Globe2 size={19} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-black text-slate-950">{item.fileName}</h3>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">共享中</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-400">
                          <span className="inline-flex items-center gap-1"><PanelsTopLeft size={12} />{item.spaceName}</span>
                          {item.sharedAt && <span>开启于 {formatDate(item.sharedAt)}</span>}
                          {item.updatedAt && <span>更新于 {formatDate(item.updatedAt)}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button type="button" onClick={() => copyShareLink(item)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-950">
                          <Copy size={14} />复制链接
                        </button>
                        <button type="button" onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-950">
                          <ExternalLink size={14} />打开网页
                        </button>
                        <button type="button" onClick={() => router.push(`/spaces/${item.spaceId}`)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-950">
                          <PanelsTopLeft size={14} />所属空间
                        </button>
                        <button type="button" onClick={() => setPendingDisableShare(item)} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-50 px-3 text-xs font-black text-rose-600 transition hover:bg-rose-100 disabled:text-rose-300">
                          {busy ? <Loader2 className="animate-spin" size={14} /> : <Link2Off size={14} />}关闭共享
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="border-y border-black/[0.06] py-16 text-center">
                <Globe2 className="mx-auto text-slate-300" size={28} />
                <h3 className="mt-4 text-base font-black text-slate-950">还没有公开网页</h3>
                <p className="mt-2 text-sm text-slate-500">在空间中打开 HTML 文件，通过“公开共享”开关发布网页。</p>
                <button type="button" onClick={() => router.push('/spaces')} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white">
                  <PanelsTopLeft size={15} />前往空间
                </button>
              </div>
            )}
          </section>
        )}

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
                  const isUploadingKnowledge = uploadingKnowledgeId === agent.id;
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
                          <label
                            className={cn(
                              'inline-flex cursor-pointer items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm',
                              isUploadingKnowledge && 'cursor-default text-slate-400'
                            )}
                          >
                            {isUploadingKnowledge ? <Loader2 className="animate-spin" size={15} /> : <FileText size={15} />}
                            知识库
                            <input
                              type="file"
                              accept=".txt,.md,text/plain,text/markdown"
                              className="hidden"
                              disabled={isUploadingKnowledge}
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                uploadKnowledge(agent, file);
                              }}
                            />
                          </label>
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

          <aside className="min-w-0 space-y-5">
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
                    className="w-full min-w-0 max-w-full cursor-pointer overflow-hidden rounded-2xl bg-[#fbfaf7] p-3 text-left transition hover:bg-slate-100"
                  >
                    <div className="block min-w-0 max-w-full truncate text-sm font-black text-slate-950">{item.title || '新对话'}</div>
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
      <ConfirmDialog
        open={Boolean(pendingDisableShare)}
        title="关闭这个网页共享？"
        description={`关闭后，「${pendingDisableShare?.fileName || ''}」的现有共享链接会立即失效。`}
        icon={<Link2Off size={20} />}
        cancelText="继续共享"
        confirmText="关闭共享"
        destructive
        loading={Boolean(pendingDisableShare && shareActionId === pendingDisableShare.id)}
        onCancel={() => setPendingDisableShare(null)}
        onConfirm={disableShare}
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
