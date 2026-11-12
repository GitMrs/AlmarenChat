'use client';

import { useEffect, useState } from 'react';
import { Blocks } from 'lucide-react';
import McpServerManager, { type McpDraft } from '@/components/mcp/McpServerManager';
import FeishuConnectorSettings from '@/components/connectors/FeishuConnectorSettings';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { connectors, type PersonalConnector } from '@/lib/client/api';
import { cn } from '@/lib/client/utils';
import { CONNECTOR_CATALOG as catalog } from '@/lib/connectors/catalog.mjs';

export default function ConnectorCenter() {
  const [tab, setTab] = useState<'added' | 'builtin' | 'custom'>('added');
  const [items, setItems] = useState<PersonalConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [editing, setEditing] = useState<PersonalConnector | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PersonalConnector | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const load = async () => {
    setLoading(true); setError('');
    try { setItems((await connectors.list()).connectors); }
    catch (reason: any) { setError(reason.message || '读取连接器失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const configure = (item: PersonalConnector) => { setEditing(item); setDraft(null); setTab(item.catalogId ? 'builtin' : 'custom'); };
  const test = async (item: PersonalConnector) => {
    setBusy(true);
    try { const result = await connectors.test(item.id); setResults(previous => ({ ...previous, [item.id]: result.ok ? `检测成功，发现 ${result.tools?.length || 0} 个工具` : '连接检测失败' })); }
    catch (reason: any) { setResults(previous => ({ ...previous, [item.id]: reason.message || '连接检测失败' })); }
    finally { setBusy(false); }
  };
  const saved = () => { setEditing(null); setDraft(null); setTab('added'); void load(); };
  const visible = catalog.filter(item => (category === '全部' || item.category === category) && `${item.name} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const buttonClass = 'rounded-xl border border-black/10 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40';
  return <div className="space-y-5">
    <section className="space-y-4 rounded-[28px] border border-black/[0.06] bg-white p-6"><div className="flex items-center gap-3"><Blocks className="text-indigo-600" /><h2 className="text-xl font-black text-slate-950">我的连接器</h2></div><p className="text-sm leading-6 text-slate-500">在这里添加和配置连接；在小伴、各 Agent 和空间设置中分别开启。</p><div className="flex flex-wrap gap-2">{([{ id: 'added', label: `已添加（${items.length}）` }, { id: 'builtin', label: '内置连接器' }, { id: 'custom', label: '自定义' }] as const).map(item => <button key={item.id} type="button" onClick={() => { setTab(item.id); setEditing(null); setDraft(null); }} className={cn(buttonClass, tab === item.id && 'bg-slate-950 text-white')}>{item.label}</button>)}</div></section>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-600">{error}<button type="button" onClick={() => void load()} className="ml-3 underline">重试</button></p>}
    {loading && <p className="text-sm text-slate-400">正在读取连接器…</p>}
    {tab === 'added' && !loading && !error && <section className="grid gap-4 md:grid-cols-2">
      {items.length === 0 && <p className="rounded-2xl border border-dashed border-black/10 bg-white p-8 text-sm text-slate-500">还没有添加连接器。可在“内置连接器”中选择接入方式，或在“自定义”中填写配置。</p>}
      {items.map(item => <article key={item.id} className="min-w-0 space-y-3 rounded-[24px] border border-black/[0.06] bg-white p-5"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-slate-900">{item.name}</h3><span className="text-xs text-slate-400">{item.catalogId ? '内置' : '自定义'} · {item.hasHeaders ? '已配置认证' : '无需认证'}</span></div><p className="truncate text-xs text-slate-500">{item.toolId}</p><p className="text-xs text-slate-400">{(() => { try { return item.catalogId === 'feishu-cli' ? '官方飞书 CLI · Linux / Windows' : new URL(item.url).origin; } catch { return 'HTTP MCP'; } })()}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => configure(item)} className={buttonClass}>修改配置</button><button type="button" disabled={busy} onClick={() => void test(item)} className={buttonClass}>检测连接</button><button type="button" disabled={busy} onClick={() => setPendingDelete(item)} className={buttonClass}>删除</button></div>{results[item.id] && <p role="status" className="text-xs text-slate-600">{results[item.id]}</p>}</article>)}
    </section>}
    {tab === 'builtin' && <section className="space-y-4"><p className="text-xs leading-5 text-slate-500">可添加 HTTP MCP 服务，或配置飞书 CLI 应用并完成用户授权。添加后在各入口单独开启。</p><div className="flex flex-wrap gap-2"><input type="search" aria-label="搜索内置连接器" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索连接器" className="h-10 rounded-xl border border-black/10 px-3 text-sm" /><select aria-label="连接器分类" value={category} onChange={event => setCategory(event.target.value)} className="rounded-xl border border-black/10 px-3 text-sm">{['全部', '办公', '通用', '自部署'].map(value => <option key={value}>{value}</option>)}</select></div><div className="grid gap-4 md:grid-cols-2">{visible.map(item => {
      const added = items.find(connection => connection.catalogId === item.id);
      return <article key={item.id} className="space-y-3 rounded-[24px] border border-black/[0.06] bg-white p-5"><h3 className="font-black text-slate-900">{item.name}</h3><p className="text-sm leading-6 text-slate-500">{item.description}</p><button type="button" disabled={loading || Boolean(error)} onClick={() => { if (added) configure(added); else { setEditing(null); setDraft({ id: item.id, url: item.url, authType: item.authType, catalogId: item.id }); } }} className={buttonClass}>{added ? '已添加 · 修改配置' : '添加'}</button></article>;
    })}</div>{visible.length === 0 && <p className="text-sm text-slate-400">没有匹配的连接器。</p>}{(draft || editing) && ((draft?.catalogId || editing?.catalogId) === 'feishu-cli' ? <FeishuConnectorSettings editing={editing} onSaved={saved} /> : <McpServerManager initialDraft={draft} editing={editing} onSaved={saved} />)}</section>}
    {tab === 'custom' && <McpServerManager initialDraft={draft} editing={editing} onSaved={saved} />}
    <ConfirmDialog open={Boolean(pendingDelete)} title="删除连接器？" description={`删除「${pendingDelete?.name || ''}」后，小伴、Agent 和空间对它的开启关系都会移除，后续调用将不可用。`} confirmText="删除" destructive loading={busy} onCancel={() => setPendingDelete(null)} onConfirm={async () => {
      if (!pendingDelete || busy) return;
      setBusy(true);
      try { await connectors.delete(pendingDelete.id); setPendingDelete(null); await load(); }
      catch (reason: any) { setError(reason.message || '删除失败'); }
      finally { setBusy(false); }
    }} />
  </div>;
}
