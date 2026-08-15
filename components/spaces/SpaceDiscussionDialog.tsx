'use client';

import { ArrowDown, ArrowUp, Check, Globe2, Loader2, MessagesSquare, X } from 'lucide-react';
import Avatar from '@/components/shared/Avatar';
import type { Agent } from '@/types';

export default function SpaceDiscussionDialog({
  agents,
  topic,
  selectedIds,
  allowWeb,
  busy,
  error,
  onTopicChange,
  onSelectedIdsChange,
  onAllowWebChange,
  onClose,
  onStart,
}: {
  agents: Agent[];
  topic: string;
  selectedIds: string[];
  allowWeb: boolean;
  busy: boolean;
  error?: string;
  onTopicChange: (value: string) => void;
  onSelectedIdsChange: (ids: string[]) => void;
  onAllowWebChange: (value: boolean) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const selectedAgents = selectedIds.map((id) => byId.get(id)).filter(Boolean) as Agent[];

  const toggle = (agentId: string) => {
    if (selectedIds.includes(agentId)) {
      onSelectedIdsChange(selectedIds.filter((id) => id !== agentId));
    } else if (selectedIds.length < 4) {
      onSelectedIdsChange([...selectedIds, agentId]);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= selectedIds.length) return;
    const next = [...selectedIds];
    [next[index], next[target]] = [next[target], next[index]];
    onSelectedIdsChange(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 p-0 sm:items-center sm:p-6">
      <button type="button" aria-label="关闭" className="absolute inset-0" onClick={onClose} />
      <section className="relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-lg bg-white shadow-2xl sm:max-w-lg sm:rounded-lg">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.06] px-5">
          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
            <MessagesSquare size={17} />
            发起讨论
          </div>
          <button type="button" onClick={onClose} title="关闭" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <label className="block">
            <span className="mb-2 block text-xs font-black text-slate-500">讨论主题</span>
            <textarea
              value={topic}
              onChange={(event) => onTopicChange(event.target.value)}
              rows={4}
              autoFocus
              placeholder="例如：新首页应该如何调整信息结构？"
              className="w-full resize-none rounded-lg border border-black/[0.08] bg-slate-50 px-3 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300"
            />
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between text-xs font-black text-slate-500">
              <span>参与成员</span>
              <span className="text-slate-300">{selectedIds.length}/4</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {agents.map((agent) => {
                const checked = selectedIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggle(agent.id)}
                    className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left ${checked ? 'border-slate-900 bg-slate-50' : 'border-black/[0.06] bg-white'}`}
                  >
                    <Avatar src={agent.avatar || 'AI'} alt={agent.name} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-xs font-black text-slate-700">{agent.name}</span>
                    {checked && <Check className="shrink-0 text-slate-900" size={14} />}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedAgents.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-black text-slate-500">第一轮顺序</div>
              <div className="divide-y divide-black/[0.05] border-y border-black/[0.06]">
                {selectedAgents.map((agent, index) => (
                  <div key={agent.id} className="flex h-11 items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-500">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-700">{agent.name}</span>
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0} title="上移" className="flex h-8 w-8 items-center justify-center text-slate-400 disabled:text-slate-200"><ArrowUp size={15} /></button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === selectedAgents.length - 1} title="下移" className="flex h-8 w-8 items-center justify-center text-slate-400 disabled:text-slate-200"><ArrowDown size={15} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-center justify-between gap-4 border-y border-black/[0.06] py-3">
            <span className="flex items-center gap-2 text-sm font-black text-slate-700"><Globe2 size={16} />允许本次讨论联网</span>
            <input type="checkbox" checked={allowWeb} onChange={(event) => onAllowWebChange(event.target.checked)} className="h-4 w-4 accent-slate-950" />
          </label>

          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{error}</div>}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-black/[0.06] px-5 py-4">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-lg px-4 text-xs font-black text-slate-500 hover:bg-slate-100">取消</button>
          <button type="button" onClick={onStart} disabled={busy || !topic.trim() || selectedIds.length < 2} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-400">
            {busy && <Loader2 className="animate-spin" size={14} />}
            开始讨论
          </button>
        </footer>
      </section>
    </div>
  );
}
