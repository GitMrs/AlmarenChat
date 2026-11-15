'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, ChevronDown, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { notifications, type InboxNotification } from '@/lib/client/api';
import { startSerialPolling } from '@/lib/space/serial-polling.mjs';

const kinds: Record<string, string> = { REMINDER: '待办提醒', FOLLOW_UP: '空间跟进', MARKET: '行情告警', AUTOMATION: '自动化结果', SYSTEM: '平台通知' };
const statuses: Record<string, string> = { SENT: '已发送', PENDING: '待发送', RETRYING: '等待重试', FAILED: '发送失败', CANCELLED: '已取消', NOT_CONFIGURED: '未启用' };
export default function NotificationCenter({ onUnreadChange }: { onUnreadChange?: (count: number) => void }) {
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof notifications.list>> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const mutationVersion = useRef(0);
  useEffect(() => {
    setLoading(true);
    return startSerialPolling(async (signal: AbortSignal) => {
      const version = mutationVersion.current;
      try {
        const result = await notifications.list(filter, page, signal);
        if (signal.aborted || version !== mutationVersion.current) return false;
        setData(result); setError(''); onUnreadChange?.(result.unread);
      } catch (error: any) { if (!signal.aborted) setError(error.message || '读取通知失败'); }
      finally { if (!signal.aborted) setLoading(false); }
    }, { immediate: true, delay: 30_000 });
  }, [filter, page, revision, onUnreadChange]);
  useEffect(() => { if (data) onUnreadChange?.(data.unread); }, [data?.unread, onUnreadChange]);
  const mark = async (item?: InboxNotification) => {
    if (busy) return;
    mutationVersion.current++;
    setBusy(true); setError('');
    try {
      if (item) {
        await notifications.read(item.id);
        setData(current => current ? { ...current, unread: Math.max(0, current.unread - (current.notifications.find(row => row.id === item.id)?.readAt ? 0 : 1)), notifications: current.notifications.map(row => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row) } : current);
      } else { await notifications.readAll(); setRevision(value => value + 1); }
    }
    catch (error: any) { setError(error.message || '标记已读失败'); }
    finally { setBusy(false); }
  };
  const pages = Math.max(1, Math.ceil((data?.total || 0) / 20));
  return <section className="space-y-5" aria-label="我的通知">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-black/[0.06] bg-white p-6">
      <div><h2 className="flex items-center gap-2 text-xl font-black text-slate-950"><Bell size={20} />我的通知</h2><p className="mt-2 text-sm text-slate-500">待办、跟进、行情与自动化的重要消息，统一保存在这里。</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/me?tab=settings#platform-notifications" className="rounded-xl px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50">通知渠道设置</Link>
        <button type="button" disabled={busy || !data?.unread} onClick={() => void mark()} className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold disabled:opacity-40"><CheckCheck size={14} />全部已读</button>
        <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} aria-label="刷新通知" className="rounded-xl border p-2 disabled:opacity-40"><RefreshCw size={15} /></button>
      </div>
    </header>
    <nav className="flex gap-2" aria-label="筛选通知">{[['ALL', '全部'], ['UNREAD', `未读${data ? `（${data.unread}）` : ''}`]].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { if (filter === value) return; setFilter(value); setPage(1); setData(null); setExpanded(null); }} className={`rounded-full px-4 py-2 text-sm font-bold ${filter === value ? 'bg-slate-950 text-white' : 'bg-white text-slate-500'}`}>{label}</button>)}</nav>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-600">{error}</p>}
    {loading && <p role="status" className="flex items-center gap-2 p-4 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" />正在读取通知…</p>}
    {!loading && !error && data?.notifications.length === 0 && <div className="rounded-[24px] border border-dashed border-black/10 bg-white p-12 text-center"><Bell size={28} className="mx-auto mb-3 text-slate-300" /><p className="text-sm font-bold text-slate-600">{filter === 'UNREAD' ? '暂时没有未读通知' : '暂时没有通知'}</p><p className="mt-2 text-xs text-slate-400">新的通知会保存在这里，QQ 未配置或发送失败也能查看。</p></div>}
    {!loading && data?.notifications.map(item => <article key={item.id} className={`overflow-hidden rounded-[24px] border bg-white ${item.readAt ? 'border-black/[0.06]' : 'border-indigo-200'}`}>
      <div className="flex items-start gap-3 p-5">
        <button type="button" aria-expanded={expanded === item.id} onClick={() => { setExpanded(expanded === item.id ? null : item.id); if (!item.readAt) void mark(item); }} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">{!item.readAt && <span aria-label="未读" className="h-2 w-2 shrink-0 rounded-full bg-indigo-500" />}<h3 className="break-words text-sm font-bold text-slate-900">{item.title}</h3></div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400"><span>{kinds[item.kind] || '平台通知'}</span><time>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}</time>{item.deliveries.length === 0 && <span>仅站内</span>}{item.deliveries.map(delivery => <span key={delivery.channel} className={delivery.status === 'FAILED' ? 'text-rose-600' : delivery.status === 'SENT' ? 'text-emerald-700' : ''}>{delivery.channel === 'WEBHOOK' ? 'Webhook' : delivery.channel} {statuses[delivery.status] || delivery.status}</span>)}</div>
          {expanded !== item.id && <p className="mt-3 line-clamp-2 break-words text-sm leading-6 text-slate-500">{item.content}</p>}
        </button>
        <ChevronDown size={16} className={`mt-1 shrink-0 text-slate-400 ${expanded === item.id ? 'rotate-180' : ''}`} />
      </div>
      {expanded === item.id && <div className="space-y-4 border-t border-slate-100 p-5">
        <div className="markdown-body min-w-0 overflow-x-auto break-words text-sm leading-7 text-slate-700"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown></div>
        {item.deliveries.filter(delivery => delivery.error).map(delivery => <p key={delivery.channel} className="text-xs text-amber-700">{delivery.channel}：{delivery.error}</p>)}
        {item.sourceHref && /^\/(?!\/)/.test(item.sourceHref) && <Link href={item.sourceHref} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700">查看来源<ExternalLink size={13} /></Link>}
      </div>}
    </article>)}
    {(data?.total || 0) > 20 && <footer className="flex items-center justify-center gap-4 text-xs text-slate-500"><button type="button" disabled={loading || data!.page <= 1} onClick={() => setPage(data!.page - 1)} className="rounded-xl bg-white px-3 py-2 disabled:opacity-40">上一页</button><span>第 {data?.page || 1} / {pages} 页</span><button type="button" disabled={loading || data!.page >= pages} onClick={() => setPage(data!.page + 1)} className="rounded-xl bg-white px-3 py-2 disabled:opacity-40">下一页</button></footer>}
  </section>;
}
