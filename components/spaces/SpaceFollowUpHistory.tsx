'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, ChevronDown, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { spaceFollowUps } from '@/lib/client/api';
import { startSerialPolling } from '@/lib/space/serial-polling.mjs';
import type { Agent, SpaceFollowUp } from '@/types';

const labels = { PENDING: '待跟进', RUNNING: '正在跟进', COMPLETED: '已汇报', FAILED: '未完成', CANCELLED: '已取消' };
const qqLabels = { PENDING: 'QQ 待发送', SENT: 'QQ 已发送', RETRYING: 'QQ 重试中', FAILED: 'QQ 已停止重试', CANCELLED: 'QQ 已取消' };
const filters = [ ['ALL', '全部'], ['ACTIVE', '待办'], ['COMPLETED', '已汇报'], ['FAILED', '未完成'], ['CANCELLED', '已取消'] ];
const displayTime = (time: string) => new Date(time).toLocaleString('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});

function FollowUpSettings({ spaceId, initialValue, maxAllowed, onSaved }: {
  spaceId: string; initialValue: number; maxAllowed: number; onSaved: () => void;
}) {
  const [limit, setLimit] = useState(initialValue);
  const [savedLimit, setSavedLimit] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const save = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const result = await spaceFollowUps.setMaxContinuations(spaceId, limit);
      setSavedLimit(result.maxContinuations); setSaved(true); onSaved();
    } catch (error: any) { setError(error.message || '保存设置失败，请重试'); }
    finally { setSaving(false); }
  };
  return <div className="mx-auto mt-4 max-w-5xl rounded-lg border border-slate-100 bg-slate-50 p-4">
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="follow-up-limit" className="text-xs font-semibold text-slate-700">每轮自动续查上限</label>
      <select id="follow-up-limit" value={limit} disabled={saving} onChange={event => { setLimit(Number(event.target.value)); setSaved(false); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
        {Array.from({ length: maxAllowed + 1 }, (_, count) => <option key={count} value={count}>{count} 次</option>)}
      </select>
      <button type="button" disabled={saving || limit === savedLimit} onClick={() => void save()} className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
        {saving && <Loader2 size={12} className="animate-spin" />}{saving ? '保存中…' : '保存设置'}
      </button>
      {saved && <span role="status" className="text-xs text-emerald-700">已保存</span>}
    </div>
    <p className="mt-3 text-xs leading-6 text-slate-500">不含首次约定复查。{limit === 0 ? '设为 0 时只执行首次复查，不再自动续查。' : `首次 1 次 + 最多续查 ${limit} 次，共最多 ${limit + 1} 次；AI 可以提前结束。`}</p>
    <p className="text-xs leading-6 text-slate-500">只对本空间新一轮跟进生效；已有任务沿用创建时的上限。每轮最长 24 小时，自动续查至少间隔 15 分钟。</p>
    {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
  </div>;
}

function FollowUpReport({ spaceId, task }: { spaceId: string; task: SpaceFollowUp }) {
  const [report, setReport] = useState<{ content: string; createdAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    spaceFollowUps.detail(spaceId, task.id, controller.signal).then(result => {
      if (!controller.signal.aborted) setReport(result.report);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.message || '读取汇报失败');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [spaceId, task.id, task.updatedAt, revision]);
  return <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
    {task.reason && <p className="mb-3 text-xs leading-6 text-slate-500">续查原因：{task.reason}</p>}
    {task.error && <p className="mb-3 text-xs leading-6 text-rose-600">未完成原因：{task.error}</p>}
    {task.qqNotification?.error && <p className="mb-3 text-xs leading-6 text-amber-700">QQ 通知：{task.qqNotification.error}</p>}
    {loading ? <p role="status" className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" />读取汇报…</p>
      : error ? <div role="alert" className="flex items-center gap-3 text-xs text-rose-600">{error}<button type="button" onClick={() => setRevision(value => value + 1)} className="underline">重试</button></div>
        : report ? <>
          <p className="mb-3 text-[11px] text-slate-400">汇报时间 {displayTime(report.createdAt)}</p>
          <div className="markdown-body min-w-0 overflow-x-auto break-words text-sm leading-7 text-slate-700"><ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content}</ReactMarkdown></div>
        </> : <p className="text-xs leading-6 text-slate-500">{task.status === 'PENDING' || task.status === 'RUNNING' ? '复查完成后，完整汇报会显示在这里，并写入空间对话。' : '本次没有生成汇报。'}</p>}
  </div>;
}

export default function SpaceFollowUpHistory({ spaceId, agents, workId, workTitle, onDiscussWork }: {
  spaceId: string; agents: Agent[]; workId?: string; workTitle?: string; onDiscussWork?: () => void;
}) {
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof spaceFollowUps.history>> | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [revision, setRevision] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    return startSerialPolling(async (signal: AbortSignal) => {
      try {
        const result = await spaceFollowUps.history(spaceId, { status, page, ...(workId ? { workId } : {}) }, signal);
        if (signal.aborted) return false;
        setData(result);
        setError('');
      } catch (error: any) {
        if (!signal.aborted) setError(error.message || '读取跟进记录失败');
      } finally { if (!signal.aborted) setLoading(false); }
    }, { immediate: true, delay: 10_000 });
  }, [spaceId, workId, status, page, revision]);

  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 20)));
  const cancel = async (task: SpaceFollowUp) => {
    setBusyId(task.id);
    setActionError('');
    try {
      await spaceFollowUps.cancel(spaceId, task.id);
      setRevision(value => value + 1);
    } catch (error: any) { setActionError(error.message || '取消失败，请重试'); }
    finally { setBusyId(null); }
  };
  return <section aria-label="跟进记录" className="flex min-h-0 flex-1 flex-col bg-[#fbfaf7]">
    <header className="shrink-0 border-b border-black/[0.06] bg-white px-4 py-5 sm:px-6">
      <div className="mx-auto flex max-w-5xl items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><CalendarClock size={19} />跟进记录</h2>
          <p className="mt-1 text-xs leading-6 text-slate-500">{workId ? `关联成果：${workTitle || '当前成果'}。` : '查看对话与成果的约定跟进、AI 续查及完整报告。'}{data ? `当前筛选共 ${data.total} 条` : ''}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" disabled={!data} aria-expanded={settingsExpanded} aria-label="跟进设置" onClick={() => setSettingsExpanded(value => !value)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"><Settings2 size={13} />设置</button>
          {onDiscussWork && <button type="button" onClick={onDiscussWork} className="rounded-lg px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-50">约定跟进</button>}
          <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />刷新</button>
        </div>
      </div>
      {settingsExpanded && data && <FollowUpSettings spaceId={spaceId} initialValue={data.settings?.maxContinuations ?? 3} maxAllowed={data.settings?.maxAllowedContinuations ?? 24} onSaved={() => setRevision(value => value + 1)} />}
      <nav aria-label="筛选跟进状态" className="mx-auto mt-4 flex max-w-5xl flex-wrap gap-2">
        {filters.map(([value, label]) => <button key={value} type="button" aria-pressed={status === value}
          onClick={() => { if (status === value) return; setStatus(value); setPage(1); setData(null); setExpandedId(null); }}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${status === value ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>{label}</button>)}
      </nav>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-3">
        {(error || actionError) && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-600">{error || actionError}</p>}
        {loading && <p role="status" className="flex items-center gap-2 py-4 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" />读取跟进记录…</p>}
        {!loading && !error && data?.tasks.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-12 text-center">
          <p className="text-sm font-semibold text-slate-600">{status === 'ALL' ? '还没有跟进记录' : '这个状态下暂无跟进记录'}</p>
          {status === 'ALL' && <p className="mt-2 text-xs leading-6 text-slate-400">开启本空间自主跟进后，在对话中约定目标和时间；选择成果后可以关联该成果。</p>}
        </div>}
        {!loading && data?.tasks.map(task => {
          const expanded = expandedId === task.id;
          const active = task.status === 'PENDING' || task.status === 'RUNNING';
          return <article key={task.id} className="overflow-hidden rounded-xl border border-black/[0.06] bg-white">
            <div className="flex items-center gap-2 px-4 py-4 sm:px-5">
              <button type="button" aria-expanded={expanded} aria-label={`查看跟进：${task.title}`} onClick={() => setExpandedId(expanded ? null : task.id)} className="min-w-0 flex-1 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words text-sm font-bold text-slate-800">{task.title}</span>
                  <span className={`rounded px-2 py-0.5 text-[11px] ${active ? 'bg-emerald-50 text-emerald-700' : task.status === 'FAILED' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>{labels[task.status]}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  <time>约定 {displayTime(task.runAt)}</time>
                  <span>{agents.find(agent => agent.id === task.agentId)?.name || task.agentId}</span>
                  <span>{task.origin === 'AI_FOLLOW_UP' ? `AI 续查 ${task.chainDepth ?? '—'}/${task.maxChainDepth ?? 3}` : '用户约定'}</span>
                  {!workId && <span>{task.workTitle ? `成果：${task.workTitle}${task.workId ? '' : '（已删除）'}` : '对话跟进'}</span>}
                  {task.qqNotification && <span className="text-emerald-700">{qqLabels[task.qqNotification.status]}</span>}
                </div>
              </button>
              {active && <button type="button" disabled={busyId !== null} onClick={() => void cancel(task)} className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">{busyId === task.id ? '取消中…' : '取消跟进'}</button>}
              <ChevronDown size={15} className={`shrink-0 text-slate-400 ${expanded ? 'rotate-180' : ''}`} />
            </div>
            {expanded && <FollowUpReport spaceId={spaceId} task={task} />}
          </article>;
        })}
      </div>
    </div>
    <footer className="flex shrink-0 items-center justify-center gap-4 border-t border-black/[0.06] bg-white px-4 py-3 text-xs text-slate-500">
      <button type="button" disabled={loading || !data || data.page <= 1} onClick={() => { setPage((data?.page || 1) - 1); setExpandedId(null); }} className="rounded-lg px-3 py-2 hover:bg-slate-100 disabled:opacity-30">上一页</button>
      <span>第 {data?.page || 1} / {pages} 页</span>
      <button type="button" disabled={loading || !data || data.page >= pages} onClick={() => { setPage((data?.page || 1) + 1); setExpandedId(null); }} className="rounded-lg px-3 py-2 hover:bg-slate-100 disabled:opacity-30">下一页</button>
    </footer>
  </section>;
}
