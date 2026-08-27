'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Code2, FileText, Globe2, Loader2, X } from 'lucide-react';
import type { SpaceNetworkPolicy, SpaceTaskProposal } from '@/types';

export type TaskProposalRevision = Pick<SpaceTaskProposal, 'goal' | 'steps' | 'deliverables'> & {
  networkPolicy: SpaceNetworkPolicy;
};

export default function TaskProposalDialog({
  proposal,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  proposal: SpaceTaskProposal | null;
  loading: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (revision: TaskProposalRevision) => void;
}) {
  const [goal, setGoal] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [deliverablesText, setDeliverablesText] = useState('');
  const [networkPolicy, setNetworkPolicy] = useState<SpaceNetworkPolicy>('forbidden');
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (!proposal) return;
    setGoal(proposal.goal);
    setStepsText(proposal.steps.join('\n'));
    setDeliverablesText(proposal.deliverables.join('\n'));
    setNetworkPolicy(proposal.networkPolicy || (proposal.capabilities?.includes('web_research') ? 'required' : 'forbidden'));
    setValidationError('');
  }, [proposal]);

  useEffect(() => {
    if (!proposal) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [loading, onCancel, proposal]);

  const steps = useMemo(() => stepsText.split('\n').map((item) => item.trim()).filter(Boolean), [stepsText]);
  const deliverables = useMemo(
    () => deliverablesText.split('\n').map((item) => item.trim()).filter(Boolean),
    [deliverablesText]
  );
  const capabilities = proposal?.capabilities || ['workspace_read'];

  if (!proposal) return null;

  const submit = () => {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) return setValidationError('请填写任务目标');
    if (trimmedGoal.length > 12_000) return setValidationError('任务目标不能超过 12000 字');
    if (steps.length === 0) return setValidationError('请至少保留一个执行步骤');
    if (steps.length > 8) return setValidationError('执行步骤不能超过 8 项');
    if (deliverables.length > 8) return setValidationError('预期产出不能超过 8 项');
    setValidationError('');
    onConfirm({ goal: trimmedGoal, steps, deliverables, networkPolicy });
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/30 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="task-proposal-dialog-title">
      <div className="flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-lg sm:border sm:border-black/[0.08]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-black/[0.06] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="text-xs font-black text-slate-400">调整任务方案</div>
            <h2 id="task-proposal-dialog-title" className="mt-1 truncate text-lg font-black text-slate-950">{proposal.title}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            aria-label="关闭"
            title="关闭"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-200"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div>
            <label htmlFor="proposal-goal" className="mb-2 block text-sm font-black text-slate-700">任务目标</label>
            <textarea
              id="proposal-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={5}
              maxLength={12_000}
              className="w-full resize-y rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
            />
          </div>

          <div>
            <label htmlFor="proposal-steps" className="mb-2 block text-sm font-black text-slate-700">执行步骤</label>
            <textarea
              id="proposal-steps"
              value={stepsText}
              onChange={(event) => setStepsText(event.target.value)}
              rows={7}
              className="w-full resize-y rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
            />
            <div className="mt-1 text-xs font-semibold text-slate-400">每行一个步骤，最多 8 个。</div>
          </div>

          <div>
            <label htmlFor="proposal-deliverables" className="mb-2 block text-sm font-black text-slate-700">预期产出</label>
            <textarea
              id="proposal-deliverables"
              value={deliverablesText}
              onChange={(event) => setDeliverablesText(event.target.value)}
              rows={4}
              className="w-full resize-y rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
            />
            <div className="mt-1 text-xs font-semibold text-slate-400">每行一项，最多 8 项。</div>
          </div>

          <section className="border-t border-black/[0.06] pt-5">
            <div className="text-sm font-black text-slate-700">执行权限</div>
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="联网策略">
              {([
                ['forbidden', '禁止联网'],
                ['allowed', 'AI 按需'],
                ['required', '必须联网'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNetworkPolicy(value)}
                  aria-pressed={networkPolicy === value}
                  className={`min-h-9 rounded-md px-2 text-xs font-black transition ${
                    networkPolicy === value
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">
                <FileText size={13} />
                读取空间资料
              </span>
              {capabilities.includes('workspace_write') && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">
                  <FileText size={13} />
                  修改空间文件
                </span>
              )}
              {capabilities.includes('code_execute') && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700">
                  <Code2 size={13} />
                  隔离运行代码
                </span>
              )}
              {networkPolicy !== 'forbidden' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                  <Globe2 size={13} />
                  {networkPolicy === 'required' ? '必须联网检索' : '允许按需联网'}
                </span>
              )}
            </div>
            <p className="mt-3 text-xs font-semibold leading-5 text-slate-400">权限会写入本次目标授权；代码执行仅允许已注册 Skill 的固定入口，并在 OS 沙箱中运行。</p>
          </section>

          {(validationError || error) && (
            <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{validationError || error}</div>
          )}
        </div>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-black/[0.06] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-300"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
            保存并执行
          </button>
        </footer>
      </div>
    </div>
  );
}
