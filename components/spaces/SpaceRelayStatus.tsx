'use client';

import { ExternalLink, Loader2, Repeat2, RotateCcw, Square, X } from 'lucide-react';
import type { Agent, SpaceRelay } from '@/types';

const ACTIVE = new Set(['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'CANCEL_REQUESTED']);

export default function SpaceRelayStatus({ relay, agents, busy, onAction, onOpen, onDismiss }: {
  relay: SpaceRelay;
  agents: Agent[];
  busy: boolean;
  onAction: (action: 'cancel' | 'approve' | 'reject') => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const currentAgent = agents.find((agent) => agent.id === relay.participantIds[relay.currentIndex]);
  const state = relay.state && typeof relay.state === 'object' ? relay.state as Record<string, unknown> : null;
  const summarizing = state?.phase === 'summarizing';
  const recent = relay.transcript?.at(-1);
  const recentBoardAction = recent?.action && 'row' in recent.action ? recent.action : null;
  const recentCollaborationAction = recent?.action && 'content' in recent.action ? recent.action : null;
  const pendingBoardAction = relay.pendingAction?.action && 'row' in relay.pendingAction.action ? relay.pendingAction.action : null;
  const pendingCollaborationAction = relay.pendingAction?.action && 'content' in relay.pendingAction.action ? relay.pendingAction.action : null;
  const pendingContinuation = relay.pendingAction?.type === 'coordinator_continue';
  const active = ACTIVE.has(relay.status);
  const title = relay.status === 'COMPLETED' ? '接力已完成'
    : relay.status === 'CANCELLED' ? '接力已停止'
      : relay.status === 'FAILED' ? '接力失败'
        : pendingContinuation ? '协调者建议继续一轮'
          : summarizing ? '空间协调者正在验收'
            : relay.status === 'WAITING_APPROVAL' ? `等待确认 · ${relay.pendingAction?.agentName || currentAgent?.name || '成员'}`
          : relay.status === 'CANCEL_REQUESTED' ? '正在停止接力'
            : `${currentAgent?.name || '成员'}正在行动`;

  return (
    <div className="border-y border-black/[0.06] bg-white px-3 py-3 sm:px-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          {active && relay.status !== 'WAITING_APPROVAL' ? <Loader2 className="animate-spin" size={15} /> : <Repeat2 size={15} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-black text-slate-900">{title}</div>
            {active && relay.status !== 'WAITING_APPROVAL' && (
              <button type="button" onClick={() => onAction('cancel')} disabled={busy || relay.status === 'CANCEL_REQUESTED'} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-black text-rose-500 hover:bg-rose-50 disabled:text-slate-300"><Square size={12} />停止</button>
            )}
            {!active && <button type="button" onClick={onDismiss} title="关闭" aria-label="关闭接力状态" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={15} /></button>}
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-400">第 {relay.turnCount}/{relay.maxTurns} {relay.kind === 'gomoku' ? '手' : '轮'} · {relay.approvalMode === 'AUTO' ? '自动执行' : '每轮确认'}</div>
          {recentBoardAction && <div className="mt-2 text-xs font-semibold text-slate-600">最近：{recent?.agentName} 落子 {recentBoardAction.row},{recentBoardAction.column}{recentBoardAction.comment ? ` · ${recentBoardAction.comment}` : ''}</div>}
          {recentCollaborationAction && <div className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">最近：{recent?.agentName} · {recentCollaborationAction.content}</div>}

          {relay.status === 'WAITING_APPROVAL' && relay.pendingAction && (
            <div className="mt-3 border-t border-black/[0.06] pt-3">
              {pendingContinuation && (
                <>
                  <div className="text-xs font-semibold leading-5 text-slate-600">{relay.pendingAction.summary}</div>
                  <div className="mt-2 text-xs font-black leading-5 text-slate-700">下一轮：{relay.pendingAction.instruction}</div>
                </>
              )}
              {pendingBoardAction && <div className="text-xs font-black text-slate-700">拟落子 {pendingBoardAction.row},{pendingBoardAction.column}</div>}
              {pendingBoardAction?.comment && <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">{pendingBoardAction.comment}</div>}
              {pendingCollaborationAction && <div className="text-xs font-semibold leading-5 text-slate-600">{pendingCollaborationAction.content}</div>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => onAction('approve')} disabled={busy} className="h-8 rounded-lg bg-slate-950 px-3 text-xs font-black text-white disabled:bg-slate-200">{pendingContinuation ? '继续一轮' : relay.kind === 'gomoku' ? '确认这一步' : '确认本轮'}</button>
                <button type="button" onClick={() => onAction('reject')} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-600 disabled:text-slate-300">{pendingContinuation ? null : <RotateCcw size={12} />}{pendingContinuation ? '结束接力' : '重新生成'}</button>
                {!pendingContinuation && <button type="button" onClick={() => onAction('cancel')} disabled={busy} className="h-8 rounded-lg px-3 text-xs font-black text-rose-500 disabled:text-slate-300">停止</button>}
              </div>
            </div>
          )}

          {relay.status === 'COMPLETED' && relay.kind === 'gomoku' && <button type="button" onClick={onOpen} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-black text-white"><ExternalLink size={13} />打开棋盘</button>}
          {relay.error && <div className="mt-2 text-xs font-semibold text-rose-600">{relay.error}</div>}
        </div>
      </div>
    </div>
  );
}
