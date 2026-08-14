'use client';

import { Check, Copy, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function MessageActions({
  role,
  createdAt,
  copied,
  active,
  canRegenerate,
  onCopy,
  onRegenerate,
  onDelete,
}: {
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
  copied: boolean;
  active: boolean;
  canRegenerate: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'mt-1 flex items-center gap-1 px-2 text-slate-400 transition md:opacity-0 md:group-hover:opacity-100',
        active ? 'opacity-100' : 'opacity-0'
      )}
    >
      <span
        className="px-1 text-[11px] font-semibold leading-7"
        title={new Intl.DateTimeFormat('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(createdAt))}
      >
        {formatTime(createdAt)}
      </span>
      {role === 'assistant' && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-slate-100 hover:text-slate-700"
          title={copied ? '已复制' : '复制'}
          aria-label="复制回复"
        >
          {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
        </button>
      )}
      {role === 'assistant' && canRegenerate && (
        <button
          type="button"
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
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-rose-50 hover:text-rose-500"
        title="删除"
        aria-label="删除消息"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
