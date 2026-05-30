'use client';

import { memo, useState } from 'react';
import { Check, Copy, RefreshCw, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import { cn } from '@/lib/utils';
import type { MessageAttachment } from '@/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export type DisplayAgent = {
  id: string;
  name: string;
  avatar?: string;
  description?: string;
  category?: string;
  tone?: string;
  greeting?: string;
  systemPrompt?: string;
};

const USER_MESSAGE_COLLAPSE_CHARS = 600;
const USER_MESSAGE_COLLAPSE_LINES = 12;
const USER_MESSAGE_PREVIEW_CHARS = 800;
const ASSISTANT_MESSAGE_COLLAPSE_CHARS = 2000;
const ASSISTANT_MESSAGE_COLLAPSE_LINES = 50;
const ASSISTANT_MESSAGE_PREVIEW_CHARS = 600;

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function CollapsibleUserMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse =
    content.length > USER_MESSAGE_COLLAPSE_CHARS || content.split('\n').length > USER_MESSAGE_COLLAPSE_LINES;
  const displayContent =
    shouldCollapse && !expanded && content.length > USER_MESSAGE_PREVIEW_CHARS
      ? `${content.slice(0, USER_MESSAGE_PREVIEW_CHARS)}\n...`
      : content;

  if (!shouldCollapse) {
    return <p className="whitespace-pre-wrap text-sm leading-7">{content}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <p
          className={cn(
            'whitespace-pre-wrap text-sm leading-7 transition-[max-height]',
            !expanded && 'max-h-56 overflow-hidden'
          )}
        >
          {displayContent}
        </p>
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 rounded-b-[18px] bg-gradient-to-t from-black/12 via-black/4 to-transparent" />
        )}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex items-center text-xs font-black text-white/90 underline decoration-white/35 underline-offset-4 transition hover:text-white hover:decoration-white"
      >
        {expanded ? '收起消息' : '展开完整消息'}
      </button>
    </div>
  );
}

function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  const images = attachments?.filter((attachment) => attachment.type === 'image') || [];
  if (images.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {images.map((attachment) => (
        <a
          key={attachment.url}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-2xl border border-white/25 bg-white/15"
          onClick={(event) => event.stopPropagation()}
        >
          <img src={attachment.url} alt={attachment.name || '上传图片'} className="max-h-56 max-w-[240px] object-cover" />
        </a>
      ))}
    </div>
  );
}

function CollapsibleAssistantMessage({ content, shouldAutoCollapse }: { content: string; shouldAutoCollapse: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse =
    shouldAutoCollapse &&
    (content.length > ASSISTANT_MESSAGE_COLLAPSE_CHARS || content.split('\n').length > ASSISTANT_MESSAGE_COLLAPSE_LINES);
  const displayContent =
    shouldCollapse && !expanded && content.length > ASSISTANT_MESSAGE_PREVIEW_CHARS
      ? `${content.slice(0, ASSISTANT_MESSAGE_PREVIEW_CHARS)}\n\n...`
      : content;

  return (
    <div className="space-y-3">
      <div className="markdown-body min-w-0 max-w-full overflow-hidden text-sm leading-7">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
      </div>
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center text-xs font-black text-slate-500 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900 hover:decoration-slate-500"
        >
          {expanded ? '收起回答' : '展开完整回答'}
        </button>
      )}
    </div>
  );
}

type MessageItemProps = {
  message: ChatMessage;
  displayAgent: DisplayAgent;
  categoryColor: string;
  latestAssistantMessageId?: string;
  copiedId: string | null;
  activeActionMessageId: string | null;
  onActivate: (id: string) => void;
  onCopy: (id: string, content: string) => void;
  onRegenerate: () => void;
  onDelete: (message: ChatMessage) => void;
};

export const MessageItem = memo(function MessageItem({
  message,
  displayAgent,
  categoryColor,
  latestAssistantMessageId,
  copiedId,
  activeActionMessageId,
  onActivate,
  onCopy,
  onRegenerate,
  onDelete,
}: MessageItemProps) {
  return (
    <div className={cn('flex gap-3', message.role === 'user' ? 'justify-end' : 'justify-start')}>
      {message.role === 'assistant' && (
        <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" className="mt-1 shrink-0" />
      )}
      <div
        onClick={() => onActivate(message.id)}
        className={cn('group flex min-w-0 max-w-[82%] flex-col', message.role === 'user' ? 'items-end' : 'items-start')}
      >
        <div
          className={cn(
            'min-w-0 max-w-full rounded-[24px] px-5 py-4 shadow-sm',
            message.role === 'user'
              ? 'rounded-br-md text-white'
              : 'rounded-bl-md border border-black/[0.06] bg-white text-slate-800'
          )}
          style={message.role === 'user' ? { backgroundColor: categoryColor } : undefined}
        >
          <MessageAttachments attachments={message.attachments} />
          {message.role === 'assistant' ? (
            <CollapsibleAssistantMessage
              content={message.content}
              shouldAutoCollapse={message.id !== latestAssistantMessageId && message.id !== 'greeting'}
            />
          ) : !message.content ? null : (
            <CollapsibleUserMessage content={message.content} />
          )}
        </div>

        {message.id !== 'greeting' && (
          <div
            className={cn(
              'mt-1 flex items-center gap-1 px-2 text-slate-400 transition md:opacity-0 md:group-hover:opacity-100',
              activeActionMessageId === message.id ? 'opacity-100' : 'opacity-0'
            )}
          >
            <span
              className="px-1 text-[11px] font-semibold leading-7"
              title={new Intl.DateTimeFormat('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(message.createdAt))}
            >
              {formatMessageTime(message.createdAt)}
            </span>
            {message.role === 'assistant' && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onCopy(message.id, message.content);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-slate-100 hover:text-slate-700"
                title={copiedId === message.id ? '已复制' : '复制'}
                aria-label="复制回复"
              >
                {copiedId === message.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              </button>
            )}
            {message.role === 'assistant' && message.id === latestAssistantMessageId && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onRegenerate();
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-slate-100 hover:text-slate-700"
                title="重新生成"
                aria-label="重新生成"
              >
                <RefreshCw size={13} />
              </button>
            )}
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDelete(message);
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-rose-50 hover:text-rose-500"
              title="删除"
              aria-label="删除消息"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
