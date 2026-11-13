'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Mail, X } from 'lucide-react';
import ConnectorDrawer from './ConnectorDrawer';
import ConnectorTargetSelector from './ConnectorTargetSelector';
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
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
  const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-40';
  const primary = button + ' !border-blue-600 !bg-blue-600 !text-white hover:!bg-blue-700';
  const input = 'mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50';
  const enabled = targets.filter(target => item && target.connectorIds.includes(item.id)).length;
  const dirty = Boolean(item && (replace || name !== item.name));
  const status = loading ? '正在读取' : loadFailed ? '读取失败' : dirty ? '配置待保存' : !item ? '待连接邮箱' : !verified ? '待检测连接' : enabled ? '已就绪' : '待选择入口';
  const completed = [Boolean(item) && !dirty, verified && !dirty, enabled > 0];
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await connectors.save({ toolId: item?.toolId || 'personal-mail', name, url: 'connector:personal-mail', catalogId: 'personal-mail', ...(replace ? { headers: { provider, email: email.trim(), password: password.trim() } } : {}) }, item?.id);
      setItem(result.connector); onSaved(result.connector); setPassword(''); setReplace(false); setVerified(false); setNotice('配置已保存。请检测连接，再为需要的入口开启。');
    } catch (reason: any) { setError(reason.message || '保存失败'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (!item || busy) return;
    setBusy(true); setError(''); setNotice('');
    setVerified(false);
    try { await connectors.test(item.id); setVerified(true); setNotice('连接成功：已登录邮箱并以只读方式打开收件箱。'); }
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
    <header className="flex shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white px-5 py-5 sm:px-7">
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Mail size={26} /></span>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 id="mail-drawer-title" className="text-lg font-bold text-slate-950">个人邮箱</h2><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${status === '已就绪' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{status}</span></div><p className="mt-1 text-xs text-slate-500">把邮件带进对话</p></div>
      <button type="button" aria-label="关闭邮箱配置" disabled={busy} onClick={onClose} className={button + ' !border-transparent !p-2'}><X size={19} /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
      <div className="mb-6 rounded-2xl bg-slate-900 p-5 text-white"><p className="text-sm font-semibold">连接邮箱，查找邮件与阅读正文</p><p className="mt-2 text-xs leading-6 text-slate-300">支持 QQ、网易和 Gmail。选择谁可以使用邮箱，在对话中查找需要的信息。仅提供只读访问，保留邮件未读状态。</p></div>
      <ol aria-label="连接进度" className="mb-6 grid grid-cols-3 gap-2">{['连接邮箱', '检测连接', '选择入口'].map((label, index) => <li key={label} className="space-y-2 text-center"><span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${completed[index] ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{completed[index] ? <Check size={14} /> : index + 1}</span><span className="block text-[11px] text-slate-600">{label}</span></li>)}</ol>
      {loading ? <p role="status" className="text-xs text-slate-400">正在读取配置…</p> : <div className="space-y-4">
        <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5">
          <h3 className="text-sm font-bold text-slate-950">1. 连接邮箱</h3>
          <p className="text-xs leading-6 text-slate-500">填写邮箱地址与授权码。保存后可检测连接，再选择使用入口。</p>
          <label className="block text-xs font-medium text-slate-700">连接名称<input aria-label="连接名称" className={input} value={name} disabled={busy || loadFailed} maxLength={80} onChange={event => setName(event.target.value)} /></label>
          {item && <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={replace} disabled={busy || loadFailed} onChange={event => { setReplace(event.target.checked); setPassword(''); }} className="accent-blue-600" />更换邮箱或授权码</label>}
          <label className="block text-xs font-medium text-slate-700">服务商<select aria-label="邮箱服务商" className={input} value={provider} disabled={busy || !replace || loadFailed} onChange={event => setProvider(event.target.value)}>{Object.entries(MAIL_PROVIDERS).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}</select></label>
          <label className="block text-xs font-medium text-slate-700">邮箱地址<input aria-label="邮箱地址" type="email" autoComplete="off" placeholder={provider === 'gmail' ? 'name@gmail.com' : provider === 'qq' ? 'name@qq.com' : 'name@' + (MAIL_PROVIDERS[provider as keyof typeof MAIL_PROVIDERS]?.domains[0] || '163.com')} className={input} value={email} disabled={busy || !replace || loadFailed} onChange={event => setEmail(event.target.value)} /></label>
          {replace && <label className="block text-xs font-medium text-slate-700">授权码／应用专用密码<input aria-label="授权码／应用专用密码" type="password" autoComplete="new-password" placeholder="填写邮箱授权码，不是日常登录密码" className={input} value={password} disabled={busy || loadFailed} onChange={event => setPassword(event.target.value)} /></label>}
          <p className="text-[11px] leading-5 text-slate-400">凭据加密保存，保存后不回显。</p>
          <details className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500"><summary className="cursor-pointer font-medium">如何获取授权码？</summary><div className="mt-2 space-y-2 leading-6"><p>QQ／网易：在邮箱设置中开启 IMAP 服务，按邮箱提示生成授权码。</p><p>Gmail：开启两步验证后生成应用专用密码。当前暂不支持 OAuth 和企业自定义邮箱。</p></div></details>
          <button type="button" className={primary} disabled={busy || loadFailed || !name.trim() || (replace && (!email.trim() || !password.trim()))} onClick={() => void save()}>保存配置</button>
        </section>
        <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-950">2. 检测连接</h3><button type="button" className={button} disabled={busy || !item || loadFailed || replace || name !== item.name} onClick={() => void test()}>{verified && <Check size={13} />}检测连接</button></div>
          <p className={`text-xs leading-6 ${verified && !dirty ? 'text-emerald-700' : 'text-slate-500'}`}>{dirty ? '配置有改动，请先保存后再检测。' : verified ? '连接验证通过，已以只读方式打开收件箱。' : '检测会真实登录邮箱并以只读方式打开收件箱。'}</p>
          <details className="text-xs leading-6 text-slate-500"><summary className="cursor-pointer font-medium">连接失败时检查什么？</summary><p className="mt-2">确认已开启 IMAP，并填写授权码／应用专用密码。Gmail 还需要服务器能够访问其邮箱服务；网页搜索可联网，不代表邮箱一定可连接。</p></details>
          <p className="text-[11px] leading-5 text-slate-400">支持搜索、分页与正文读取；不发送、不删除邮件。附件仅显示名称和大小。</p>
        </section>
        <ConnectorTargetSelector title="3. 选择使用入口" description="添加不会自动开启。空间开启后，该空间的成员和任务也可以读取此邮箱。"
          connectorName="邮箱" connectorId={item?.id} targets={targets} busy={busy || loadFailed} onToggle={target => void toggle(target)} />
      </div>}
    </div>
    <footer className="shrink-0 space-y-3 border-t border-slate-200/80 bg-white px-5 py-4 sm:px-7">
      {error && <p role="alert" className="break-words rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{error}</p>}
      {notice && !error && <p role="status" className="text-xs leading-5 text-emerald-700">{notice}</p>}
      <div className="flex items-center justify-between gap-3"><p aria-live="polite" className="text-[11px] leading-5 text-slate-400">{busy ? <span className="inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" />正在处理…</span> : item ? `邮箱配置已保存 · ${enabled} 个入口已开启` : '保存邮箱配置后，可稍后继续设置'}</p><button type="button" disabled={busy} onClick={onClose} className={button}>{item && verified && !dirty && enabled ? '完成配置' : '关闭'}</button></div>
    </footer>
  </ConnectorDrawer>;
}
