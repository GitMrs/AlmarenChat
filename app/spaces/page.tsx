'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, PanelsTopLeft, Plus, Search, Trash2, UsersRound } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import LoginRequired from '@/components/auth/LoginRequired';
import Avatar from '@/components/shared/Avatar';
import { spaces as spacesApi, agents as agentsApi } from '@/lib/api';
import { getBuiltInAgents } from '@/lib/agents-data';
import type { Agent } from '@/types';

function formatTime(value: string) {
  const date = new Date(value);
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

export default function SpacesPage() {
  const router = useRouter();
  const [spaces, setSpaces] = useState<any[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!localStorage.getItem('token')) {
      setNeedsLogin(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [spaceResult, builtIn, customResult] = await Promise.all([
        spacesApi.list(),
        getBuiltInAgents(),
        agentsApi.mine().catch(() => ({ agents: [] })),
      ]);
      setSpaces(spaceResult.spaces);
      setAgents([...customResult.agents, ...builtIn]);
    } catch (err: any) {
      setError(err.message || '加载空间失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const filteredSpaces = query.trim()
    ? spaces.filter((space) => `${space.name} ${space.description || ''}`.toLowerCase().includes(query.toLowerCase()))
    : spaces;

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId].slice(0, 6)
    );
  };

  const createSpace = async () => {
    if (!name.trim() || creating) return;

    setCreating(true);
    setError('');
    try {
      const result = await spacesApi.create({
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        agentIds: selectedAgentIds,
      });
      router.push(`/spaces/${result.space.id}`);
    } catch (err: any) {
      setError(err.message || '创建空间失败');
    } finally {
      setCreating(false);
    }
  };

  const deleteSpace = async (spaceId: string) => {
    if (!window.confirm('确定删除这个空间吗？空间消息和成员记录会一起删除。')) return;
    await spacesApi.delete(spaceId);
    setSpaces((items) => items.filter((item) => item.id !== spaceId));
  };

  return (
    <AppShell>
      <div className="space-y-8 py-8">
        <section className="rounded-[32px] border border-black/[0.06] bg-white/82 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
                <PanelsTopLeft size={16} />
                空间
              </div>
              <h1 className="text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
                把相关 Agent 放进同一个上下文。
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-500">
                空间不是项目管理，它是一个轻量协作房间：成员、资料和对话在这里一起沉淀。
              </p>
            </div>

            <div className="relative min-w-0 flex-1 lg:max-w-md">
              <Search size={19} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索空间..."
                className="h-14 w-full rounded-full border border-black/[0.08] bg-[#fbfaf7] pl-13 pr-5 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
              />
            </div>
          </div>
        </section>

        {needsLogin ? (
          <LoginRequired title="登录后使用空间" description="空间会保存成员、消息和资料，需要登录后使用。" />
        ) : loading ? (
          <div className="flex justify-center py-24 text-slate-400">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-400">Spaces</p>
                  <h2 className="text-2xl font-black text-slate-950">我的空间</h2>
                </div>
              </div>

              {error && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div>}

              {filteredSpaces.length === 0 ? (
                <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-10 text-center text-slate-400">
                  还没有空间。先在右侧创建一个。
                </div>
              ) : (
                <div className="grid gap-4">
                  {filteredSpaces.map((space) => {
                    const members = space.members || [];
                    const lastMessage = space.messages?.[0];
                    return (
                      <article
                        key={space.id}
                        className="overflow-hidden rounded-[28px] border border-black/[0.06] bg-white shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() => router.push(`/spaces/${space.id}`)}
                          className="flex w-full items-center gap-4 p-5 text-left transition hover:bg-[#fbfaf7]"
                        >
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-slate-950 text-white">
                            <PanelsTopLeft size={22} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <h3 className="truncate text-lg font-black text-slate-950">{space.name}</h3>
                              <span className="shrink-0 text-xs font-semibold text-slate-400">{formatTime(space.updatedAt)}</span>
                            </div>
                            <p className="line-clamp-1 text-sm text-slate-500">
                              {lastMessage?.content || space.description || '还没有对话，进入空间开始协作。'}
                            </p>
                            <div className="mt-3 flex items-center gap-2">
                              <div className="flex -space-x-2">
                                {members.slice(0, 5).map((member: any) => {
                                  const agent = agentById.get(member.agentId);
                                  return (
                                    <Avatar
                                      key={member.id}
                                      src={agent?.avatar || '🤖'}
                                      alt={agent?.name || 'Agent'}
                                      size="sm"
                                      className="border-2 border-white"
                                    />
                                  );
                                })}
                              </div>
                              <span className="text-xs font-bold text-slate-400">{members.length} 个 Agent</span>
                            </div>
                          </div>
                          <ArrowRight size={18} className="text-slate-300" />
                        </button>
                        <div className="flex justify-end border-t border-black/[0.04] px-5 py-2">
                          <button
                            type="button"
                            onClick={() => deleteSpace(space.id)}
                            className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-bold text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                          >
                            <Trash2 size={13} />
                            删除
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <aside className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <Plus size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950">新建空间</h2>
                  <p className="text-sm text-slate-500">先选一个主题，再拉几个 Agent。</p>
                </div>
              </div>

              <div className="space-y-4">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：末日无期互动故事"
                  className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-bold text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                />
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="这个空间要一起推进什么？"
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                />
                <div>
                  <label htmlFor="space-instructions" className="mb-2 block text-sm font-black text-slate-700">
                    空间规则
                  </label>
                  <textarea
                    id="space-instructions"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    maxLength={12_000}
                    placeholder="例如：使用 TypeScript；修改后运行类型检查；所有报告使用中文。"
                    rows={4}
                    className="w-full resize-y rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                  />
                </div>

                <div>
                  <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-700">
                    <UsersRound size={16} />
                    初始成员
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {agents.slice(0, 30).map((agent) => {
                      const selected = selectedAgentIds.includes(agent.id);
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() => toggleAgent(agent.id)}
                          className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition ${
                            selected ? 'border-slate-950 bg-slate-950 text-white' : 'border-black/[0.06] bg-[#fbfaf7] text-slate-700 hover:bg-white'
                          }`}
                        >
                          <Avatar src={agent.avatar || '🤖'} alt={agent.name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black">{agent.name}</div>
                            <div className={`truncate text-xs font-semibold ${selected ? 'text-white/65' : 'text-slate-400'}`}>
                              {agent.category || 'Agent'}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={createSpace}
                  disabled={!name.trim() || creating}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:bg-slate-200 disabled:text-slate-400 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
                >
                  {creating ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  创建空间
                </button>
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}
