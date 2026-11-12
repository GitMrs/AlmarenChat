'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { connectors, type ConnectorScope, type PersonalConnector } from '@/lib/client/api';

export default function ConnectorScopeSettings({ scope, scopeId }: { scope: ConnectorScope; scopeId?: string }) {
  const [items, setItems] = useState<PersonalConnector[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    let active = true;
    setLoading(true); setBusy(false); setError(''); setItems([]); setSelected([]);
    Promise.all([connectors.list(), connectors.bindings(scope, scopeId)])
      .then(([list, bindings]) => { if (active) { setItems(list.connectors); setSelected(bindings.connectorIds); } })
      .catch(reason => { if (active) setError(reason.message || '读取连接器失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; generation.current++; };
  }, [scope, scopeId]);
  const toggle = async (id: string) => {
    if (busy) return;
    const enabled = !selected.includes(id);
    const startedGeneration = generation.current;
    setBusy(true); setError('');
    try {
      await connectors.bind(scope, scopeId, id, enabled);
      if (generation.current !== startedGeneration) return;
      setSelected(previous => enabled ? [...previous, id] : previous.filter(item => item !== id));
    } catch (reason: any) { if (generation.current === startedGeneration) setError(reason.message || '保存失败'); }
    finally { if (generation.current === startedGeneration) setBusy(false); }
  };
  return <section className="space-y-3 rounded-2xl border border-black/[0.06] bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-black text-slate-800">连接器</h3><Link href="/me?tab=connectors" className="text-xs font-bold text-indigo-700">管理我的连接器</Link></div>
    <p className="text-xs leading-5 text-slate-500">{scope === 'space' ? '开启后，本空间成员与任务可使用这些连接的账号权限。原有任务审批继续保留。' : scope === 'agent' ? '仅为你与当前 Agent 的对话开启，网页和 QQ 共用。不会授权给这个 Agent 的其他使用者。' : '仅为你的小伴开启，网页和 QQ 共用。添加连接器不会自动开启。'}</p>
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    {loading ? <p className="text-xs text-slate-400">正在读取…</p> : !error && items.length === 0 ? <p className="text-xs text-slate-400">还没有添加连接器，请先前往个人中心配置。</p> : null}
    {items.map(item => <label key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-xs"><span className="min-w-0"><span className="block truncate font-bold text-slate-700">{item.name}</span><span className="text-slate-400">{selected.includes(item.id) ? '当前入口已开启' : '当前入口未开启'}</span></span><input type="checkbox" aria-label={`为当前入口开启 ${item.name}`} checked={selected.includes(item.id)} disabled={loading || busy} onChange={() => void toggle(item.id)} className="h-4 w-4 accent-indigo-600" /></label>)}
  </section>;
}
