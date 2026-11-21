'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, Loader2 } from 'lucide-react';
import { spaceFollowUps } from '@/lib/client/api';
import { startSerialPolling } from '@/lib/space/serial-polling.mjs';
import type { SpaceFollowUp } from '@/types';

export default function SpaceFollowUpPanel({ spaceId, showControl, refreshKey, onResults, onOpenHistory, hidden = false }: {
  spaceId: string;
  showControl: boolean;
  refreshKey: string;
  onResults: (signal: AbortSignal) => Promise<boolean>;
  onOpenHistory: () => void;
  hidden?: boolean;
}) {
  const [tasks, setTasks] = useState<SpaceFollowUp[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [contractMode, setContractMode] = useState(false);
  const [qqEnabled, setQQEnabled] = useState(false);
  const [maxContinuations, setMaxContinuations] = useState(3);
  const [qqChannel, setQQChannel] = useState<{ ready: boolean; reason: string; channel?: string }>({ ready: false, reason: '' });
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [progressExpanded, setProgressExpanded] = useState(false);
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
    setContractMode(false);
    setQQEnabled(false);
    setMaxContinuations(3);
    setQQChannel({ ready: false, reason: '' });
    setBusy(null);
    setError(null);
    setSettingsExpanded(false);
    setProgressExpanded(false);
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
        setContractMode(result.contractMode === true);
        setQQEnabled(result.qqEnabled);
        setMaxContinuations(result.settings?.maxContinuations ?? 3);
        setQQChannel(result.qqChannel);
        setAvailable(result.schedulerEnabled);
        setLoaded(true);
        setError(null);
        const changed = result.tasks.some(task => ['COMPLETED', 'FAILED'].includes(task.status)
          && seen.current?.get(task.id) !== `${task.status}:${task.updatedAt}`);
        if (changed && !await onResultsRef.current(signal)) return;
        if (!signal.aborted) seen.current = new Map(result.tasks.map(task => [task.id, `${task.status}:${task.updatedAt}`]));
      } catch (error: any) {
        if (!signal.aborted && version === mutationVersion.current && !mutationInFlight.current) setError(error.message || '读取跟进任务失败');
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
      setContractMode(result.contractMode === true);
      setQQEnabled(result.qqEnabled);
      setMaxContinuations(result.settings?.maxContinuations ?? 3);
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
  const running = active.some(task => task.status === 'RUNNING');
  const awakened = active.some(task => task.status === 'PENDING' && task.watchTriggeredAt);
  const next = active.filter(task => task.status === 'PENDING')
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())[0];
  const nextTime = next ? new Date(next.runAt).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '';
  if (hidden || (!showControl && (!enabled || active.length === 0))) return null;
  return (
    <section aria-label="自主跟进" className="shrink-0 border-b border-black/[0.06] bg-white px-4 py-2 sm:px-6">
      <div className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex shrink-0 items-center gap-2">
          <CalendarClock size={14} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-700">自主跟进</span>
          {showControl && (
            <button type="button" role="switch" aria-checked={enabled} aria-label="自主跟进与汇报"
              disabled={!loaded || busy !== null || (!available && !enabled)}
              onClick={() => void mutate('toggle', () => spaceFollowUps.setEnabled(spaceId, !enabled))}
              className={`relative h-5 w-9 rounded-full transition disabled:opacity-50 ${enabled ? 'bg-emerald-600' : 'bg-slate-200'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          )}
          {showControl && <span className="hidden text-[11px] text-slate-400 sm:inline">
            {!loaded ? '读取中…' : enabled ? '已开启' : '已关闭'}
          </span>}
        </div>
        {showControl && <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-slate-600">QQ 通知</span>
          <button type="button" role="switch" aria-checked={qqEnabled} aria-label={qqChannel.channel === 'PLATFORM_QQ' ? '平台重要变化QQ通知' : contractMode ? '鹰眼重要变化QQ通知' : '重要变化QQ通知'}
            title={!enabled ? '请先开启自主跟进' : !qqChannel.ready ? 'QQ 通道未就绪，展开设置查看原因' : qqChannel.channel === 'PLATFORM_QQ' ? '平台机器人仅通知重要变化' : contractMode ? '鹰眼仅通知重要变化' : '仅通知重要变化'}
            disabled={!loaded || busy !== null || (!qqEnabled && (!enabled || !available || !qqChannel.ready))}
            onClick={() => void mutate('qq-toggle', () => spaceFollowUps.setQQEnabled(spaceId, !qqEnabled))}
            className={`relative h-5 w-9 rounded-full transition disabled:opacity-50 ${qqEnabled ? 'bg-emerald-600' : 'bg-slate-200'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${qqEnabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          <span className="hidden text-[11px] text-slate-400 sm:inline">{!loaded ? '读取中…' : qqEnabled ? '已开启' : '已关闭'}</span>
        </div>}
        {active.length > 0 && <button type="button" onClick={() => setProgressExpanded(value => !value)} aria-expanded={progressExpanded}
          title={awakened ? '鹰眼已提前触发，原定时间仅作记录' : nextTime ? `下次跟进 ${nextTime} · ${next.title}` : '查看复查任务'}
          className="flex items-center gap-1.5 text-[11px] text-emerald-700 hover:text-emerald-800">
          {running && <Loader2 size={12} className="animate-spin" />}
          <span>{running ? `正在跟进 · ${active.length} 项待办` : `待跟进 ${active.length} 项`}</span>
          {awakened ? <span className="text-amber-700">· 鹰眼已触发，等待复查</span> : nextTime && <span className="hidden sm:inline">· 下次 {nextTime}</span>}
        </button>}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {!showControl && <button type="button" onClick={() => setProgressExpanded(value => !value)} aria-expanded={progressExpanded}
            aria-label="近期跟进进度" className="flex items-center gap-1 py-1 text-[11px] text-slate-500 hover:text-slate-800">
            近期进度 <ChevronDown size={12} className={progressExpanded ? 'rotate-180' : ''} />
          </button>}
          {showControl && <button type="button" onClick={() => setSettingsExpanded(value => !value)} aria-expanded={settingsExpanded}
            aria-label="自主跟进设置" className="flex items-center gap-1 py-1 text-[11px] text-slate-500 hover:text-slate-800">
            设置 <ChevronDown size={12} className={settingsExpanded ? 'rotate-180' : ''} />
          </button>}
        </div>
      </div>
      {showControl && settingsExpanded && <div className="mt-2 space-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
        <p>临时提问即时回答；开启后可在聊天中约定复查时间。新一轮最多续查 {maxContinuations} 次、持续 24 小时，不含首次。次数可在跟进记录中设置。关闭会取消未完成复查。</p>
        <p><span className="font-semibold text-slate-600">{qqChannel.channel === 'PLATFORM_QQ' ? '平台 · ' : contractMode ? '鹰眼 · ' : ''}重要变化 QQ 通知：</span>仅推送重要变化，普通跟进在空间内汇报。完整报告可在跟进记录及关联成果中查看。</p>
        {!qqChannel.ready && <p className="text-amber-700">
          {qqChannel.reason || (!loaded ? '正在读取 QQ 通知状态…' : 'QQ 通道未就绪，请在个人中心配置平台通知。')}
        </p>}
      </div>}
      {progressExpanded && <div aria-label="近期跟进任务" className="mt-3 max-h-48 space-y-2 overflow-y-auto">
        {tasks.map(task => <div key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          {task.status === 'RUNNING' && <Loader2 size={13} className="animate-spin text-emerald-600" />}
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{task.title}</span>
          {task.origin === 'AI_FOLLOW_UP' && <span className="text-emerald-700">AI 续查 {task.chainDepth ?? '—'}/{task.maxChainDepth ?? 3}</span>}
          <time className="text-slate-500">{task.watchTriggeredAt ? '鹰眼提前唤醒 · 原定 ' : ''}{new Date(task.runAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time>
          <span className="text-slate-500">{{ PENDING: '待跟进', RUNNING: '正在跟进', COMPLETED: '已汇报', FAILED: '未完成', CANCELLED: '已取消' }[task.status]}</span>
          {['PENDING', 'RUNNING'].includes(task.status) && <button type="button" disabled={busy !== null}
            onClick={() => void mutate(task.id, () => spaceFollowUps.cancel(spaceId, task.id))}
            className="text-slate-400 hover:text-rose-600 disabled:opacity-50">取消跟进</button>}
        </div>)}
        <button type="button" onClick={onOpenHistory} className="px-3 py-1 text-xs text-emerald-700 hover:text-emerald-800">查看全部跟进记录</button>
      </div>}
      {!available && <p className="mt-2 text-xs text-amber-700">服务器已暂停自主跟进。</p>}
      {error && <p className="mt-2 text-xs text-rose-600" role="status">{error}</p>}
    </section>
  );
}
