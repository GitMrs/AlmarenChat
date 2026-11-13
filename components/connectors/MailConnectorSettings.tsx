'use client';

import { useEffect, useState } from 'react';
import ConnectorDrawer from './ConnectorDrawer';
import { connectors, type ConnectorTarget, type PersonalConnector } from '@/lib/client/api';
import { MAIL_PROVIDERS } from '@/lib/connectors/mail-providers.mjs';

export default function MailConnectorSettings({ editing, onSaved, onClose }: { editing: PersonalConnector | null; onSaved: (item: PersonalConnector) => void; onClose: () => void }) {
  const [item, setItem] = useState(editing);
  const [provider, setProvider] = useState('qq');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(editing?.name || '个人邮箱');
  const [replace, setReplace] = useState(!editing);
  const [targets, setTargets] = useState<ConnectorTarget[]>([]);
  const [targetQuery, setTargetQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([connectors.targets(), editing ? connectors.mailStatus(editing.id) : Promise.resolve(null)]).then(([result, config]) => {
      if (!active) return;
      setTargets(result.targets);
      if (config) { setProvider(config.provider); setEmail(config.email); }
    }).catch(reason => { if (active) { setError(reason.message || '读取失败'); setLoadFailed(true); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [editing]);
  const button = 'rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-bold disabled:opacity-40';
  const input = 'mt-2 block w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:bg-slate-100';
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await connectors.save({ toolId: item?.toolId || 'personal-mail', name, url: 'connector:personal-mail', catalogId: 'personal-mail', ...(replace ? { headers: { provider, email: email.trim(), password: password.trim() } } : {}) }, item?.id);
      setItem(result.connector); onSaved(result.connector); setPassword(''); setReplace(false); setNotice('配置已保存。请检测连接，再为需要的入口开启。');
    } catch (reason: any) { setError(reason.message || '保存失败'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (!item || busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await connectors.test(item.id); setNotice('连接成功：已登录邮箱并以只读方式打开收件箱。'); }
    catch (reason: any) { setError(reason.message || '连接检测失败'); }
    finally { setBusy(false); }
  };
  const toggle = async (target: ConnectorTarget) => {
    if (!item || busy) return;
    const id = item.id;
    const enabled = !target.connectorIds.includes(id);
    setBusy(true); setError('');
    try {
      await connectors.bind(target.scope, target.scopeId, id, enabled);
      setTargets(previous => previous.map(value => value.scope === target.scope && value.scopeId === target.scopeId ? { ...value, connectorIds: enabled ? [...value.connectorIds, id] : value.connectorIds.filter(key => key !== id) } : value));
    } catch (reason: any) { setError(reason.message || '保存入口失败'); }
    finally { setBusy(false); }
  };
  return <ConnectorDrawer onClose={onClose} busy={busy} titleId="mail-drawer-title">
    <header className="flex items-center justify-between border-b p-6"><h2 id="mail-drawer-title" className="text-xl font-black">个人邮箱</h2><button className={button} disabled={busy} onClick={onClose}>关闭</button></header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
      <p className="text-sm leading-6 text-slate-500">搜索、分页和读取收件箱，不发送、不删除，也不改变未读状态。附件仅显示名称与大小。</p>
      {loading ? <p role="status">正在读取配置…</p> : <>
        <section className="space-y-4 rounded-2xl border bg-white p-5">
          <h3 className="font-bold">1. 邮箱配置</h3>
          <label className="block text-sm">连接名称<input aria-label="连接名称" className={input} value={name} disabled={busy || loadFailed} maxLength={80} onChange={event => setName(event.target.value)} /></label>
          {item && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={replace} disabled={busy || loadFailed} onChange={event => { setReplace(event.target.checked); setPassword(''); }} />更换邮箱或授权码</label>}
          <label className="block text-sm">服务商<select aria-label="邮箱服务商" className={input} value={provider} disabled={busy || !replace || loadFailed} onChange={event => setProvider(event.target.value)}>{Object.entries(MAIL_PROVIDERS).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
          <label className="block text-sm">邮箱地址<input aria-label="邮箱地址" type="email" autoComplete="off" className={input} value={email} disabled={busy || !replace || loadFailed} onChange={event => setEmail(event.target.value)} /></label>
          {replace && <label className="block text-sm">授权码／应用专用密码<input aria-label="授权码／应用专用密码" type="password" autoComplete="new-password" className={input} value={password} disabled={busy || loadFailed} onChange={event => setPassword(event.target.value)} /></label>}
          <p className="text-xs leading-5 text-slate-500">QQ／网易：先在邮箱设置中开启 IMAP，再生成授权码。Gmail：开启两步验证后生成应用专用密码；服务器须能访问 imap.gmail.com:993，网页搜索代理不等于邮箱代理。密码加密保存，保存后不回显。当前暂不支持 OAuth 与企业自定义邮箱。</p>
          <button type="button" className={button} disabled={busy || loadFailed || !name.trim() || (replace && (!email.trim() || !password.trim()))} onClick={() => void save()}>保存配置</button>
          <button type="button" className={`${button} ml-2`} disabled={busy || !item || loadFailed || replace || name !== item.name} onClick={() => void test()}>检测连接</button>
        </section>
        <section className="space-y-3 rounded-2xl border bg-white p-5"><h3 className="font-bold">2. 选择使用入口</h3><p className="text-xs leading-5 text-slate-500">添加不会自动开启。空间开启后，该空间的成员和任务也可以读取此邮箱。</p>
          <input type="search" aria-label="筛选邮箱使用入口" placeholder="搜索小伴、Agent 或空间名称" className={input} value={targetQuery} onChange={event => setTargetQuery(event.target.value)} />
          <div className="max-h-64 space-y-2 overflow-y-auto">{targets.filter(target => target.name.toLowerCase().includes(targetQuery.trim().toLowerCase())).map(target => <label key={`${target.scope}:${target.scopeId}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm"><span className="min-w-0 truncate">{target.scope === 'assistant' ? '小伴' : target.scope === 'agent' ? 'Agent' : '空间'} · {target.name}</span><input type="checkbox" aria-label={`为 ${target.name} 开启邮箱`} checked={Boolean(item && target.connectorIds.includes(item.id))} disabled={!item || busy || loadFailed} onChange={() => void toggle(target)} /></label>)}</div>
        </section>
      </>}
    </div>
    <footer className="border-t p-5" aria-live="polite">{busy && <p className="text-sm text-slate-500">正在处理…</p>}{error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}</footer>
  </ConnectorDrawer>;
}
