'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, Loader2, X } from 'lucide-react';
import { spaceFollowUps } from '@/lib/client/api';
import { startSerialPolling } from '@/lib/space/serial-polling.mjs';
import type { SpaceFollowUp } from '@/types';

const labels = { PENDING: '待复查', RUNNING: '正在复查', COMPLETED: '已汇报', FAILED: '未完成', CANCELLED: '已取消' };
const qqLabels = { PENDING: 'QQ 待发送', SENT: 'QQ 已发送', RETRYING: 'QQ 重试中', FAILED: 'QQ 已停止重试', CANCELLED: 'QQ 已取消' };

export default function SpaceFollowUpPanel({ spaceId, showControl, refreshKey, onResults }: {
  spaceId: string;
  showControl: boolean;
  refreshKey: string;
  onResults: (signal: AbortSignal) => Promise<boolean>;
}) {
  const [tasks, setTasks] = useState<SpaceFollowUp[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [qqEnabled, setQQEnabled] = useState(false);
  const [qqChannel, setQQChannel] = useState({ ready: false, reason: '' });
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;
  const seen = useRef<Map<string, string> | null>(null);
  const generation = useRef(0);
  const mutationVersion = useRef(0);
  const mutationInFlight = useRef(false);

  useEffect(() => {
    seen.current = null;
    setTasks([]);
    setLoaded(false);
    setEnabled(false);
    setQQEnabled(false);
    setQQChannel({ ready: false, reason: '' });
    setBusy(null);
    setError(null);
    setExpanded(false);
    generation.current++;
    mutationVersion.current++;
    mutationInFlight.current = false;
  }, [spaceId]);

  useEffect(() => {
    const refresh = async (signal: AbortSignal) => {
      const version = mutationVersion.current;
      try {
        const result = await spaceFollowUps.list(spaceId, signal);
        if (signal.aborted) return false;
        if (version !== mutationVersion.current || mutationInFlight.current) return;
        setTasks(result.tasks);
        setEnabled(result.enabled);
        setQQEnabled(result.qqEnabled);
        setQQChannel(result.qqChannel);
        setAvailable(result.schedulerEnabled);
        setLoaded(true);
        setError(null);
        const changed = result.tasks.some(task => ['COMPLETED', 'FAILED'].includes(task.status)
          && seen.current?.get(task.id) !== `${task.status}:${task.updatedAt}`);
        if (changed && !await onResultsRef.current(signal)) return;
        if (!signal.aborted) seen.current = new Map(result.tasks.map(task => [task.id, `${task.status}:${task.updatedAt}`]));
      } catch (error: any) {
        if (!signal.aborted && version === mutationVersion.current && !mutationInFlight.current) setError(error.message || '读取复查任务失败');
      }
    };
    return startSerialPolling(refresh, { delay: 5000, immediate: true });
  }, [spaceId, refreshKey]);

  const mutate = async (id: string, operation: () => Promise<unknown>) => {
    const current = generation.current;
    mutationInFlight.current = true;
    mutationVersion.current++;
    setBusy(id);
    try {
      await operation();
      const result = await spaceFollowUps.list(spaceId);
      if (current !== generation.current) return;
      setTasks(result.tasks);
      setEnabled(result.enabled);
      setQQEnabled(result.qqEnabled);
      setQQChannel(result.qqChannel);
      setAvailable(result.schedulerEnabled);
      setError(null);
    } catch (error: any) {
      if (current === generation.current) setError(error.message || '操作失败，请重试');
    } finally {
      if (current === generation.current) {
        mutationInFlight.current = false;
        mutationVersion.current++;
        setBusy(null);
      }
    }
  };
  const active = tasks.filter(task => task.status === 'PENDING' || task.status === 'RUNNING');
  if (!showControl && !enabled) return null;
  return (
    <section className="shrink-0 border-b border-black/[0.06] bg-white px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <CalendarClock size={16} className="text-slate-500" />
        <span className="text-xs font-black text-slate-800">自主复查与汇报</span>
        {showControl && (
          <button type="button" role="switch" aria-checked={enabled} aria-label="自主复查与汇报"
            disabled={!loaded || busy !== null || (!available && !enabled)}
            onClick={() => void mutate('toggle', () => spaceFollowUps.setEnabled(spaceId, !enabled))}
            className={`relative h-5 w-9 rounded-full transition disabled:opacity-50 ${enabled ? 'bg-emerald-600' : 'bg-slate-200'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        )}
        <span className="text-[11px] text-slate-500">
          {!loaded ? '读取中…' : enabled ? `已开启 · ${active.length} 项待办` : '已关闭 · 开启后可在聊天中约定复查时间'}
        </span>
        {tasks.length > 0 && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}
          className="ml-auto flex items-center gap-1 text-xs font-semibold text-slate-500">
          复查记录 <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} />
        </button>}
      </div>
      {showControl && <p className="mt-2 text-[11px] text-slate-400">
        临时提问即时回答；约定跟进后，AI 可根据盘面自行续查，最多续查 3 次、持续 24 小时。关闭会取消未完成复查。
      </p>}
      {showControl && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs font-semibold text-slate-700">鹰眼 · 重要变化 QQ 通知</span>
        <button type="button" role="switch" aria-checked={qqEnabled} aria-label="鹰眼重要变化QQ通知"
          disabled={!loaded || busy !== null || (!qqEnabled && (!enabled || !available || !qqChannel.ready))}
          onClick={() => void mutate('qq-toggle', () => spaceFollowUps.setQQEnabled(spaceId, !qqEnabled))}
          className={`relative h-5 w-9 rounded-full transition disabled:opacity-50 ${qqEnabled ? 'bg-emerald-600' : 'bg-slate-200'}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${qqEnabled ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
        <span className="text-[11px] text-slate-500">{qqEnabled ? '已开启' : '已关闭'}</span>
        <p className="w-full text-[11px] text-slate-400">
          {qqChannel.ready ? '复用现有 QQ 通知通道。成员复查发现重要变化后，交给鹰眼发送短报；普通复查留在空间。' : qqChannel.reason || '正在读取现有 QQ 通知通道…'}
        </p>
      </div>}
      {!available && <p className="mt-2 text-xs text-amber-700">服务器已暂停自主复查。</p>}
      {error && <p className="mt-2 text-xs text-rose-600" role="status">{error}</p>}
      {expanded && <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
        {tasks.map(task => <div key={task.id} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          {task.status === 'RUNNING' && <Loader2 size={13} className="animate-spin text-emerald-600" />}
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{task.title}</span>
          {task.origin === 'AI_FOLLOW_UP' && <span className="shrink-0 text-emerald-700" title={task.reason || 'AI 根据上次复查判断安排'}>AI 续查</span>}
          <time className="shrink-0 text-slate-500">{new Date(task.runAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time>
          <span className="shrink-0 text-slate-500">{labels[task.status]}</span>
          {task.qqNotification && <span className="shrink-0 text-emerald-700" title={task.qqNotification.error || '鹰眼通过现有 QQ 通道投递'}>{qqLabels[task.qqNotification.status]}</span>}
          {['PENDING', 'RUNNING'].includes(task.status) && <button type="button" title="取消这次复查" disabled={busy !== null}
            onClick={() => void mutate(task.id, () => spaceFollowUps.cancel(spaceId, task.id))}
            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"><X size={13} /></button>}
        </div>)}
      </div>}
    </section>
  );
}
