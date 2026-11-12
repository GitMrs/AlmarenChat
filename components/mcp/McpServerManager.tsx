'use client';

import { useEffect, useState } from 'react';
import { connectors, mcp, type PersonalConnector } from '@/lib/client/api';

export type McpDraft = { id?: string; url?: string; authType?: 'none' | 'bearer' | 'custom'; catalogId?: string };
type Props = { initialDraft?: McpDraft | null; editing?: PersonalConnector | null; onSaved?: () => void };

export default function McpServerManager({ initialDraft, editing, onSaved }: Props = {}) {
  const [toolId, setToolId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState('none');
  const [token, setToken] = useState('');
  const [headers, setHeaders] = useState([{ key: '', value: '' }]);
  const [replaceAuth, setReplaceAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setToolId(editing?.toolId || initialDraft?.id || ''); setName(editing?.name || ''); setUrl(editing?.url || initialDraft?.url || '');
    setAuthType(initialDraft?.authType || 'none'); setReplaceAuth(false); setToken(''); setHeaders([{ key: '', value: '' }]); setError(''); setNotice('');
  }, [initialDraft, editing]);
  const buildHeaders = (): Record<string, string> | undefined => {
    if (editing && !replaceAuth) return undefined;
    if (authType === 'bearer') {
      if (!token.trim()) throw new Error('请填写 Bearer Token');
      return { Authorization: `Bearer ${token.trim()}` };
    }
    if (authType === 'custom') return Object.fromEntries(headers.filter(item => item.key.trim()).map(item => [item.key.trim(), item.value]));
    return {};
  };
  const submit = async (test = false) => {
    setError(''); setNotice(''); setBusy(true);
    try {
      const authHeaders = buildHeaders();
      if (test) {
        if (editing && authHeaders === undefined) throw new Error('保留原认证时，请保存后在“已添加”中检测连接');
        const result = await mcp.test({ url: url.trim(), headers: authHeaders });
        if (!result.ok) throw new Error('连接检测失败，请检查地址和认证');
        setNotice(`检测成功，发现 ${result.tools?.length || 0} 个工具`);
      } else {
        await connectors.save({ toolId: toolId.trim(), name: name.trim() || toolId.trim(), url: url.trim(), headers: authHeaders, catalogId: initialDraft?.catalogId }, editing?.id);
        setNotice('连接已保存，请在小伴、Agent 或空间设置中单独开启。'); setToken(''); setHeaders([{ key: '', value: '' }]); onSaved?.();
      }
    } catch (reason: any) { setError(reason.message || '操作失败'); }
    finally { setBusy(false); }
  };
  const inputClass = 'h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm text-slate-700';
  return <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-4 rounded-[28px] border border-black/[0.06] bg-white p-6">
    <h3 className="text-lg font-black text-slate-900">{editing ? '修改连接配置' : '配置 HTTP MCP 连接'}</h3>
    <p className="text-xs leading-5 text-slate-500">支持 HTTPS，或平台服务器本机的 HTTP localhost / 127.0.0.1。添加不会自动为任何入口开启。</p>
    <label className="block space-y-1 text-xs font-bold text-slate-600"><span>连接标识（字母、数字、下划线、短横线）</span><input required value={toolId} disabled={Boolean(editing) || busy} onChange={event => setToolId(event.target.value)} maxLength={40} pattern="[A-Za-z0-9_-]+" className={inputClass} /></label>
    <label className="block space-y-1 text-xs font-bold text-slate-600"><span>显示名称</span><input value={name} disabled={busy} onChange={event => setName(event.target.value)} maxLength={80} className={inputClass} /></label>
    <label className="block space-y-1 text-xs font-bold text-slate-600"><span>MCP 服务地址</span><input required type="url" value={url} disabled={busy} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp" className={inputClass} /></label>
    {editing && <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={replaceAuth} disabled={busy} onChange={event => setReplaceAuth(event.target.checked)} />修改认证（默认保留已保存的认证，不回显密钥）</label>}
    {(!editing || replaceAuth) && <>
      <label className="block space-y-1 text-xs font-bold text-slate-600"><span>认证方式</span><select value={authType} disabled={busy} onChange={event => setAuthType(event.target.value)} className={inputClass}><option value="none">无需认证</option><option value="bearer">Bearer Token</option><option value="custom">自定义请求头</option></select></label>
      {authType === 'bearer' && <input type="password" aria-label="Bearer Token" autoComplete="off" value={token} disabled={busy} onChange={event => setToken(event.target.value)} className={inputClass} />}
      {authType === 'custom' && <div className="space-y-2">{headers.map((item, index) => <div key={index} className="flex gap-2"><input aria-label={`请求头名称 ${index + 1}`} placeholder="Header 名称" value={item.key} disabled={busy} onChange={event => setHeaders(rows => rows.map((row, i) => i === index ? { ...row, key: event.target.value } : row))} className={inputClass} /><input type="password" autoComplete="off" aria-label={`请求头值 ${index + 1}`} placeholder="Header 值" value={item.value} disabled={busy} onChange={event => setHeaders(rows => rows.map((row, i) => i === index ? { ...row, value: event.target.value } : row))} className={inputClass} /><button type="button" disabled={busy} onClick={() => setHeaders(rows => rows.filter((_, i) => i !== index))} aria-label={`删除请求头 ${index + 1}`} className="text-xs text-slate-500">删除</button></div>)}<button type="button" disabled={busy || headers.length >= 16} onClick={() => setHeaders(rows => [...rows, { key: '', value: '' }])} className="text-xs font-bold text-indigo-700">添加请求头</button></div>}
    </>}
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <div className="flex gap-3"><button disabled={busy} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? '处理中…' : '保存连接'}</button><button type="button" disabled={busy} onClick={() => void submit(true)} className="rounded-xl border border-black/10 px-4 py-2 text-sm font-bold text-slate-600 disabled:opacity-50">检测连接</button></div>
  </form>;
}
