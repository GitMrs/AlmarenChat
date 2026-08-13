'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import { cn } from '@/lib/utils';
import type { Agent, SpaceMessage } from '@/types';

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function SpaceMessageItem({
  message,
  speaker,
  fallbackColor,
}: {
  message: SpaceMessage;
  speaker?: Agent | null;
  fallbackColor: string;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && <Avatar src={speaker?.avatar || '🤖'} alt={speaker?.name || 'Agent'} size="sm" className="mt-1 shrink-0" />}
      <div className={cn('flex min-w-0 max-w-[84%] flex-col', isUser ? 'items-end' : 'items-start')}>
        {!isUser && (
          <div className="mb-1 px-2 text-xs font-black text-slate-400">{speaker?.name || '空间 Agent'}</div>
        )}
        <div
          className={cn(
            'min-w-0 max-w-full rounded-[24px] px-5 py-4 shadow-sm',
            isUser ? 'rounded-br-md text-white' : 'rounded-bl-md border border-black/[0.06] bg-white text-slate-800'
          )}
          style={isUser ? { backgroundColor: fallbackColor } : undefined}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>
          ) : (
            <div className="markdown-body min-w-0 max-w-full overflow-hidden text-sm leading-7">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>
        <div className="mt-1 px-2 text-[11px] font-semibold text-slate-400">{formatTime(message.createdAt)}</div>
      </div>
    </div>
  );
}
