'use client';

import { Globe2, Loader2, MessagesSquare, Square, X } from 'lucide-react';
import type { Agent, SpaceDiscussion } from '@/types';

const ACTIVE = new Set(['QUEUED', 'RUNNING', 'WAITING_RESEARCH', 'CANCEL_REQUESTED']);

export default function SpaceDiscussionStatus({
  discussion,
  agents,
  busy,
  onCancel,
  onResearch,
  onConvert,
  onDismiss,
}: {
  discussion: SpaceDiscussion;
  agents: Agent[];
  busy: boolean;
  onCancel: () => void;
  onResearch: (approved: boolean, scope?: 'once' | 'discussion') => void;
  onConvert: () => void;
  onDismiss: () => void;
}) {
  const participants = discussion.participantIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter(Boolean) as Agent[];
  const sequence = discussion.currentRound === 2 ? [...participants].reverse() : participants;
  const currentAgent = sequence[discussion.currentIndex];
  const summarizing = discussion.currentRound > discussion.maxRounds && ACTIVE.has(discussion.status);
  const active = ACTIVE.has(discussion.status);

  return (
    <div className="border-y border-black/[0.06] bg-white px-3 py-3 sm:px-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          {active ? <Loader2 className="animate-spin" size={15} /> : <MessagesSquare size={15} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-black text-slate-900">
              {discussion.status === 'COMPLETED'
                ? '讨论已完成'
                : discussion.status === 'CANCELLED'
                  ? '讨论已停止'
                  : discussion.status === 'FAILED'
                    ? '讨论失败'
                    : summarizing
                      ? '协调者正在总结'
                      : `第 ${discussion.currentRound}/${discussion.maxRounds} 轮 · ${currentAgent?.name || '准备中'}`}
            </div>
            {active && discussion.status !== 'WAITING_RESEARCH' && (
              <button type="button" onClick={onCancel} disabled={busy || discussion.status === 'CANCEL_REQUESTED'} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-black text-rose-500 hover:bg-rose-50 disabled:text-slate-300">
                <Square size={12} />停止
              </button>
            )}
            {!active && (
              <button type="button" onClick={onDismiss} title="关闭" aria-label="关闭讨论状态" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900">
                <X size={15} />
              </button>
            )}
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-slate-400">{discussion.topic}</div>

          {discussion.status === 'WAITING_RESEARCH' && discussion.pendingResearch && (
            <div className="mt-3 border-t border-black/[0.06] pt-3">
              <div className="flex items-start gap-2 text-xs font-black text-slate-700">
                <Globe2 className="mt-0.5 shrink-0" size={14} />
                <span>{discussion.pendingResearch.agentName} 申请联网查询</span>
              </div>
              <div className="mt-2 text-xs font-semibold leading-5 text-slate-600">{discussion.pendingResearch.query}</div>
              <div className="mt-1 text-xs font-semibold leading-5 text-slate-400">{discussion.pendingResearch.reason}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => onResearch(true, 'once')} disabled={busy} className="h-8 rounded-lg bg-slate-950 px-3 text-xs font-black text-white disabled:bg-slate-200">允许本次</button>
                <button type="button" onClick={() => onResearch(true, 'discussion')} disabled={busy} className="h-8 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-600 disabled:text-slate-300">本次讨论均允许</button>
                <button type="button" onClick={() => onResearch(false)} disabled={busy} className="h-8 rounded-lg px-3 text-xs font-black text-slate-500 disabled:text-slate-300">拒绝</button>
              </div>
            </div>
          )}

          {discussion.status === 'COMPLETED' && (
            <button type="button" onClick={onConvert} className="mt-3 h-8 rounded-lg bg-slate-950 px-3 text-xs font-black text-white">转为任务</button>
          )}
          {discussion.error && <div className="mt-2 text-xs font-semibold text-rose-600">{discussion.error}</div>}
        </div>
      </div>
    </div>
  );
}
