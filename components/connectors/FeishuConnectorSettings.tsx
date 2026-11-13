'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, ExternalLink, Loader2, X } from 'lucide-react';
import ConnectorDrawer from './ConnectorDrawer';
import FeishuMark from './FeishuMark';
import FeishuAdvanced from './FeishuAdvanced';
import { connectors, type ConnectorTarget, type FeishuRuntime, type PersonalConnector } from '@/lib/client/api';
import { FEISHU_AUTH_DOMAINS } from '@/lib/connectors/feishu-auth-domains.mjs';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-40';
const primaryClass = `${buttonClass} !border-blue-600 !bg-blue-600 !text-white hover:!bg-blue-700`;
const scopeLabel = (scope: string) => scope === 'assistant' ? '小伴' : scope === 'agent' ? 'Agent' : '空间';

function showAuthorizationLoading(popup: Window) {
  try {
    const doc = popup.document;
    doc.title = '正在准备飞书授权';
    doc.documentElement.lang = 'zh-CN';
    const main = doc.createElement('main');
    main.style.cssText = 'max-width:480px;margin:15vh auto;padding:24px;font-family:system-ui,sans-serif;color:#334155;line-height:1.8';
    const heading = doc.createElement('h1');
    heading.style.cssText = 'font-size:20px;color:#0f172a';
    heading.textContent = '正在准备飞书授权…';
    const message = doc.createElement('p');
    message.textContent = '正在获取授权链接，准备好后会自动跳转到飞书。若等待较久，请返回原页面查看进度或错误提示。';
    main.append(heading, message);
    doc.body.replaceChildren(main);
  } catch { /* Some browsers restrict access to new windows; the original page retains progress and a fallback link. */ }
}

