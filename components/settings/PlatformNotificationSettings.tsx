'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { platformNotifications, type PlatformNotificationConfig } from '@/lib/client/api';

const empty: PlatformNotificationConfig = { baseUrl: '', targetType: 'PRIVATE', targetId: '', enabled: true };
export default function PlatformNotificationSettings() {
  const [config, setConfig] = useState(empty);
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    platformNotifications.get().then(({ config }) => { if (active) { setConfig(config || empty); setSaved(!!config); } })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  const change = (value: Partial<PlatformNotificationConfig>) => { setConfig(current => ({ ...current, ...value })); setDirty(true); setNotice(''); };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (error: any) { setError(error.message || '操作失败'); } finally { setBusy(false); }
  };
  const inputClass = 'mt-2 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-100';
  return <section id="platform-notifications" className="space-y-4 rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm">
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700"><Bell size={18} /></div>
      <div><h2 className="text-lg font-black text-slate-950">平台通知</h2>
        <p className="text-sm text-slate-500">配置 QQ 机器人和接收方式。</p></div>
    </div>
    <p className="text-xs leading-6 text-slate-500">接收空间跟进的重要变化，各空间需单独开启 QQ 通知。</p>
    <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
      <label className="block text-sm">机器人服务地址<input className={inputClass} type="url" placeholder="https://qq.example.com" value={config.baseUrl} onChange={event => change({ baseUrl: event.target.value })} /></label>
      <label className="block text-sm">鉴权密钥（X-Auth-Key）<input className={inputClass} type="password" autoComplete="new-password" placeholder={saved ? '留空保留已保存的密钥' : '输入机器人接口密钥'} value={token} onChange={event => { setToken(event.target.value); setDirty(true); setNotice(''); }} /></label>
      <label className="block text-sm">接收方式<select className={inputClass} value={config.targetType} onChange={event => change({ targetType: event.target.value as 'PRIVATE' | 'GROUP' })}><option value="PRIVATE">QQ 私聊</option><option value="GROUP">QQ 群聊</option></select></label>
      <label className="block text-sm">{config.targetType === 'GROUP' ? 'QQ 群号' : '接收人 QQ 号'}<input className={inputClass} inputMode="numeric" value={config.targetId} onChange={event => change({ targetId: event.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} onChange={event => change({ enabled: event.target.checked })} />启用平台通知</label>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white" onClick={() => void run(async () => {
          const result = await platformNotifications.save({ ...config, token }); setConfig(result.config); setToken(''); setSaved(true); setDirty(false); setNotice('已保存');
        })}>保存配置</button>
        <button type="button" disabled={!saved || dirty || !config.enabled} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40" onClick={() => void run(async () => { await platformNotifications.test(); setNotice('测试消息已发送，请查看 QQ'); })}>发送测试消息</button>
        {saved && <button type="button" className="px-4 py-2 text-sm text-rose-600" onClick={() => void run(async () => { await platformNotifications.remove(); setConfig(empty); setToken(''); setSaved(false); setDirty(false); setNotice('已移除平台通知配置'); })}>移除配置</button>}
      </div>
    </fieldset>
    <p className="text-xs leading-6 text-slate-400">修改配置会取消该通道尚未发送的旧通知。测试发送使用已保存的配置。</p>
    {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
  </section>;
}
