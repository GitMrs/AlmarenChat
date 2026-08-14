'use client';

import type { ReactNode } from 'react';
import Avatar from '@/components/shared/Avatar';
import { cn } from '@/lib/utils';

type MessageBubbleFrameProps = {
  role: 'user' | 'assistant' | 'system';
  avatar?: string;
  agentName?: string;
  userColor: string;
  showAvatar?: boolean;
  showAgentName?: boolean;
  onActivate?: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

export default function MessageBubbleFrame({
  role,
  avatar,
  agentName,
  userColor,
  showAvatar = role === 'assistant',
  showAgentName = false,
  onActivate,
  children,
  footer,
}: MessageBubbleFrameProps) {
  const isUser = role === 'user';

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && showAvatar && (
        <Avatar src={avatar || '🤖'} alt={agentName || 'Agent'} size="sm" className="mt-1 shrink-0" />
      )}
      <div
        onClick={onActivate}
        className={cn('group flex min-w-0 max-w-[82%] flex-col', isUser ? 'items-end' : 'items-start')}
      >
        {!isUser && showAgentName && (
          <div className="mb-1 px-2 text-xs font-black text-slate-400">{agentName || 'Agent'}</div>
        )}
        <div
          className={cn(
            'min-w-0 max-w-full rounded-[24px] px-5 py-4 shadow-sm',
            isUser
              ? 'rounded-br-md text-white'
              : 'rounded-bl-md border border-black/[0.06] bg-white text-slate-800'
          )}
          style={isUser ? { backgroundColor: userColor } : undefined}
        >
          {children}
        </div>
        {footer}
      </div>
    </div>
  );
}

