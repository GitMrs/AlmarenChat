'use client';

import { Check, Copy, Loader2, RefreshCw, Square, Trash2, Volume2 } from 'lucide-react';
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
  speaking,
  speakingLoading,
  onCopy,
  onRegenerate,
  onDelete,
  onSpeak,
}: {
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
  copied: boolean;
  active: boolean;
  canRegenerate: boolean;
  speaking?: boolean;
  speakingLoading?: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onSpeak?: () => void;
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
      {role === 'assistant' && onSpeak && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSpeak();
          }}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-slate-100 hover:text-slate-700',
            speaking && 'bg-violet-50 text-violet-600'
          )}
          title={speakingLoading ? '合成中...' : speaking ? '停止朗读' : '朗读'}
          aria-label={speaking ? '停止朗读' : '朗读回复'}
        >
          {speakingLoading ? (
            <Loader2 size={13} className="animate-spin text-violet-500" />
          ) : speaking ? (
            <Square size={11} className="fill-current text-violet-600" />
          ) : (
            <Volume2 size={13} />
          )}
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
