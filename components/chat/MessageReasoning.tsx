'use client';

import { ChevronRight, Loader2 } from 'lucide-react';

export default function MessageReasoning({ reasoning, thinking = false }: { reasoning?: string; thinking?: boolean }) {
  if (!reasoning) return null;

  return (
    <details className="group/reasoning mb-2 text-xs text-slate-500" onClick={event => event.stopPropagation()}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 [&::-webkit-details-marker]:hidden">
        {thinking ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} className="transition-transform group-open/reasoning:rotate-90" />}
        {thinking ? '正在思考…' : '思考过程'}
      </summary>
      <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap border-l-2 border-slate-200 pl-3 text-xs leading-6 [overflow-wrap:anywhere]">
        {reasoning}
      </div>
    </details>
  );
}
