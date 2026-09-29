'use client';

import { Check, Loader2, Sparkles, X } from 'lucide-react';

export type MemorySuggestion = { content: string; category: string };

type MemorySuggestionDialogProps = {
  suggestions: MemorySuggestion[];
  selected: Set<number>;
  loading?: boolean;
  onToggle: (index: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function MemorySuggestionDialog({ suggestions, selected, loading = false, onToggle, onCancel, onConfirm }: MemorySuggestionDialogProps) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="agent-memory-suggestion-title">
      <div className="w-full max-w-md rounded-2xl border border-black/[0.08] bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Sparkles size={18} /></div>
          <div><h2 id="agent-memory-suggestion-title" className="text-lg font-black text-slate-950">要记住这些吗？</h2><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">这是当前 Agent 可能长期记住的信息，请确认后保存。</p></div>
        </div>
        <div className="my-4 space-y-2">
          {suggestions.map((suggestion, index) => (
            <button key={`${suggestion.content}-${index}`} type="button" disabled={loading} onClick={() => onToggle(index)} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${selected.has(index) ? 'border-slate-950 bg-slate-50' : 'border-black/[0.08] bg-white'} disabled:opacity-60`}>
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected.has(index) ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-300 text-transparent'}`}><Check size={13} /></span>
              <span className="text-sm leading-6 text-slate-700">{suggestion.content}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={loading} onClick={onCancel} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-black/10 text-xs font-black text-slate-600 disabled:opacity-40"><X size={14} />暂不保存</button>
          <button type="button" disabled={loading || selected.size === 0} onClick={onConfirm} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-950 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-400">{loading && <Loader2 className="animate-spin" size={14} />}保存选中项</button>
        </div>
      </div>
    </div>
  );
}