export default function FeishuConnectorSettings({ editing, onSaved, onClose }: {
  editing: PersonalConnector | null; onSaved: (connector: PersonalConnector) => void; onClose: () => void;
}) {
  const [connection, setConnection] = useState(editing);
  const [name, setName] = useState(editing?.name || '飞书');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [auth, setAuth] = useState<{ url: string; code?: string; expiresAt: number } | null>(null);
  const [authDomains, setAuthDomains] = useState<string[]>([]);
  const [now, setNow] = useState(Date.now());
  const [details, setDetails] = useState<any>(null);
  const [verified, setVerified] = useState(false);
  const [targets, setTargets] = useState<ConnectorTarget[]>([]);
  const [targetError, setTargetError] = useState('');
  const [targetLoading, setTargetLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<'setup' | 'advanced'>('setup');
  const [runtimeStatus, setRuntimeStatus] = useState<FeishuRuntime | null>(null);
  const [checking, setChecking] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const generation = useRef(0);
  const operating = useRef(false);

  const refresh = async (id = connection?.id) => {
    if (!id) return;
    const token = generation.current;
    try {
      const result = await connectors.feishuStatus(id);
      if (token !== generation.current) return;
      setDetails(result);
      if (!result.status?.botAvailable && !result.status?.userAvailable) setVerified(false);
      return result;
    } catch (reason) {
      if (token === generation.current) { setDetails(null); setVerified(false); }
      throw reason;
    }
  };
  const loadTargets = async () => {
    const token = generation.current;
    setTargetLoading(true); setTargetError('');
    try { const result = await connectors.targets(); if (token === generation.current) setTargets(result.targets); }
    catch (reason: any) { if (token === generation.current) setTargetError(reason.message || '读取入口失败'); }
    finally { if (token === generation.current) setTargetLoading(false); }
  };
  const checkRuntime = async (id = connection?.id) => {
    const token = generation.current;
    setChecking(true); setRuntimeError(''); setVerified(false);
    try {
      const result = await connectors.feishuRuntime();
      if (token !== generation.current) return;
      setRuntimeStatus(result);
      if (id && result.ready) {
        try { await refresh(id); }
        catch (reason: any) { if (token === generation.current) setError(reason.message || '读取飞书身份失败，请刷新状态重试'); }
      }
      else setDetails(null);
    } catch (reason: any) {
      if (token === generation.current) { setRuntimeStatus(null); setDetails(null); setRuntimeError(reason.message || '检测失败，请重试'); }
    } finally { if (token === generation.current) setChecking(false); }
  };
  useEffect(() => {
    generation.current++;
    setConnection(editing); setName(editing?.name || '飞书'); setAppId(''); setAppSecret(''); setReplace(false);
    setAuth(null); setAuthDomains([]); setDetails(null); setVerified(false); setError(''); setNotice(''); setTargets([]);
    void checkRuntime(editing?.id); void loadTargets();
    return () => { generation.current++; };
  }, [editing?.id]);
  useEffect(() => {
    if (!auth) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [auth]);
  const perform = async (operation: () => Promise<void>, label = '正在处理…') => {
    if (operating.current) return;
    operating.current = true;
    setBusy(true); setActivity(label); setError(''); setNotice('');
    try { await operation(); }
    catch (reason: any) { setError(reason.message || '操作失败，请重试'); }
    finally { operating.current = false; setBusy(false); setActivity(''); }
  };
  const blocked = busy || checking;
  const enabled = targets.filter(target => connection && target.connectorIds.includes(connection.id));
  const identityReady = Boolean(details?.status?.botAvailable || details?.status?.userAvailable);
  const credentialDirty = Boolean(connection && (replace || name !== connection.name));
  const authExpired = Boolean(auth && auth.expiresAt <= now);
  const status = checking ? '正在检测' : credentialDirty ? '应用信息待保存' : !runtimeStatus ? '待检测' : !runtimeStatus.ready ? '服务未就绪' : !connection ? '待连接应用' : !details ? '待检测身份' : !details.status?.userAvailable ? (details.status?.refreshExpiresAt ? '需重新授权' : '待用户授权') : !verified ? '待验证连接' : !enabled.length ? '待选择入口' : '已就绪';
  const completed = [runtimeStatus?.ready, Boolean(connection), verified && details?.status?.userAvailable, enabled.length > 0];
  const startAuth = () => {
    if (operating.current || !authDomains.length) return;
    // Open during the click event so browsers can permit the authorization window.
    let popup: Window | null = null;
    try {
      popup = window.open('about:blank', '_blank');
      if (popup) { popup.opener = null; showAuthorizationLoading(popup); }
    } catch { /* The link below remains available. */ }
    void perform(async () => {
      try {
        setAuth(null);
        const result = await connectors.feishuAction(connection!.id, { action: 'start', domains: authDomains });
        const url = new URL(result.verificationUrl);
        if (url.protocol !== 'https:') throw Error('未收到有效授权地址，请重试');
        const expiresAt = Date.now() + Math.min(Number(result.expiresIn) || 600, 3600) * 1000;
        setNow(Date.now()); setAuth({ url: url.href, code: result.userCode, expiresAt });
        try {
          if (popup && !popup.closed) popup.location.replace(url.href);
          else setNotice('授权链接已就绪，请点击「打开飞书授权页面」继续');
        } catch {
          try { popup?.close(); } catch { /* Keep the valid link available in the original page. */ }
          setNotice('自动跳转未完成，请点击「打开飞书授权页面」继续');
        }
      } catch (reason) {
        try { popup?.close(); } catch { /* Preserve the original authorization error. */ }
        throw reason;
      }
    }, '正在获取授权链接…');
  };
  const toggle = (target: ConnectorTarget) => void perform(async () => {
    if (!connection) return;
    const enabled = target.connectorIds.includes(connection.id);
    await connectors.bind(target.scope, target.scopeId, connection.id, !enabled);
    setTargets(previous => previous.map(item => item.scope === target.scope && item.scopeId === target.scopeId ? {
      ...item, connectorIds: enabled ? item.connectorIds.filter(id => id !== connection.id) : [...item.connectorIds, connection.id],
    } : item));
    setNotice(`${target.name}已${enabled ? '关闭' : '开启'}飞书连接`);
  }, '正在保存入口设置…');

  return <ConnectorDrawer onClose={onClose} busy={blocked}>
    <header className="flex shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white px-5 py-5 sm:px-7">
      <FeishuMark /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 id="feishu-drawer-title" className="text-lg font-bold text-slate-950">飞书连接</h2><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${status === '已就绪' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{status}</span></div><p className="mt-1 text-xs text-slate-500">把飞书工作带进对话</p></div>
      <button type="button" aria-label="关闭飞书配置" disabled={blocked} onClick={onClose} className={`${buttonClass} !border-transparent !p-2`}><X size={19} /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
      <div className="mb-6 rounded-2xl bg-slate-900 p-5 text-white"><p className="text-sm font-semibold">连接消息、文档、日历与多维表格</p><p className="mt-2 text-xs leading-6 text-slate-300">选择谁可以使用飞书，在对话中完成日常协作。实际操作取决于应用权限及你的飞书访问权限。</p></div>
      <nav aria-label="飞书配置页面" className="mb-5 flex gap-1 rounded-xl bg-slate-200/60 p-1">{(['setup', 'advanced'] as const).map(value => <button key={value} type="button" disabled={blocked} aria-pressed={page === value} onClick={() => setPage(value)} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${page === value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>{value === 'setup' ? '连接设置' : `文件与事件${details?.pending?.length ? ` · ${details.pending.length} 项待确认` : ''}`}</button>)}</nav>
      {page === 'setup' ? <div className="space-y-4">
        <ol aria-label="连接进度" className="mb-6 grid grid-cols-4 gap-2">{['服务状态', '连接应用', '授权验证', '选择入口'].map((label, index) => <li key={label} className="space-y-2 text-center"><span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${completed[index] ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{completed[index] ? <Check size={14} /> : index + 1}</span><span className="block text-[11px] text-slate-600">{label}</span></li>)}</ol>
        <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-950">1. 检查服务状态</h3><button type="button" disabled={blocked} className={buttonClass} onClick={() => void checkRuntime()}>{checking ? <Loader2 size={13} className="animate-spin" /> : null}{checking ? '检测中…' : '重新检测'}</button></div>
          <p role="status" className={`text-xs leading-6 ${runtimeStatus?.ready ? 'text-emerald-700' : 'text-slate-500'}`}>{checking ? '正在检查飞书连接服务…' : runtimeStatus?.ready ? '服务已就绪，可以连接飞书应用。' : runtimeStatus?.cli.status === 'unsupported' ? '当前服务所在系统暂不支持飞书连接，请管理员将服务部署到 Linux、macOS 或 Windows。' : '飞书连接服务暂不可用，请联系管理员检查服务端环境。可先保存应用信息，稍后继续授权。'}</p>
          {runtimeError && <p role="alert" className="text-xs text-rose-600">服务检测失败：{runtimeError}</p>}
          {runtimeStatus && <details className="text-xs leading-6 text-slate-500" open={!runtimeStatus.ready && !['ready', 'directory', 'unsupported'].includes(runtimeStatus.sandbox.status)}><summary className="cursor-pointer font-medium">环境详情</summary><div className="mt-2 rounded-xl bg-slate-50 p-3"><p>服务端系统：{runtimeStatus.platform === 'win32' ? 'Windows' : runtimeStatus.platform === 'linux' ? 'Linux' : runtimeStatus.platform === 'darwin' ? 'macOS' : runtimeStatus.platform}</p><p>飞书 CLI：{runtimeStatus.cli.message}{runtimeStatus.cli.version ? `（${runtimeStatus.cli.version}）` : ''}</p><p>所需版本：{runtimeStatus.expectedVersion}</p><p>{runtimeStatus.sandbox.message}</p>{runtimeStatus.platform === 'win32' && <p>登录凭据由服务进程所在 Windows 账号的系统凭据库管理，适合本地开发。</p>}</div></details>}
        </section>
        <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-950">2. 连接飞书应用</h3><a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700">飞书开放平台 <ExternalLink size={12} /></a></div>
          <p className="text-xs leading-6 text-slate-500">创建企业自建应用，在“凭证与基础信息”中获取凭据，并按需要配置权限、发布应用。</p>
          <form id="feishu-credentials" className="space-y-4" onSubmit={event => { event.preventDefault(); void perform(async () => {
            if (!name.trim()) throw Error('请填写连接名称');
            const replacing = !connection || replace;
            const result = await connectors.save({ toolId: connection?.toolId || 'feishu-cli', name, url: 'connector:feishu-cli', catalogId: 'feishu-cli', ...(!connection || replace ? { headers: { appId: appId.trim(), appSecret: appSecret.trim() } } : {}) }, connection?.id);
            setConnection(result.connector); setName(result.connector.name); setReplace(false); setAppId(''); setAppSecret('');
            if (replacing) { setVerified(false); setDetails(null); setAuth(null); }
            onSaved(result.connector); setNotice('应用信息已保存，请继续完成授权与连接验证');
            if (runtimeStatus?.ready) await refresh(result.connector.id);
          }, '正在保存应用信息…'); }}>
            <label className="block space-y-1.5 text-xs font-medium text-slate-600"><span>连接名称</span><input required maxLength={80} value={name} disabled={blocked} onChange={event => setName(event.target.value)} className={inputClass} /></label>
            {connection && <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={replace} disabled={blocked} onChange={event => { setReplace(event.target.checked); setAppId(''); setAppSecret(''); }} />替换应用凭据（默认保留，不回显密钥）</label>}
            {(!connection || replace) && <><label className="block space-y-1.5 text-xs font-medium text-slate-600"><span>App ID</span><input required autoComplete="off" value={appId} disabled={blocked} onChange={event => setAppId(event.target.value)} placeholder="cli_…" className={inputClass} /></label><label className="block space-y-1.5 text-xs font-medium text-slate-600"><span>App Secret</span><input required type="password" autoComplete="new-password" value={appSecret} disabled={blocked} onChange={event => setAppSecret(event.target.value)} className={inputClass} /></label><p className="text-[11px] leading-5 text-slate-400">凭据加密保存。更换应用后需重新授权用户身份。</p></>}
            <button disabled={blocked} className={connection ? buttonClass : primaryClass}>{connection ? '保存应用信息' : '保存并继续'}<ChevronRight size={13} /></button>
          </form>
        </section>
        <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5">
          <h3 className="text-sm font-bold text-slate-950">3. 授权并验证连接</h3>
          <p className="text-xs leading-6 text-slate-500">应用凭据用于应用身份；授权飞书账号后，才能以你的身份执行相关操作。打开此页仅读取本地状态，点击登录授权或验证连接时才会联网检查。</p>
          <div className="grid grid-cols-2 gap-3">{[['应用身份', details?.status?.botAvailable ? '可用' : '未确认'], ['用户身份', details?.status?.userAvailable ? '已授权' : details?.status?.refreshExpiresAt ? '需重新授权' : '未授权']].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-400">{label}</p><p className="mt-1 text-xs font-semibold text-slate-700">{value}</p></div>)}</div>
          {credentialDirty && <p className="text-xs text-amber-700">请先保存应用信息，再进行授权或验证。</p>}
          <fieldset className="space-y-3" disabled={blocked || !connection || !runtimeStatus?.ready || credentialDirty}>
            <legend className="text-xs font-semibold text-slate-700">选择本次需要授权的功能</legend>
            <p className="text-[11px] leading-5 text-slate-500">仅申请所选功能域的权限，可能包含读取与修改。具体权限以飞书授权页为准；以后可重新选择并授权。重新授权不代表撤销此前已授予的权限。</p>
            {[FEISHU_AUTH_DOMAINS.slice(0, 8), FEISHU_AUTH_DOMAINS.slice(8)].map((group, index) => {
              const choices = <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{group.map(domain => <label key={domain.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600"><input type="checkbox" aria-label={`授权功能：${domain.label}`} checked={authDomains.includes(domain.id)} onChange={() => { setAuth(null); setAuthDomains(previous => previous.includes(domain.id) ? previous.filter(id => id !== domain.id) : [...previous, domain.id]); }} className="accent-blue-600" />{domain.label}</label>)}</div>;
              return index === 0 ? <div key="common">{choices}</div> : <details key="more"><summary className="mb-2 cursor-pointer text-xs text-slate-500">更多功能</summary>{choices}</details>;
            })}
          </fieldset>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={blocked || !connection || !runtimeStatus?.ready || credentialDirty || !authDomains.length} className={primaryClass} onClick={startAuth}>{details?.status?.userAvailable ? '重新授权' : '登录授权'}</button><button type="button" disabled={blocked || !connection || !runtimeStatus?.ready || credentialDirty} className={buttonClass} onClick={() => void perform(async () => { setVerified(false); await refresh(); }, '正在刷新授权状态…')}>刷新状态</button></div>
          <details className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500"><summary className="cursor-pointer font-medium">连接或授权时提示数据安全策略限制？</summary><div className="mt-2 space-y-2 leading-6"><p>若出现 “The requested scope is blocked by data security policy” 或 “Access denied due to platform policy”，请记录完整报错（包含失败步骤）、发生时间和 App ID，联系飞书租户管理员或应用管理员，核对应用是否允许使用、所需权限、应用可用范围及租户数据安全策略。仅凭报错无法确定被限制的具体权限。</p><p>请只选择工作所需功能。策略仍不允许时，需由管理员确认是否可以授权；反复刷新或点击「我已授权」无法解除策略限制。</p></div></details>
          {auth && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4"><p className="text-xs text-slate-600">{authExpired ? '授权链接已过期，请重新登录授权。' : '请在飞书页面确认授权，然后回来完成连接。'}</p>{auth.code && !authExpired && <p className="text-xs text-slate-500">授权码：<code className="font-mono font-bold text-slate-900">{auth.code}</code></p>}{!authExpired && <><a href={auth.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">打开飞书授权页面 <ExternalLink size={12} /></a><div><button type="button" disabled={blocked} className={primaryClass} onClick={() => void perform(async () => { await connectors.feishuAction(connection!.id, { action: 'complete' }); setAuth(null); setVerified(false); await refresh(); setNotice('用户授权已完成，请验证连接'); }, '正在确认授权…')}>我已授权</button></div></>}</div>}
          <div className="space-y-2 border-t border-slate-100 pt-4"><button type="button" disabled={blocked || !connection || !runtimeStatus?.ready || credentialDirty} className={buttonClass} onClick={() => void perform(async () => { setVerified(false); const result = await connectors.test(connection!.id); if (!result.ok) throw Error('连接验证失败，请检查应用权限并重试'); const latest = await refresh(); if (!latest?.status?.botAvailable && !latest?.status?.userAvailable) throw Error('飞书身份未就绪，请重新授权后验证'); setVerified(true); setNotice('连接验证通过。可用操作取决于飞书已授予的权限'); }, '正在验证连接…')}>{verified ? <Check size={13} /> : null}{verified ? '重新验证连接' : '验证连接'}</button><p className={`text-[11px] leading-5 ${verified ? 'text-emerald-700' : 'text-slate-400'}`}>{verified ? '连接验证通过，可选择使用入口。' : '验证会检查身份与工具加载状态；具体业务权限以实际调用为准。'}</p></div>
          {details?.status?.userAvailable && <button type="button" disabled={blocked} className="text-xs text-slate-400 underline" onClick={() => void perform(async () => { await connectors.feishuAction(connection!.id, { action: 'logout' }); setAuth(null); setDetails(null); setVerified(false); await refresh(); setNotice('已退出用户登录，用户身份事件订阅已停止'); }, '正在退出登录…')}>退出用户登录</button>}
        </section>
        <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5">
          <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-950">4. 选择使用入口</h3><span className="text-[11px] text-slate-400">已开启 {enabled.length} 个</span></div><p className="text-xs leading-6 text-slate-500">仅为你选择的入口开启。应用身份可独立使用；需要用户身份的操作仍需完成账号授权。</p>
          {!verified && <p className="text-xs text-amber-700">请先验证连接再开启新入口。已开启的入口可随时关闭。</p>}
          {targetError && <p role="alert" className="text-xs text-rose-600">{targetError}<button type="button" disabled={blocked || targetLoading} onClick={() => void loadTargets()} className="ml-2 underline">重试读取入口</button></p>}
          {targetLoading ? <p className="text-xs text-slate-400">正在读取可用入口…</p> : !targetError && <><input type="search" aria-label="搜索使用入口" placeholder="搜索小伴、Agent 或空间" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} className={inputClass} /><div className="max-h-64 space-y-1 overflow-y-auto">{targets.filter(target => `${target.name} ${scopeLabel(target.scope)}`.toLowerCase().includes(search.trim().toLowerCase())).map(target => { const checked = Boolean(connection && target.connectorIds.includes(connection.id)); return <label key={`${target.scope}:${target.scopeId}`} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 hover:bg-slate-50"><input type="checkbox" aria-label={`为${scopeLabel(target.scope)}「${target.name}」开启飞书`} checked={checked} disabled={blocked || !connection || (!checked && (!verified || !identityReady || credentialDirty))} onChange={() => toggle(target)} className="h-4 w-4 accent-blue-600" /><span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{target.name}</span><span className="text-[10px] text-slate-400">{scopeLabel(target.scope)}</span></label>; })}{!targets.some(target => `${target.name} ${scopeLabel(target.scope)}`.toLowerCase().includes(search.trim().toLowerCase())) && <p className="p-3 text-xs text-slate-400">没有匹配的入口</p>}</div></>}
        </section>
      </div> : <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5"><h3 className="text-sm font-bold text-slate-950">文件、事件与操作确认</h3><p className="text-xs leading-6 text-slate-500">管理各入口的文件与订阅，并审阅需要确认的操作。</p><button type="button" disabled={blocked || !connection || !runtimeStatus?.ready} className={buttonClass} onClick={() => void perform(async () => { await refresh(); await loadTargets(); }, '正在刷新管理状态…')}>刷新管理状态</button>{connection && runtimeStatus?.ready && details ? <FeishuAdvanced editing={connection} details={details} targets={targets} busy={blocked} perform={perform} refresh={() => refresh()} setNotice={setNotice} /> : <p className="text-xs text-slate-400">服务就绪并完成应用连接后，可在这里管理。</p>}</section>}
    </div>
    <footer className="shrink-0 space-y-3 border-t border-slate-200/80 bg-white px-5 py-4 sm:px-7">
      {error && <p role="alert" className="break-words rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{error}</p>}
      {notice && !error && <p role="status" className="text-xs leading-5 text-emerald-700">{notice}</p>}
      <div className="flex items-center justify-between gap-3"><p aria-live="polite" className="text-[11px] leading-5 text-slate-400">{busy ? <span className="inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" />{activity}</span> : connection ? `应用信息已保存 · ${enabled.length} 个入口已开启` : '保存应用信息后，可稍后继续配置'}</p><button type="button" disabled={blocked} onClick={onClose} className={buttonClass}>{connection && verified && enabled.length && details?.status?.userAvailable ? '完成配置' : '关闭'}</button></div>
    </footer>
  </ConnectorDrawer>;
}
