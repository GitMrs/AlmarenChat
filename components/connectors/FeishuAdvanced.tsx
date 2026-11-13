'use client';

import { useEffect, useState } from 'react';
import { connectors, type ConnectorTarget, type PersonalConnector } from '@/lib/client/api';

const scopeLabel = (scope: string) => scope === 'assistant' ? '小伴' : scope === 'agent' ? 'Agent' : '空间';

export default function FeishuAdvanced({ editing, details, targets, busy, perform, refresh, setNotice }: {
  editing: PersonalConnector; details: any; targets: ConnectorTarget[]; busy: boolean;
  perform: (operation: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const [target, setTarget] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [eventKey, setEventKey] = useState('');
  const [eventIdentity, setEventIdentity] = useState('bot');
  const [eventParams, setEventParams] = useState('{}');
  const inputClass = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm';
  const buttonClass = 'rounded-xl border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-40';
  const binding = target ? JSON.parse(target) : null;
  useEffect(() => {
    if (binding && !targets.some(item => item.scope === binding.scope && item.scopeId === binding.scopeId && item.connectorIds.includes(editing.id))) {
      setTarget(''); setFiles([]); setSubscriptions([]); setEvents([]);
    }
  }, [targets, editing.id, target]);
  const eventAction = async (event: Record<string, any>) => {
    if (!binding) return;
    const result = await connectors.feishuAction(editing.id, { action: 'events', ...binding, event });
    if (result.subscriptions) setSubscriptions(result.subscriptions);
    if (result.events) setEvents(result.events);
  };
  return <div className="space-y-6">
      {details?.pending?.length > 0 && <div className="space-y-3 border-t border-black/5 pt-4"><h4 className="font-bold">待确认操作</h4>{details.pending.map((item: any) => <div key={item.id} className="space-y-2 rounded-xl bg-amber-50 p-3"><p className="text-xs">高风险操作 · {scopeLabel(item.scope)} · {targets.find(target => target.scope === item.scope && target.scopeId === item.scopeId)?.name || item.scopeId}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ argv: item.argv, stdin: item.stdin }, null, 2)}</pre><div className="flex gap-2">{['approve', 'reject'].map(action => <button key={action} disabled={busy} className={buttonClass} onClick={() => void perform(async () => { const result = await connectors.feishuAction(editing.id, { action, approvalId: item.id }); setNotice(result.code === undefined ? '已拒绝' : result.code === 0 ? '操作已执行' : `执行未成功：${result.stderr}`); await refresh(); })}>{action === 'approve' ? '确认执行' : '拒绝'}</button>)}</div></div>)}</div>}
      <div className="space-y-3 border-t border-black/5 pt-4">
        <h4 className="font-bold">入口文件与事件</h4>
        <p className="text-xs text-slate-500">每个开启入口的文件和收件箱独立。订阅由 Agent Worker 运行，每订阅保留最近 200 条；收到事件不会自动发送飞书回复。</p>
        <select aria-label="飞书入口" value={target} disabled={busy} className={inputClass} onChange={event => { setTarget(event.target.value); setFiles([]); setSubscriptions([]); setEvents([]); }}><option value="">选择已开启的入口</option>{targets.filter(item => item.connectorIds.includes(editing.id)).map(item => <option key={`${item.scope}:${item.scopeId}`} value={JSON.stringify({ scope: item.scope, scopeId: item.scopeId })}>{scopeLabel(item.scope)} · {item.name}</option>)}</select>
        {binding && <>
          <div className="flex flex-wrap items-center gap-2"><button disabled={busy} className={buttonClass} onClick={() => void perform(async () => setFiles((await connectors.feishuFiles(editing.id, binding.scope, binding.scopeId)).files))}>刷新文件</button><label className={buttonClass}>上传文件（8MB）<input type="file" className="hidden" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void perform(async () => { if (file.size > 8 * 1024 * 1024) throw new Error('文件超过 8MB'); const bytes = new Uint8Array(await file.arrayBuffer()); let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); await connectors.feishuAction(editing.id, { action: 'upload', ...binding, name: file.name, base64: btoa(text) }); setFiles((await connectors.feishuFiles(editing.id, binding.scope, binding.scopeId)).files); }); }} /></label></div>
          {files.map(file => <button key={file} disabled={busy} className="mr-3 text-sm text-indigo-700 underline" onClick={() => void perform(async () => { const result = await connectors.feishuFiles(editing.id, binding.scope, binding.scopeId, file); const data = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0)); const url = URL.createObjectURL(new Blob([data])); const link = document.createElement('a'); link.href = url; link.download = result.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); })}>{file}</button>)}
          <div className="space-y-2"><input aria-label="飞书 EventKey" value={eventKey} onChange={event => setEventKey(event.target.value)} placeholder="EventKey，例如 im.message.receive_v1" className={inputClass} /><select aria-label="订阅身份" value={eventIdentity} onChange={event => setEventIdentity(event.target.value)} className={inputClass}><option value="bot">应用身份 bot</option><option value="user">用户身份 user</option></select><textarea aria-label="订阅参数" value={eventParams} onChange={event => setEventParams(event.target.value)} className={inputClass} /><button disabled={busy || !eventKey.trim()} className={buttonClass} onClick={() => void perform(() => eventAction({ action: 'start', eventKey: eventKey.trim(), identity: eventIdentity, params: JSON.parse(eventParams) }))}>启动订阅</button><button disabled={busy} className={buttonClass} onClick={() => void perform(() => eventAction({ action: 'list' }))}>刷新订阅</button><button disabled={busy} className={buttonClass} onClick={() => void perform(() => eventAction({ action: 'inbox' }))}>查看事件</button></div>
          {subscriptions.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2 text-xs"><span>{item.eventKey} · {item.status} {item.lastError}</span><button disabled={busy || !item.enabled} className={buttonClass} onClick={() => void perform(() => eventAction({ action: 'stop', id: item.id }))}>停止</button></div>)}
          {events.length > 0 && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-50 p-3 text-xs">{JSON.stringify(events, null, 2)}</pre>}
        </>}
      </div>
  </div>;
}
