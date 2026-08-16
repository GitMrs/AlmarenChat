'use client';

import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';
import type { AgentTask } from '@/types';

export default function TaskReviewDialog({
  task,
  loading,
  error,
  eyebrow = '补充要求并重做',
  label = '需要怎么修改',
  placeholder = '指出数据、内容或文件需要调整的地方...',
  confirmText = '重新执行此步骤',
  validationMessage = '请填写需要修改的内容',
  onCancel,
  onConfirm,
}: {
  task: AgentTask | null;
  loading: boolean;
  error?: string;
  eyebrow?: string;
  label?: string;
  placeholder?: string;
  confirmText?: string;
  validationMessage?: string;
  onCancel: () => void;
  onConfirm: (feedback: string) => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [validationError, setValidationError] = useState('');

  useEffect(() => {
    if (!task) return;
    setFeedback('');
    setValidationError('');
  }, [task]);

  if (!task) return null;

  const submit = () => {
    const value = feedback.trim();
    if (!value) return setValidationError(validationMessage);
    setValidationError('');
    onConfirm(value);
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/30 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="task-review-dialog-title">
      <div className="flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-w-xl sm:rounded-lg sm:border sm:border-black/[0.08]">
        <header className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="text-xs font-black text-slate-400">{eyebrow}</div>
            <h2 id="task-review-dialog-title" className="mt-1 truncate text-lg font-black text-slate-950">{task.title}</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={loading} aria-label="关闭" title="关闭" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-200">
            <X size={18} />
          </button>
        </header>
        <div className="px-5 py-5 sm:px-6">
          <label htmlFor="task-review-feedback" className="mb-2 block text-sm font-black text-slate-700">{label}</label>
          <textarea
            id="task-review-feedback"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            rows={7}
            maxLength={4_000}
            autoFocus
            placeholder={placeholder}
            className="w-full resize-y rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
          />
          {(validationError || error) && <div className="mt-3 rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{validationError || error}</div>}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-black/[0.06] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onCancel} disabled={loading} className="inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-300">取消</button>
          <button type="button" onClick={submit} disabled={loading} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RotateCcw size={16} />}
            {confirmText}
          </button>
        </footer>
      </div>
    </div>
  );
}
