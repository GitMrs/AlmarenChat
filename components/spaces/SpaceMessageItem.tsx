'use client';

import { Check, ChevronRight, FileText, Globe2, ListTodo, Loader2, Pencil, X } from 'lucide-react';
import MessageActions from '@/components/chat/MessageActions';
import MessageBubbleFrame from '@/components/chat/MessageBubbleFrame';
import MessageContent from '@/components/chat/MessageContent';
import { taskProposalCapabilities } from '@/lib/task-proposals';
import type { Agent, AgentRun, SpaceMessage, SpaceTaskProposal } from '@/types';

const RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: '等待执行',
  PLANNING: '正在规划',
  RUNNING: '正在执行',
  WAITING_APPROVAL: '等待审核',
  SUMMARIZING: '正在汇总',
  COMPLETED: '已完成',
  FAILED: '执行失败',
  CANCEL_REQUESTED: '正在取消',
  CANCELLED: '已取消',
};

function TaskProposal({
  proposal,
  run,
  busy,
  approvalDisabled,
  onApprove,
  onRevise,
  onReject,
  onOpenRun,
}: {
  proposal: SpaceTaskProposal;
  run?: AgentRun | null;
  busy: boolean;
  approvalDisabled: boolean;
  onApprove?: () => void;
  onRevise?: () => void;
  onReject?: () => void;
  onOpenRun?: () => void;
}) {
  const completed = run?.tasks.filter((task) => task.status === 'COMPLETED').length || 0;
  const progress = run?.tasks.length ? Math.round((completed / run.tasks.length) * 100) : 0;
  const pending = proposal.status === 'pending';
  const capabilities = proposal.capabilities || taskProposalCapabilities(proposal.goal, proposal.steps, proposal.deliverables);

  return (
    <div className="mt-4 border-t border-black/[0.08] pt-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <ListTodo size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black text-slate-400">任务方案</div>
          <h3 className="mt-1 text-sm font-black text-slate-950">{proposal.title}</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{proposal.summary}</p>
        </div>
      </div>

      {pending ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-400">
            <span>{proposal.steps.length} 个步骤</span>
            <span>{proposal.deliverables.length} 项产出</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">
              <FileText size={12} />
              读写空间文件
            </span>
            {capabilities.includes('web_research') && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                <Globe2 size={12} />
                受控联网
              </span>
            )}
          </div>
          <details className="group mt-4 border-y border-black/[0.06]">
            <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-xs font-black text-slate-600 marker:hidden">
              <span>查看执行方案</span>
              <ChevronRight className="text-slate-300 transition-transform group-open:rotate-90" size={15} />
            </summary>
            <div className="pb-4">
              <div className="mb-4">
                <div className="text-[11px] font-black text-slate-400">任务目标</div>
                <p className="mt-1 whitespace-pre-wrap text-xs font-semibold leading-5 text-slate-600">{proposal.goal}</p>
              </div>
              <ol className="space-y-2">
                {proposal.steps.map((step, index) => (
                  <li key={`${index}-${step}`} className="flex gap-2.5 text-xs font-semibold leading-5 text-slate-600">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-500">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {proposal.deliverables.length > 0 && (
                <div className="mt-4 text-xs font-semibold leading-5 text-slate-500">
                  <span className="font-black text-slate-700">预期产出：</span>{proposal.deliverables.join('、')}
                </div>
              )}
            </div>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onApprove}
              disabled={busy || approvalDisabled}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {busy ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
              确认并执行
            </button>
            <button
              type="button"
              onClick={onRevise}
              disabled={busy || approvalDisabled}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-black text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:border-slate-100 disabled:text-slate-300"
            >
              <Pencil size={13} />
              调整方案
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300"
            >
              <X size={14} />
              暂不执行
            </button>
          </div>
          {approvalDisabled && <div className="mt-2 text-xs font-semibold text-slate-400">当前任务完成后可以确认这份方案</div>}
        </>
      ) : proposal.status === 'rejected' ? (
        <div className="mt-4 text-xs font-black text-slate-400">已取消这份方案</div>
      ) : (
        <button type="button" onClick={onOpenRun} className="mt-4 flex w-full items-center gap-3 border-t border-black/[0.06] pt-3 text-left">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3 text-xs font-black">
              <span className={run?.status === 'FAILED' ? 'text-rose-500' : run?.status === 'COMPLETED' ? 'text-emerald-600' : 'text-slate-700'}>
                {run ? RUN_STATUS_LABELS[run.status] || run.status : '任务已确认'}
              </span>
              {run && <span className="text-slate-400">{completed}/{run.tasks.length || '—'}</span>}
            </div>
            {run && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status) && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${Math.max(4, progress)}%` }} />
              </div>
            )}
          </div>
          <ChevronRight className="shrink-0 text-slate-300" size={16} />
        </button>
      )}
    </div>
  );
}

export default function SpaceMessageItem({
  message,
  speaker,
  fallbackColor,
  latestAssistantMessageId,
  copied,
  active,
  onActivate,
  onCopy,
  onRegenerate,
  onDelete,
  run,
  proposalBusy = false,
  proposalDisabled = false,
  onApproveProposal,
  onReviseProposal,
  onRejectProposal,
  onOpenRun,
}: {
  message: SpaceMessage;
  speaker?: Agent | null;
  fallbackColor: string;
  latestAssistantMessageId?: string;
  copied: boolean;
  active: boolean;
  onActivate: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  run?: AgentRun | null;
  proposalBusy?: boolean;
  proposalDisabled?: boolean;
  onApproveProposal?: (proposal: SpaceTaskProposal) => void;
  onReviseProposal?: (proposal: SpaceTaskProposal) => void;
  onRejectProposal?: () => void;
  onOpenRun?: () => void;
}) {
  const isUser = message.role === 'user';
  const proposal = message.attachments?.find((attachment): attachment is SpaceTaskProposal => attachment.type === 'task_proposal');
  return (
    <MessageBubbleFrame
      role={message.role}
      avatar={speaker?.avatar}
      agentName={speaker?.name || '空间 Agent'}
      userColor={fallbackColor}
      showAvatar={!isUser}
      showAgentName={!isUser}
      onActivate={onActivate}
      footer={
        <MessageActions
          role={message.role}
          createdAt={message.createdAt}
          copied={copied}
          active={active}
          canRegenerate={message.id === latestAssistantMessageId}
          onCopy={onCopy}
          onRegenerate={onRegenerate}
          onDelete={onDelete}
        />
      }
    >
      <MessageContent
        role={message.role}
        content={message.content}
        attachments={message.attachments}
        shouldAutoCollapse={message.id !== latestAssistantMessageId}
      />
      {proposal && (
        <TaskProposal
          proposal={proposal}
          run={run}
          busy={proposalBusy}
          approvalDisabled={proposalDisabled}
          onApprove={() => onApproveProposal?.(proposal)}
          onRevise={() => onReviseProposal?.(proposal)}
          onReject={onRejectProposal}
          onOpenRun={onOpenRun}
        />
      )}
    </MessageBubbleFrame>
  );
}
