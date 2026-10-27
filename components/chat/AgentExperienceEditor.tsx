'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Loader2, X } from 'lucide-react';
import type { AgentExperience } from '@/types';

export default function AgentExperienceEditor({ experience, sourceLabel, onCancel, onSave }: {
  experience: AgentExperience;
  sourceLabel: string;
  onCancel: () => void;
  onSave: (summary: string) => Promise<void>;
}) {
  const [summary, setSummary] = useState(experience.summary);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const isArchive = experience.sourceType === 'CHAT';

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    formRef.current?.querySelector('textarea')?.focus();
    return () => previousFocus?.focus();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    if (!summary.trim() || summary.length > 2000) {
      setError('请填写 1～2000 字的记录内容。');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(summary.trim());
    } catch (error: any) {
      setError(error?.message || '保存失败，请重试。你填写的内容已保留。');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <form
        ref={formRef}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="experience-editor-title"
        aria-describedby="experience-editor-description"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !savingRef.current) { event.stopPropagation(); onCancel(); }
          if (event.key === 'Tab') {
            const controls = formRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)');
            const first = controls?.[0];
            const last = controls?.[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><BookOpen size={20} /></div>
            <h2 id="experience-editor-title" className="text-lg font-black text-slate-950">{isArchive ? '纠正对话归档' : '纠正活动记录'}</h2>
            <p id="experience-editor-description" className="mt-1 text-xs leading-5 text-slate-500">修改 Agent 对这段经历的记录，原始聊天、任务结果和学习资料会保留。</p>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="关闭记录编辑器" className="rounded-full bg-slate-50 p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X size={18} /></button>
        </div>
        <div className="mt-4 rounded-2xl bg-slate-50 p-3.5">
          <p className="break-words text-sm font-bold text-slate-800">{experience.title}</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{sourceLabel} · {new Date(experience.createdAt).toLocaleString('zh-CN')}{experience.status === 'DISABLED' ? ' · 已停用' : ''}</p>
        </div>
        <label htmlFor="experience-summary" className="mt-5 block text-xs font-bold text-slate-700">{isArchive ? '归档内容' : '经历内容'}</label>
        <textarea id="experience-summary" value={summary} onChange={(event) => { setSummary(event.target.value); setError(''); }} disabled={saving} rows={9} maxLength={2000} aria-describedby="experience-summary-hint" aria-invalid={Boolean(error)} placeholder="写下实际发生的事情，区分当时的事实、观点和推测。" className="mt-2 min-h-48 w-full resize-y rounded-2xl border border-slate-200 bg-[#fbfaf7] px-4 py-3 text-sm leading-6 text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60" />
        <div id="experience-summary-hint" className="mt-1 flex justify-between gap-3 text-[11px] leading-5 text-slate-400">
          <span>支持换行，建议保留时间、来源及必要的上下文。</span><span className="shrink-0 tabular-nums">{summary.length} / 2000</span>
        </div>
        <p className="mt-4 rounded-xl bg-indigo-50/60 px-3 py-2.5 text-[11px] leading-5 text-slate-500">保存后会标记“已纠正”，后续同步保留你的修改。{experience.status === 'DISABLED' ? '这条记录仍保持停用。' : '启用的记录会按相关性用于后续回忆。'}</p>
        {error && <p role="alert" className="mt-3 text-xs font-semibold text-rose-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-50">取消</button>
          <button type="submit" disabled={saving || !summary.trim() || summary.length > 2000 || summary.trim() === experience.summary.trim()} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-xs font-black text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">{saving && <Loader2 size={14} className="animate-spin" />}{saving ? '保存中…' : '保存纠正'}</button>
        </div>
      </form>
    </div>, document.body
  );
}
