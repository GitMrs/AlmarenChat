'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import type { Agent, AgentTask } from '@/types';

export type TaskDispatchRevision = {
  agentId: string;
  title: string;
  instruction: string;
  acceptanceCriteria: string;
  webResearchRequired: boolean;
};

export default function TaskDispatchDialog({
  task,
  members,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  task: AgentTask | null;
  members: Agent[];
  loading: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (revision: TaskDispatchRevision) => void;
}) {
  const [agentId, setAgentId] = useState('');
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [webResearchRequired, setWebResearchRequired] = useState(false);
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (!task) return;
    setAgentId(task.agentId);
    setTitle(task.title);
    setInstruction(task.instruction);
    setAcceptanceCriteria(task.acceptanceCriteria || '');
    setWebResearchRequired(Boolean(task.webResearchRequired));
    setValidationError('');
  }, [task]);

  if (!task) return null;

  const submit = () => {
    const revision = {
      agentId,
      title: title.trim(),
      instruction: instruction.trim(),
      acceptanceCriteria: acceptanceCriteria.trim(),
      webResearchRequired,
    };
    if (!revision.agentId) return setValidationError('请选择执行成员');
    if (!revision.title) return setValidationError('请填写任务标题');
    if (!revision.instruction) return setValidationError('请填写执行说明');
    if (!revision.acceptanceCriteria) return setValidationError('请填写验收标准');
    setValidationError('');
    onConfirm(revision);
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/30 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="task-dispatch-dialog-title">
      <div className="flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-lg sm:border sm:border-black/[0.08]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-black/[0.06] px-5 py-4 sm:px-6">
          <div>
            <div className="text-xs font-black text-slate-400">调整派发提案</div>
            <h2 id="task-dispatch-dialog-title" className="mt-1 text-lg font-black text-slate-950">开工前确认任务边界</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={loading} aria-label="关闭" title="关闭" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-200">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div>
            <label htmlFor="dispatch-agent" className="mb-2 block text-sm font-black text-slate-700">执行成员</label>
            <select id="dispatch-agent" value={agentId} onChange={(event) => setAgentId(event.target.value)} className="h-11 w-full rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-3 text-sm font-bold text-slate-800 outline-none focus:border-slate-300">
              {members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.category ? ` · ${member.category}` : ''}</option>)}
            </select>
            <div className="mt-2 text-xs font-semibold text-slate-400">
              当前 Skill：{task.skillSnapshot?.name || '通用任务执行'}；修改成员或任务内容后平台会重新匹配。
            </div>
          </div>
          <div>
            <label htmlFor="dispatch-title" className="mb-2 block text-sm font-black text-slate-700">任务标题</label>
            <input id="dispatch-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="h-11 w-full rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-3 text-sm font-semibold text-slate-800 outline-none focus:border-slate-300" />
          </div>
          <div>
            <label htmlFor="dispatch-instruction" className="mb-2 block text-sm font-black text-slate-700">执行说明</label>
            <textarea id="dispatch-instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={9} maxLength={8_000} className="w-full resize-y rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300" />
          </div>
          <div>
            <label htmlFor="dispatch-acceptance" className="mb-2 block text-sm font-black text-slate-700">验收标准</label>
            <textarea id="dispatch-acceptance" value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} rows={5} maxLength={4_000} className="w-full resize-y rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300" />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 border-y border-black/[0.06] py-3">
            <span>
              <span className="block text-sm font-black text-slate-700">当前任务需要联网</span>
              <span className="mt-1 block text-xs font-semibold text-slate-400">只有目标授权允许联网时才能开启。</span>
            </span>
            <input
              type="checkbox"
              checked={webResearchRequired}
              onChange={(event) => setWebResearchRequired(event.target.checked)}
              className="h-5 w-5 shrink-0 accent-slate-950"
            />
          </label>
          {(validationError || error) && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{validationError || error}</div>}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-black/[0.06] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onCancel} disabled={loading} className="inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-300">取消</button>
          <button type="button" onClick={submit} disabled={loading} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">
            {loading ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
            保存并开始执行
          </button>
        </footer>
      </div>
    </div>
  );
}
