'use client';

import { useEffect, useState } from 'react';
import { connectors, type PersonalConnector } from '@/lib/client/api';

export default function FeishuConnectorSettings({ editing, onSaved }: { editing: PersonalConnector | null; onSaved: () => void }) {
  const [name, setName] = useState(editing?.name || '飞书 CLI');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [details, setDetails] = useState<any>(null);
  const [target, setTarget] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [eventKey, setEventKey] = useState('');
  const [eventIdentity, setEventIdentity] = useState('bot');
  const [eventParams, setEventParams] = useState('{}');
  const [runtimeStatus, setRuntimeStatus] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const refresh = async () => {
    if (!editing) return;
    const result = await connectors.feishuStatus(editing.id);
    setDetails(result);
  };
  const checkRuntime = async () => {
    setChecking(true); setRuntimeError('');
    try {
      const result = await connectors.feishuRuntime();
      setRuntimeStatus(result);
      if (editing && result.ready) {
        try { await refresh(); } catch (reason: any) { setError(reason.message); }
      } else setDetails(null);
    } catch (reason: any) { setRuntimeStatus(null); setRuntimeError(reason.message || '检测失败，请重试'); }
    finally { setChecking(false); }
  };
  useEffect(() => {
    setName(editing?.name || '飞书 CLI'); setAppId(''); setAppSecret(''); setReplace(false);
    setDetails(null); setTarget(''); setFiles([]); setSubscriptions([]); setEvents([]); setAuthUrl(''); setError('');
    void checkRuntime();
  }, [editing?.id]);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (reason: any) { setError(reason.message || '操作失败'); }
    finally { setBusy(false); }
  };
  const binding = target ? JSON.parse(target) : null;
  const eventAction = async (event: Record<string, any>) => {
    if (!editing || !binding) return;
    const result = await connectors.feishuAction(editing.id, { action: 'events', ...binding, event });
    if (result.subscriptions) setSubscriptions(result.subscriptions);
    if (result.events) setEvents(result.events);
  };
  const inputClass = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm';
  const buttonClass = 'rounded-xl border border-black/10 px-3 py-2 text-sm disabled:opacity-40';
  return <section className="space-y-5 rounded-[28px] border border-black/[0.06] bg-white p-6">
    <h3 className="text-lg font-black">飞书 CLI 配置</h3>
    <p className="text-xs leading-6 text-slate-500">需在服务端安装官方 CLI，支持 Linux 或 Windows。Windows 采用目录分离，登录凭据仍由当前 Windows 账号的系统凭据库管理，适合本地开发。官方 Skill 和参考资料随 CLI 按需读取。填写应用凭据后，再登录授权用户身份；添加后需在各入口单独开启。更换应用凭据后需重新登录。</p>
    <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-xs">
      <div className="flex items-center justify-between gap-3"><h4 className="font-bold">服务端运行环境</h4><button type="button" disabled={busy || checking} className={buttonClass} onClick={() => void checkRuntime()}>{checking ? '检测中…' : '重新检测'}</button></div>
      {runtimeStatus && <><p role="status">{runtimeStatus.platform === 'win32' ? 'Windows' : runtimeStatus.platform === 'linux' ? 'Linux' : runtimeStatus.platform} · {runtimeStatus.ready ? '环境已就绪' : '环境未就绪'}</p><p>飞书 CLI：{runtimeStatus.cli.message}{runtimeStatus.cli.version ? `（${runtimeStatus.cli.version}）` : ''}，要求版本 {runtimeStatus.expectedVersion}</p><p>{runtimeStatus.sandbox.message}</p>{!runtimeStatus.ready && <p>请在运行平台服务的电脑或服务器项目目录执行：<code>{runtimeStatus.installCommand}</code>。安装完成后点击“重新检测”。</p>}</>}
      {!runtimeStatus && !runtimeError && <p>正在检查服务端是否已安装飞书 CLI…</p>}
      {runtimeError && <p role="alert" className="text-rose-600">环境检测失败：{runtimeError}</p>}
    </div>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); void perform(async () => {
      await connectors.save({ toolId: editing?.toolId || 'feishu-cli', name, url: 'connector:feishu-cli', catalogId: 'feishu-cli',
        ...(!editing || replace ? { headers: { appId: appId.trim(), appSecret: appSecret.trim() } } : {}) }, editing?.id);
      setAppSecret(''); onSaved();
    }); }}>
      <label className="block space-y-1 text-xs"><span>连接名称</span><input required value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} className={inputClass} /></label>
      {editing && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={replace} disabled={busy} onChange={event => setReplace(event.target.checked)} />替换应用凭据（默认保留，不回显密钥）</label>}
      {(!editing || replace) && <><label className="block space-y-1 text-xs"><span>App ID</span><input required value={appId} disabled={busy} onChange={event => setAppId(event.target.value)} placeholder="cli_…" className={inputClass} /></label><label className="block space-y-1 text-xs"><span>App Secret</span><input required type="password" autoComplete="off" value={appSecret} disabled={busy} onChange={event => setAppSecret(event.target.value)} className={inputClass} /></label></>}
      <button disabled={busy} className={buttonClass}>保存连接</button>
    </form>
    {editing && <>
      <div className="space-y-3 border-t border-black/5 pt-4">
        <h4 className="font-bold">账号授权</h4>
        <p className="text-xs text-slate-500">应用身份：{details?.status?.botAvailable ? '可用' : '未确认'} · 用户身份：{details?.status?.userAvailable ? '已授权' : '未授权'}。可用操作仍取决于飞书应用已发布权限与本人访问权限。</p>
        <div className="flex flex-wrap gap-2"><button disabled={busy || !runtimeStatus?.ready} className={buttonClass} onClick={() => void perform(async () => { const result = await connectors.feishuAction(editing.id, { action: 'start' }); setAuthUrl(result.verificationUrl); })}>登录授权</button><button disabled={busy || !runtimeStatus?.ready || !authUrl} className={buttonClass} onClick={() => void perform(async () => { await connectors.feishuAction(editing.id, { action: 'complete' }); setAuthUrl(''); await refresh(); })}>我已授权</button><button disabled={busy || !runtimeStatus?.ready} className={buttonClass} onClick={() => void perform(refresh)}>刷新状态</button><button disabled={busy || !runtimeStatus?.ready} className={buttonClass} onClick={() => void perform(async () => { await connectors.feishuAction(editing.id, { action: 'logout' }); await refresh(); })}>退出用户登录</button></div>
        {authUrl && <a href={authUrl} target="_blank" rel="noreferrer" className="block break-all text-sm text-indigo-700 underline">打开飞书授权页面</a>}
      </div>
      {details?.pending?.length > 0 && <div className="space-y-3 border-t border-black/5 pt-4"><h4 className="font-bold">待确认操作</h4>{details.pending.map((item: any) => <div key={item.id} className="space-y-2 rounded-xl bg-amber-50 p-3"><p className="text-xs">高风险操作 · {item.scope} / {item.scopeId}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ argv: item.argv, stdin: item.stdin }, null, 2)}</pre><div className="flex gap-2">{['approve', 'reject'].map(action => <button key={action} disabled={busy} className={buttonClass} onClick={() => void perform(async () => { const result = await connectors.feishuAction(editing.id, { action, approvalId: item.id }); setNotice(result.code === undefined ? '已拒绝' : result.code === 0 ? '操作已执行' : `执行未成功：${result.stderr}`); await refresh(); })}>{action === 'approve' ? '确认执行' : '拒绝'}</button>)}</div></div>)}</div>}
      <div className="space-y-3 border-t border-black/5 pt-4">
        <h4 className="font-bold">入口文件与事件</h4>
        <p className="text-xs text-slate-500">每个开启入口的文件和收件箱独立。订阅由 Agent Worker 运行，每订阅保留最近 200 条；收到事件不会自动发送飞书回复。</p>
        <select aria-label="飞书入口" value={target} disabled={busy} className={inputClass} onChange={event => { setTarget(event.target.value); setFiles([]); setSubscriptions([]); setEvents([]); }}><option value="">选择已开启的入口</option>{details?.bindings?.map((item: any) => <option key={`${item.scope}:${item.scopeId}`} value={JSON.stringify(item)}>{item.scope} / {item.scopeId}</option>)}</select>
        {binding && <>
          <div className="flex flex-wrap items-center gap-2"><button disabled={busy} className={buttonClass} onClick={() => void perform(async () => setFiles((await connectors.feishuFiles(editing.id, binding.scope, binding.scopeId)).files))}>刷新文件</button><label className={buttonClass}>上传文件（8MB）<input type="file" className="hidden" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void perform(async () => { if (file.size > 8 * 1024 * 1024) throw new Error('文件超过 8MB'); const bytes = new Uint8Array(await file.arrayBuffer()); let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); await connectors.feishuAction(editing.id, { action: 'upload', ...binding, name: file.name, base64: btoa(text) }); setFiles((await connectors.feishuFiles(editing.id, binding.scope, binding.scopeId)).files); }); }} /></label></div>
          {files.map(file => <button key={file} disabled={busy} className="mr-3 text-sm text-indigo-700 underline" onClick={() => void perform(async () => { const result = await connectors.feishuFiles(editing.id, binding.scope, binding.scopeId, file); const data = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0)); const url = URL.createObjectURL(new Blob([data])); const link = document.createElement('a'); link.href = url; link.download = result.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); })}>{file}</button>)}
          <div className="space-y-2"><input aria-label="飞书 EventKey" value={eventKey} onChange={event => setEventKey(event.target.value)} placeholder="EventKey，例如 im.message.receive_v1" className={inputClass} /><select aria-label="订阅身份" value={eventIdentity} onChange={event => setEventIdentity(event.target.value)} className={inputClass}><option value="bot">应用身份 bot</option><option value="user">用户身份 user</option></select><textarea aria-label="订阅参数" value={eventParams} onChange={event => setEventParams(event.target.value)} className={inputClass} /><button disabled={busy || !eventKey.trim()} className={buttonClass} onClick={() => void perform(() => eventAction({ action: 'start', eventKey: eventKey.trim(), identity: eventIdentity, params: JSON.parse(eventParams) }))}>启动订阅</button><button disabled={busy} className={buttonClass} onClick={() => void perform(() => eventAction({ action: 'list' }))}>刷新订阅</button><button disabled={busy} className={buttonClass} onClick={() => void perform(() => eventAction({ action: 'inbox' }))}>查看事件</button></div>
          {subscriptions.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 text-xs"><span>{item.eventKey} · {item.status} {item.lastError}</span><button disabled={busy || !item.enabled} className={buttonClass} onClick={() => void perform(() => eventAction({ action: 'stop', id: item.id }))}>停止</button></div>)}
          {events.length > 0 && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-50 p-3 text-xs">{JSON.stringify(events, null, 2)}</pre>}
        </>}
      </div>
    </>}
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
  </section>;
}
