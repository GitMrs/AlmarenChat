'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronRight, Loader2, Search, Trash2, UsersRound, X } from 'lucide-react';
import Avatar from '@/components/shared/Avatar';
import type { Agent } from '@/types';

export type CreateSpaceInput = {
  name: string;
  description: string;
  instructions: string;
  agentIds: string[];
};

const PROFESSIONAL_TEAM_IDS = ['professional-product', 'professional-ux', 'professional-frontend'];

export default function CreateSpaceDialog({
  agents,
  busy,
  error,
  onClose,
  onCreate,
}: {
  agents: Agent[];
  busy: boolean;
  error?: string;
  onClose: () => void;
  onCreate: (input: CreateSpaceInput) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [selectionError, setSelectionError] = useState('');

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const selectedAgents = selectedIds.map((id) => agentById.get(id)).filter(Boolean) as Agent[];
  const categories = useMemo(
    () => ['全部', ...new Set(agents.map((agent) => agent.category || '其他'))],
    [agents]
  );
  const professionalTeam = PROFESSIONAL_TEAM_IDS.map((id) => agentById.get(id)).filter(Boolean) as Agent[];
  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return agents.filter((agent) => {
      if (category !== '全部' && (agent.category || '其他') !== category) return false;
      if (!normalizedQuery) return true;
      return [agent.name, agent.category, agent.description].some((value) =>
        value?.toLocaleLowerCase().includes(normalizedQuery)
      );
    });
  }, [agents, category, query]);

  const toggleAgent = (agentId: string) => {
    setSelectionError('');
    setSelectedIds((current) => {
      if (current.includes(agentId)) return current.filter((id) => id !== agentId);
      if (current.length >= 6) {
        setSelectionError('空间最多选择 6 位成员');
        return current;
      }
      return [...current, agentId];
    });
  };

  const selectProfessionalTeam = () => {
    setSelectionError('');
    setSelectedIds((current) => {
      const next = [...current];
      for (const agent of professionalTeam) {
        if (!next.includes(agent.id) && next.length < 6) next.push(agent.id);
      }
      return next;
    });
  };

  const moveSelected = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= selectedIds.length) return;
    const next = [...selectedIds];
    [next[index], next[target]] = [next[target], next[index]];
    setSelectedIds(next);
  };

  const submit = () => {
    if (!name.trim() || busy) return;
    onCreate({
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      agentIds: selectedIds,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 p-0 sm:items-center sm:p-6">
      <button type="button" aria-label="关闭" className="absolute inset-0" onClick={() => !busy && onClose()} />
      <section className="relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg bg-white shadow-2xl sm:max-w-2xl sm:rounded-lg">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-black/[0.06] px-5 sm:px-6">
          <div>
            <h2 className="text-base font-black text-slate-950">新建空间</h2>
            <div className="mt-1 flex items-center gap-2 text-[11px] font-black">
              <span className={step === 1 ? 'text-slate-900' : 'text-slate-400'}>1 基本信息</span>
              <ChevronRight size={12} className="text-slate-300" />
              <span className={step === 2 ? 'text-slate-900' : 'text-slate-400'}>2 空间成员</span>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} title="关闭" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-200">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {step === 1 ? (
            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-black text-slate-600">空间名称</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                  maxLength={80}
                  placeholder="例如：产品体验优化"
                  className="h-11 w-full rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-3 text-sm font-bold text-slate-800 outline-none focus:border-slate-300"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-black text-slate-600">空间描述</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="这个空间主要讨论和推进什么？"
                  className="w-full resize-none rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-3 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300"
                />
              </label>

              <div className="flex items-center gap-3 border-y border-black/[0.06] py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white">🧭</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-slate-800">空间协调者</div>
                  <div className="text-xs font-semibold text-slate-400">自动加入</div>
                </div>
                <Check size={16} className="text-emerald-600" />
              </div>

              <details className="group border-b border-black/[0.06]">
                <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm font-black text-slate-600 marker:hidden">
                  <span>高级设置</span>
                  <ChevronRight className="text-slate-300 transition-transform group-open:rotate-90" size={16} />
                </summary>
                <label className="block pb-4">
                  <span className="mb-2 block text-xs font-black text-slate-500">空间规则</span>
                  <textarea
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    maxLength={12_000}
                    rows={5}
                    placeholder="例如：所有结论标注依据；输出使用中文。"
                    className="w-full resize-y rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-3 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300"
                  />
                </label>
              </details>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                  <UsersRound size={16} />
                  已选成员
                  <span className="text-xs text-slate-400">{selectedIds.length}/6</span>
                </div>
                {professionalTeam.length === 3 && (
                  <button type="button" onClick={selectProfessionalTeam} className="h-8 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-600 hover:bg-slate-50">
                    产品 + UI + 前端
                  </button>
                )}
              </div>

              {selectedAgents.length === 0 ? (
                <div className="border-y border-dashed border-slate-200 py-6 text-center text-sm font-semibold text-slate-400">暂未选择成员</div>
              ) : (
                <div className="divide-y divide-black/[0.05] border-y border-black/[0.06]">
                  {selectedAgents.map((agent, index) => (
                    <div key={agent.id} className="flex h-12 items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">{index + 1}</span>
                      <Avatar src={agent.avatar || '🤖'} alt={agent.name} size="sm" />
                      <div className="min-w-0 flex-1 truncate text-sm font-black text-slate-700">{agent.name}</div>
                      <button type="button" onClick={() => moveSelected(index, -1)} disabled={index === 0} title="上移" className="flex h-8 w-8 items-center justify-center text-slate-400 disabled:text-slate-200"><ArrowUp size={14} /></button>
                      <button type="button" onClick={() => moveSelected(index, 1)} disabled={index === selectedAgents.length - 1} title="下移" className="flex h-8 w-8 items-center justify-center text-slate-400 disabled:text-slate-200"><ArrowDown size={14} /></button>
                      <button type="button" onClick={() => toggleAgent(agent.id)} title="移除" className="flex h-8 w-8 items-center justify-center text-slate-400 hover:text-rose-500"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索成员" className="h-10 w-full rounded-lg border border-black/[0.08] bg-[#fbfaf7] pl-9 pr-3 text-sm font-medium outline-none focus:border-slate-300" />
                </div>
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-3 text-sm font-bold text-slate-600 outline-none">
                  {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>

              <div className="max-h-64 divide-y divide-black/[0.05] overflow-y-auto border-y border-black/[0.06]">
                {filteredAgents.length === 0 && <div className="py-8 text-center text-sm font-semibold text-slate-400">没有匹配成员</div>}
                {filteredAgents.map((agent) => {
                  const selected = selectedIds.includes(agent.id);
                  return (
                    <button key={agent.id} type="button" onClick={() => toggleAgent(agent.id)} className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-slate-50">
                      <Avatar src={agent.avatar || '🤖'} alt={agent.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-slate-700">{agent.name}</div>
                        <div className="truncate text-xs font-semibold text-slate-400">{agent.category || 'Agent'}</div>
                      </div>
                      <span className={`flex h-5 w-5 items-center justify-center rounded border ${selected ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 text-transparent'}`}>
                        <Check size={12} />
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectionError && <div className="text-xs font-semibold text-rose-600">{selectionError}</div>}
            </div>
          )}

          {error && <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{error}</div>}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-black/[0.06] px-5 py-4 sm:px-6">
          {step === 1 ? (
            <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-3 text-xs font-black text-slate-500 hover:bg-slate-100">取消</button>
          ) : (
            <button type="button" onClick={() => setStep(1)} disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-black text-slate-500 hover:bg-slate-100">
              <ArrowLeft size={14} />上一步
            </button>
          )}
          {step === 1 ? (
            <button type="button" onClick={() => setStep(2)} disabled={!name.trim()} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-slate-950 px-4 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-400">
              选择成员<ArrowRight size={14} />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={busy || !name.trim()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-400">
              {busy && <Loader2 className="animate-spin" size={14} />}
              创建空间
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
