import React, { useState } from 'react';
import { CheckCircle, ChevronDown, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import type { ChatMessage } from '../../types';

interface ApprovalBarProps {
  messages: ChatMessage[];
  approvingToolId: string | null;
  onDecision: (approvalId: string, action: 'approve' | 'deny', toolId: string) => void;
}

export function ApprovalBar({ messages, approvingToolId, onDecision }: ApprovalBarProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pending = messages.flatMap((message) => message.tools || [])
    .filter((tool) => tool.status === 'waiting_approval' && tool.approvalId);
  const tool = pending[0];
  if (!tool?.approvalId) return null;
  const expanded = expandedId === tool.approvalId;
  const summary = tool.args?.command || tool.args?.path || tool.args?.goal || tool.preview || tool.name;

  return (
    <section aria-label="待审批操作" className="mb-3 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-xs">
      <div className="flex items-start gap-2 px-3 pt-3">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p role="status" className="text-xs font-semibold text-amber-900">
            等待确认 · {tool.name}{pending.length > 1 ? `（还有 ${pending.length - 1} 项待审批）` : ''}
          </p>
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-all font-mono text-xs text-slate-700">{String(summary)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <button
          type="button" aria-expanded={expanded} aria-controls="studio-approval-details"
          onClick={() => setExpandedId(expanded ? null : tool.approvalId!)}
          className="flex items-center gap-1 text-xs text-amber-800 hover:text-amber-950"
        >
          {expanded ? '收起详情' : '查看详情'}
          <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} />
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button" disabled={Boolean(approvingToolId)}
            onClick={() => onDecision(tool.approvalId!, 'deny', tool.id)}
            className="flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            <XCircle size={13} />拒绝
          </button>
          <button
            type="button" disabled={Boolean(approvingToolId)}
            onClick={() => onDecision(tool.approvalId!, 'approve', tool.id)}
            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {approvingToolId === tool.approvalId ? <><Loader2 size={13} className="animate-spin" />处理中...</> : <><CheckCircle size={13} />批准执行</>}
          </button>
        </div>
      </div>
      {expanded && (
        <div id="studio-approval-details" className="max-h-[35vh] overflow-y-auto border-t border-amber-200 bg-white/80 p-3">
          <p className="mb-2 text-[11px] text-slate-500">请核对操作参数；批准后将继续执行，超时未处理将自动拒绝。</p>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-slate-700">
            {tool.args ? JSON.stringify(tool.args, null, 2) : tool.preview}
          </pre>
        </div>
      )}
    </section>
  );
}
