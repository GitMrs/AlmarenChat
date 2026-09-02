'use client';

import { Activity, BookOpen, Check, CheckCircle2, ChevronRight, Clock3, Code2, FileText, Globe2, Image as ImageIcon, ListTodo, Loader2, RotateCcw, X, Pencil } from 'lucide-react';
import MessageActions from '@/components/chat/MessageActions';
import MessageBubbleFrame from '@/components/chat/MessageBubbleFrame';
import MessageContent from '@/components/chat/MessageContent';
import type { Agent, AgentRun, SpaceMessage, SpaceRunResultAttachment, SpaceTaskProposal } from '@/types';

const RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: '等待执行',
  PLANNING: '正在规划',
  RUNNING: '正在执行',
  WAITING: '等待补充信息',
  WAITING_APPROVAL: '等待审核',
  SUMMARIZING: '正在汇总',
  COMPLETED: '已完成',
  PARTIAL: '部分完成',
  FAILED_VALIDATION: '验收失败',
  BLOCKED: '缺少必要条件',
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
  const pending = proposal.status === 'pending';
  const capabilities = proposal.capabilities || ['workspace_read'];
  const activeTask = run?.tasks.find((task) => ['RUNNING', 'SUBMITTED', 'REVIEWING', 'WAITING', 'WAITING_APPROVAL', 'PENDING'].includes(task.status));
  const recentEvents = (run?.events || [])
    .filter((event) => !['MODEL_STREAMING', 'RUN_STARTED'].includes(event.type))
    .slice(-4);
  const isTerminal = Boolean(run && ['COMPLETED', 'PARTIAL', 'FAILED_VALIDATION', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(run.status));
  const stageLabel = activeTask?.status === 'REVIEWING' || activeTask?.status === 'SUBMITTED'
    ? '协调者正在验收'
    : activeTask?.status === 'WAITING'
      ? '等待你补充信息'
      : activeTask?.status === 'PENDING'
        ? '准备下一项工作'
        : activeTask?.status === 'RUNNING'
          ? `${activeTask.agentName}正在工作`
          : run?.status === 'SUMMARIZING'
            ? '正在整理最终交付'
            : RUN_STATUS_LABELS[run?.status || ''] || '任务已确认';

  return (
    <div className="mt-4 border-t border-black/[0.08] pt-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <ListTodo size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black text-slate-400">目标授权</div>
          <h3 className="mt-1 text-sm font-black text-slate-950">{proposal.title}</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{proposal.summary}</p>
        </div>
      </div>

      {pending ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-400">
            <span>{proposal.steps.length} 个里程碑</span>
            <span>{proposal.deliverables.length} 项产出</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {proposal.skillSnapshot && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                <BookOpen size={12} />
                {proposal.skillSnapshot.name}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">
              <FileText size={12} />
              {capabilities.includes('workspace_write') ? '读写空间文件' : '读取空间资料'}
            </span>
            {capabilities.includes('code_execute') && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">
                <Code2 size={12} />
                隔离运行代码
              </span>
            )}
            {capabilities.includes('image_generate') && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-black text-sky-700">
                <ImageIcon size={12} />
                最多生成 2 张图片
              </span>
            )}
            {(proposal.networkPolicy || (capabilities.includes('web_research') ? 'required' : 'forbidden')) !== 'forbidden' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                <Globe2 size={12} />
                {proposal.networkPolicy === 'allowed' ? '按需联网' : '必须联网'}
              </span>
            )}
          </div>
          <details className="group mt-4 border-y border-black/[0.06]">
            <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-xs font-black text-slate-600 marker:hidden">
              <span>查看授权范围</span>
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
                    <span className="min-w-0 flex-1 font-black text-slate-700">{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-[11px] font-semibold leading-5 text-slate-400">
                确认后，协调者会根据空间成员、实时状态和每轮成果动态安排下一项工作。
              </p>
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
        <div className="mt-4 border-t border-black/[0.06] pt-4">
          <button type="button" onClick={onOpenRun} className="flex w-full items-start gap-3 text-left">
            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isTerminal ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'}`}>
              {isTerminal ? <CheckCircle2 size={16} /> : <Activity size={16} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-black text-slate-400">{isTerminal ? '任务交付' : '团队工作中'}</span>
                {run && <span className="text-[11px] font-bold text-slate-400">已验收 {completed} 项</span>}
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm font-black text-slate-800">
                {!isTerminal && <Loader2 className="shrink-0 animate-spin text-sky-500" size={14} />}
                <span className="min-w-0 break-words">{stageLabel}</span>
              </div>
              {activeTask && <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">{activeTask.title}</p>}
            </div>
            <ChevronRight className="mt-2 shrink-0 text-slate-300" size={16} />
          </button>
          {recentEvents.length > 0 && !isTerminal && (
            <div className="mt-3 space-y-2 border-l-2 border-slate-100 pl-3">
              {recentEvents.map((event) => (
                <div key={event.id} className="flex min-w-0 items-start gap-2 text-[11px] font-semibold leading-5 text-slate-500">
                  {event.type === 'TASK_REVISION_REQUIRED'
                    ? <RotateCcw className="mt-0.5 shrink-0 text-amber-500" size={12} />
                    : event.type === 'TASK_ACCEPTED'
                      ? <Check className="mt-0.5 shrink-0 text-emerald-500" size={12} />
                      : <Clock3 className="mt-0.5 shrink-0 text-slate-300" size={12} />}
                  <span className="min-w-0 break-words">{event.message}</span>
                </div>
              ))}
            </div>
          )}
          {isTerminal && run?.result && <p className="mt-3 line-clamp-3 text-xs font-semibold leading-5 text-slate-500">{run.result}</p>}
          <button type="button" onClick={onOpenRun} className="mt-3 inline-flex items-center gap-1 text-xs font-black text-slate-500 hover:text-slate-950">
            查看完整流程 <ChevronRight size={13} />
          </button>
        </div>
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
  const runResult = message.attachments?.find((attachment): attachment is SpaceRunResultAttachment => attachment.type === 'run_result');
  const skillInvocation = message.attachments?.find((attachment) => attachment.type === 'skill_invocation');
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
      {skillInvocation?.type === 'skill_invocation' && (
        <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">
          <BookOpen size={12} className="shrink-0" />
          <span className="truncate">使用 {skillInvocation.name}</span>
        </div>
      )}
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
      {runResult && run && (
        <button type="button" onClick={onOpenRun} className="mt-3 inline-flex items-center gap-1.5 text-xs font-black text-slate-500 transition hover:text-slate-950">
          查看任务详情
          <ChevronRight size={14} />
        </button>
      )}
    </MessageBubbleFrame>
  );
}
