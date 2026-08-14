'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { SpaceMessageAttachment } from '@/types';

const USER_COLLAPSE_CHARS = 600;
const USER_COLLAPSE_LINES = 12;
const USER_PREVIEW_CHARS = 800;
const ASSISTANT_COLLAPSE_CHARS = 2000;
const ASSISTANT_COLLAPSE_LINES = 50;
const ASSISTANT_PREVIEW_CHARS = 600;

function MessageAttachments({ attachments }: { attachments?: SpaceMessageAttachment[] }) {
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

function UserMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = content.length > USER_COLLAPSE_CHARS || content.split('\n').length > USER_COLLAPSE_LINES;
  const displayContent =
    shouldCollapse && !expanded && content.length > USER_PREVIEW_CHARS
      ? `${content.slice(0, USER_PREVIEW_CHARS)}\n...`
      : content;

  if (!shouldCollapse) return <p className="whitespace-pre-wrap text-sm leading-7">{content}</p>;

  return (
    <div className="space-y-3">
      <div className="relative">
        <p className={cn('whitespace-pre-wrap text-sm leading-7 transition-[max-height]', !expanded && 'max-h-56 overflow-hidden')}>
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

function AssistantMessage({ content, shouldAutoCollapse }: { content: string; shouldAutoCollapse: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse =
    shouldAutoCollapse &&
    (content.length > ASSISTANT_COLLAPSE_CHARS || content.split('\n').length > ASSISTANT_COLLAPSE_LINES);
  const displayContent =
    shouldCollapse && !expanded && content.length > ASSISTANT_PREVIEW_CHARS
      ? `${content.slice(0, ASSISTANT_PREVIEW_CHARS)}\n\n...`
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

export default function MessageContent({
  role,
  content,
  attachments,
  shouldAutoCollapse = false,
}: {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: SpaceMessageAttachment[];
  shouldAutoCollapse?: boolean;
}) {
  return (
    <>
      <MessageAttachments attachments={attachments} />
      {role === 'assistant' ? (
        <AssistantMessage content={content} shouldAutoCollapse={shouldAutoCollapse} />
      ) : content ? (
        <UserMessage content={content} />
      ) : null}
    </>
  );
}
