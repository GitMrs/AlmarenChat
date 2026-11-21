'use client';

import { useEffect, useState } from 'react';
import type { EagleMonitorInfo, SpaceFollowUp } from '@/types';
import { watchHealthPresentation } from '@/lib/space/eagle-monitor.mjs';

const time = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}) : '暂无记录';
const tone = (state: string) => ['ERROR', 'PARTIAL_ERROR', 'DATA_ERROR', 'DELAYED'].includes(state)
  ? 'text-amber-800 bg-amber-50 border-amber-200' : state === 'HEALTHY' || state === 'WATCHING'
    ? 'text-emerald-800 bg-emerald-50 border-emerald-100' : 'text-slate-600 bg-slate-50 border-slate-200';

function useMonitorClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  return now;
}

export function EagleMonitorSummary({ info }: { info?: EagleMonitorInfo | null }) {
  const [expanded, setExpanded] = useState(false);
  const now = useMonitorClock();
  if (!info) return null;
  const lastRecord = Math.max(Date.parse(info.lastStartedAt || '') || 0, Date.parse(info.lastFinishedAt || '') || 0);
  if (info.state !== 'PAUSED' && lastRecord && now - lastRecord > 90000) info = { ...info,
    state: 'DELAYED', label: '巡检状态已过期', message: '超过90秒没有新巡检记录，无法确认当前监测有效。' };
  return <section aria-label="鹰眼跟进监测" className="mt-3 rounded-lg border border-slate-200 bg-white text-xs">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-left">
      <span className="font-semibold text-slate-700">鹰眼 · 条件监测</span>
      <span className={`rounded border px-2 py-0.5 text-[11px] ${tone(info.state)}`}>{info.label}</span>
      <span className="text-slate-500">{info.conditions}项待监测条件</span>
      <span className="ml-auto text-slate-400">{expanded ? '收起监测详情 ▴' : '监测详情 ▾'}</span>
    </button>
    <p role={['ERROR', 'PARTIAL_ERROR', 'DELAYED'].includes(info.state) ? 'status' : undefined}
      className="px-3 pb-2.5 text-[11px] leading-5 text-slate-500">{info.message}</p>
    {expanded && <div className="space-y-2 border-t border-slate-100 px-3 py-3 text-[11px] leading-6 text-slate-500">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <div><dt className="inline">最近巡检开始：</dt><dd className="inline">{time(info.lastStartedAt)}</dd></div>
        <div><dt className="inline">最近巡检结束：</dt><dd className="inline">{time(info.lastFinishedAt)}</dd></div>
        <div><dt className="inline">巡检流程最近成功：</dt><dd className="inline">{time(info.lastSuccessAt)}</dd></div>
        <div><dt className="inline">巡检流程最近异常：</dt><dd className="inline">{time(info.lastErrorAt)}</dd></div>
      </dl>
      {info.consecutiveFailures > 0 && <p className="text-amber-800">巡检流程连续失败{info.consecutiveFailures}次。服务器恢复后会在后续巡检重试。</p>}
      <p>这里展示跟进条件的巡检情况。单项行情与条件是否有效，请展开对应任务；复查、审核和QQ投递仍分别查看原有进度。持仓与计划守护在作战中心查看。</p>
    </div>}
  </section>;
}

export function TaskEagleMonitor({ task, detailed = false, paused = false }: { task: SpaceFollowUp; detailed?: boolean; paused?: boolean }) {
  const now = useMonitorClock();
  const status = watchHealthPresentation(task, now);
  if (!status) return null;
  const label = paused && task.status === 'PENDING' && !task.watchTriggeredAt ? '监测已暂停' : status.label;
  const health = task.watchHealth;
  const conditions = Array.isArray(task.watchConditions) ? task.watchConditions.filter(rule => rule && Number.isFinite(rule.level)
    && rule.level > 0 && ['PRICE', '15m', '1H'].includes(rule.period) && ['ABOVE', 'BELOW'].includes(rule.direction)) : [];
  return <section aria-label={detailed ? '本任务鹰眼监测详情' : '本任务鹰眼监测'} className={detailed ? 'mb-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3' : 'mt-2 border-t border-slate-100 pt-2'}>
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="font-semibold text-slate-500">鹰眼监测</span>
      <span className={`rounded border px-1.5 py-0.5 ${tone(paused ? 'PAUSED' : status.state)}`}>{label}</span>
      {health?.lastCheckedAt && <span className="text-slate-400">最近核验 {time(health.lastCheckedAt)}</span>}
    </div>
    {(detailed || health?.error || status.state === 'DELAYED') && <p className="mt-1 text-[11px] leading-6 text-slate-500">{paused ? '条件监测已暂停；原定时复查是否执行以自主跟进开关为准。' : `${status.message}${health?.error ? `；最近监测异常：${health.error.message}` : ''}`}</p>}
    {detailed && <div className="mt-2 space-y-2 text-xs leading-6 text-slate-600">
      {task.watchEvent && <p className="text-amber-800">触发依据：{task.watchEvent.symbol} · {task.watchEvent.period === 'PRICE' ? '盘中预警' : `${task.watchEvent.period}收盘变化`}，观察位{task.watchEvent.level.toLocaleString()}，采样{task.watchEvent.price.toLocaleString()}。</p>}
      <ul className="space-y-2">
        {conditions.map((rule, index) => {
          const sample = health?.samples?.find(row => row.symbol === rule.symbol && row.period === rule.period && row.direction === rule.direction && row.level === rule.level);
          return <li key={index} className="rounded bg-white px-2 py-1.5">
            <p>{rule.symbol} · {rule.period === 'PRICE' ? '盘中价格' : `${rule.period}收盘`} · {rule.direction === 'ABOVE' ? '上穿' : '下穿'} {rule.level.toLocaleString()}</p>
            <p className="text-[11px] text-slate-500">{sample ? `${sample.message}；采样${sample.price ?? '不可用'}，数据时间${time(sample.sampledAt)}` : '尚无此条件的有效采样记录'}</p>
          </li>;
        })}
      </ul>
      {health?.error && <p className="text-amber-800">最近监测异常：{health.error.message} · 连续{health.consecutiveFailures}次。定时任务的执行状态请查看跟进进度。</p>}
      {health?.lastError && !health.error && <p>最近异常：{health.lastError.message}（{time(health.lastError.at)}）；后续核验已恢复。</p>}
      {health?.lastSuccessAt && <p className="text-[11px] text-slate-500">本任务全部条件最近有效核验：{time(health.lastSuccessAt)}</p>}
      {!!health?.events?.length && <details className="border-t border-slate-200 pt-2">
        <summary className="cursor-pointer text-[11px] text-slate-500">最近监测变化（{health.events.length}条）</summary>
        <ol className="mt-2 space-y-1 text-[11px] text-slate-500">{[...health.events].reverse().map((event, index) => <li key={index}>{time(event.at)} · {event.message}</li>)}</ol>
      </details>}
    </div>}
  </section>;
}
