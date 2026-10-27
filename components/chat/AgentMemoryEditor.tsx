'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Sparkles, X } from 'lucide-react';
import type { AgentMemoryItem } from '@/types';
import { cn } from '@/lib/client/utils';

const CATEGORIES = [
  { value: 'preference', label: '偏好习惯', description: '你喜欢的称呼、表达方式或生活习惯', example: '例如：回答先说结论，再展开原因；平时称呼我为小鱼。' },
  { value: 'rule', label: '交互约定', description: '你希望 Agent 持续遵守的相处方式', example: '例如：给我建议前先了解我的想法；不确定时直接说明。' },
  { value: 'fact', label: '个人事实', description: '你明确告知并希望记住的个人信息', example: '例如：我正在学习日语，目前大约是 N3 水平。' },
  { value: 'project', label: '项目背景', description: '需要长期了解的项目目标和背景', example: '例如：我正在做一个 B 站学习 bot，现阶段先完善内部学习流程。' },
  { value: 'tech', label: '技术偏好', description: '你常用的工具、技术和开发习惯', example: '例如：我的项目使用 TypeScript，包管理器使用 yarn。' },
];

export default function AgentMemoryEditor({ agentName, memory, onCancel, onSave }: {
  agentName: string;
  memory: AgentMemoryItem | null;
  onCancel: () => void;
  onSave: (data: { content: string; category?: string }) => Promise<void>;
}) {
  const [content, setContent] = useState(memory?.content || '');
  const [category, setCategory] = useState(memory?.category || 'preference');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const legacy = memory?.category === 'skill';
  const selectedCategory = CATEGORIES.find((item) => item.value === category);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    return () => previousFocus?.focus();
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    const cleaned = content.trim();
    if (!cleaned || content.length > 500) {
      setError('请填写 1～500 字的记忆内容。');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave({ content: cleaned, ...(!legacy ? { category } : {}) });
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
        ref={dialogRef}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-memory-editor-title"
        aria-describedby="agent-memory-editor-description"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !savingRef.current) { event.stopPropagation(); onCancel(); }
          if (event.key === 'Tab') {
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)');
            const first = controls?.[0];
            const last = controls?.[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><Sparkles size={20} /></div>
            <h2 id="agent-memory-editor-title" className="text-lg font-black text-slate-950">{legacy ? '修改旧版研习参考' : memory ? '编辑个人记忆' : '新增个人记忆'}</h2>
            <p id="agent-memory-editor-description" className="mt-1 text-xs leading-5 text-slate-500">{legacy ? '保留旧版内容供查看，不作为个人记忆参与对话。' : memory?.status === 'DISABLED' ? '这条记忆目前已停用，保存修改后仍保持停用。' : `告诉 ${agentName} 一件你希望长期记住的事。保存后，这条记忆会用于后续主聊天。`}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="关闭记忆编辑器" className="rounded-full bg-slate-50 p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X size={18} /></button>
        </div>

        {!legacy && <fieldset disabled={saving} className="mt-5">
          <legend className="mb-2 text-xs font-bold text-slate-700">记忆类型</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((item) => (
              <button key={item.value} type="button" aria-pressed={category === item.value} onClick={() => setCategory(item.value)} className={cn('rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-50', category === item.value ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-200 text-slate-500 hover:border-slate-300')}>
                {item.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-slate-400">{selectedCategory?.description}</p>
        </fieldset>}

        <label htmlFor="agent-memory-content" className="mt-5 block text-xs font-bold text-slate-700">{legacy ? '参考内容' : '记忆内容'}</label>
        <textarea id="agent-memory-content" value={content} onChange={(event) => { setContent(event.target.value); setError(''); }} disabled={saving} rows={5} maxLength={500} placeholder={selectedCategory?.example || '写下需要保存的内容'} aria-describedby="agent-memory-content-hint" aria-invalid={Boolean(error)} className="mt-2 min-h-32 w-full resize-y rounded-2xl border border-slate-200 bg-[#fbfaf7] px-4 py-3 text-sm leading-6 text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:opacity-60" />
        <div id="agent-memory-content-hint" className="mt-1 flex items-start justify-between gap-4 text-[11px] leading-5 text-slate-400">
          <span>每条只记录一件事，方便以后单独修改或停用。</span>
          <span className="shrink-0 tabular-nums">{content.length} / 500</span>
        </div>
        {!legacy && <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-500">学习资料与方法请放在知识库；学习、任务和共同经历可在活动记录查看。</p>}
        {error && <p role="alert" className="mt-3 text-xs font-semibold text-rose-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-50">取消</button>
          <button type="submit" disabled={saving || !content.trim() || content.length > 500} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-xs font-black text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">
            {saving && <Loader2 size={14} className="animate-spin" />}{saving ? '保存中…' : legacy ? '保存参考' : '保存记忆'}
          </button>
        </div>
      </form>
    </div>, document.body
  );
}
