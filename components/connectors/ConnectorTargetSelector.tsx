'use client';

import { useState } from 'react';
import type { ConnectorTarget } from '@/lib/client/api';

const scopeLabel = (scope: string) => scope === 'assistant' ? '小伴' : scope === 'agent' ? 'Agent' : '空间';

export default function ConnectorTargetSelector({ title, description, connectorName, connectorId, targets, onToggle,
  busy = false, canEnable = true, loading = false, error = '', hint, onRetry,
}: {
  title: string; description: string; connectorName: string; connectorId?: string;
  targets: ConnectorTarget[]; onToggle: (target: ConnectorTarget) => void;
  busy?: boolean; canEnable?: boolean; loading?: boolean; error?: string; hint?: string; onRetry?: () => void;
}) {
  const [search, setSearch] = useState('');
  const visible = targets.filter(target => `${target.name} ${scopeLabel(target.scope)}`.toLowerCase().includes(search.trim().toLowerCase()));
  const enabled = targets.filter(target => connectorId && target.connectorIds.includes(connectorId)).length;
  return <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5">
    <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-950">{title}</h3><span className="shrink-0 text-[11px] text-slate-400">已开启 {enabled} 个</span></div>
    <p className="text-xs leading-6 text-slate-500">{description}</p>
    {hint && <p className="text-xs text-amber-700">{hint}</p>}
    {error && <p role="alert" className="text-xs text-rose-600">{error}{onRetry && <button type="button" disabled={busy || loading} onClick={onRetry} className="ml-2 underline">重试读取入口</button>}</p>}
    {loading ? <p className="text-xs text-slate-400">正在读取可用入口…</p> : !error && <>
      <input type="search" aria-label="搜索使用入口" placeholder="搜索小伴、Agent 或空间" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50" />
      <div className="max-h-64 space-y-1 overflow-y-auto">{visible.map(target => {
        const checked = Boolean(connectorId && target.connectorIds.includes(connectorId));
        const disabled = busy || !connectorId || (!checked && !canEnable);
        return <label key={`${target.scope}:${target.scopeId}`} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 hover:bg-slate-50">
          <input type="checkbox" aria-label={`为${scopeLabel(target.scope)}「${target.name}」开启${connectorName}`} checked={checked} disabled={disabled} onChange={() => { if (!disabled) onToggle(target); }} className="h-4 w-4 accent-blue-600" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{target.name}</span><span className="text-[10px] text-slate-400">{scopeLabel(target.scope)}</span>
        </label>;
      })}{visible.length === 0 && <p className="p-3 text-xs text-slate-400">没有匹配的入口</p>}</div>
    </>}
  </section>;
}
