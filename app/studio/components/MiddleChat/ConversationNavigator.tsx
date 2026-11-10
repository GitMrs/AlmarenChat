import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatMessage } from '../../types';

export function buildConversationTurns(messages: ChatMessage[]) {
  const turns: Array<{ id: string; index: number; question: string; answer: string }> = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'user') {
      turns.push({ id: message.id, index, question: (message.content || '').slice(0, 300), answer: '' });
    } else if (message.role === 'assistant' && turns.length) {
      const turn = turns[turns.length - 1];
      if (turn.answer.length < 300) {
        turn.answer = `${turn.answer}\n${message.content?.slice(0, 300) || (message.tools?.length ? '工具任务记录' : '')}`.trim().slice(0, 300);
      }
    }
  }
  return turns;
}

interface ConversationNavigatorProps {
  messages: ChatMessage[];
  visibleIndex: number;
  onJump: (index: number) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export const ConversationNavigator = React.memo(function ConversationNavigator({
  messages, visibleIndex, onJump, hasMore, isLoadingMore, onLoadMore,
}: ConversationNavigatorProps) {
  const turns = useMemo(() => buildConversationTurns(messages), [messages]);
  const rootRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ id: string; top: number } | null>(null);
  const active = [...turns].reverse().find((turn) => turn.index <= visibleIndex) || turns[0];
  const rail = useVirtualizer({
    count: turns.length, getScrollElement: () => railRef.current,
    getItemKey: (index) => turns[index].id, estimateSize: () => 10, overscan: 8,
    initialRect: { width: 32, height: 600 },
  });
  useEffect(() => {
    if (active) rail.scrollToIndex(turns.findIndex((turn) => turn.id === active.id), { align: 'auto' });
  }, [active?.id, rail]);
  if (!turns.length) return null;
  const hovered = turns.find((turn) => turn.id === preview?.id);
  const showPreview = (element: HTMLButtonElement, id: string) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPreview({ id, top: Math.max(0, Math.min(element.getBoundingClientRect().top - bounds.top - 35, bounds.height - 190)) });
  };

  return (
    <nav
      ref={rootRef}
      aria-label="对话导航"
      className="absolute inset-y-5 left-1 z-10 hidden w-8 flex-col items-center justify-center sm:flex"
      onMouseLeave={() => setPreview(null)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null); }}
      onKeyDown={(event) => { if (event.key === 'Escape') setPreview(null); }}
    >
      {hasMore && (
        <button
          type="button" disabled={isLoadingMore} onClick={onLoadMore}
          aria-label="加载更早的对话" title="加载更早的对话"
          className="mb-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-50"
        >
          {isLoadingMore ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
        </button>
      )}
      <div ref={railRef} onScroll={() => setPreview(null)} style={{ height: rail.getTotalSize() }} className="max-h-[80%] min-h-0 w-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="relative w-full" style={{ height: rail.getTotalSize() }}>
        {rail.getVirtualItems().map((item) => {
          const turn = turns[item.index];
          return (
          <button
            key={turn.id} type="button"
            style={{ transform: `translateY(${item.start}px)`, height: item.size }}
            aria-label={`跳转到提问：${turn.question.slice(0, 80) || '空消息'}`}
            aria-current={active.id === turn.id ? 'location' : undefined}
            onClick={() => { setPreview(null); onJump(turn.index); }}
            onMouseEnter={(event) => showPreview(event.currentTarget, turn.id)}
            onFocus={(event) => showPreview(event.currentTarget, turn.id)}
            className="group absolute left-0 top-0 flex w-8 items-center py-1 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span className={`h-[3px] w-1.5 rounded-full transition-all group-hover:w-4 group-hover:bg-slate-600 group-focus-visible:w-4 group-focus-visible:bg-slate-600 ${active.id === turn.id ? 'bg-slate-600' : 'bg-slate-300/70'}`} />
          </button>
          );
        })}
        </div>
      </div>
      {hovered && (
        <div
          role="tooltip" style={{ top: preview?.top }}
          className="pointer-events-none absolute left-9 w-72 rounded-xl border border-black/[0.08] bg-white p-3 text-xs leading-relaxed text-slate-700 shadow-lg"
        >
          <p className="line-clamp-2 whitespace-pre-wrap break-words font-semibold text-slate-900">{hovered.question || '空消息'}</p>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap break-words text-slate-500">{hovered.answer || '暂无文字回复'}</p>
        </div>
      )}
    </nav>
  );
});
