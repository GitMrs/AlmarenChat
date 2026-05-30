'use client';

import { ImagePlus, Loader2, Send, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageAttachment } from '@/types';

type ChatComposerProps = {
  agentName: string;
  categoryColor: string;
  pendingAttachment: MessageAttachment | null;
  uploadError: string;
  uploadingImage: boolean;
  isStreaming: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onImageSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onClearAttachment: () => void;
  onSend: () => void;
  onStop: () => void;
};

export default function ChatComposer({
  agentName,
  categoryColor,
  pendingAttachment,
  uploadError,
  uploadingImage,
  isStreaming,
  inputRef,
  fileInputRef,
  onImageSelect,
  onPaste,
  onKeyDown,
  onClearAttachment,
  onSend,
  onStop,
}: ChatComposerProps) {
  return (
    <footer className="shrink-0 border-t border-black/[0.06] bg-white/88 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-4xl">
        {(pendingAttachment || uploadError) && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-white px-3 py-2 shadow-sm">
            {pendingAttachment ? (
              <div className="flex min-w-0 items-center gap-3">
                <img
                  src={pendingAttachment.url}
                  alt={pendingAttachment.name || '待发送图片'}
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-700">{pendingAttachment.name || '已选择图片'}</p>
                  <p className="text-xs font-semibold text-slate-400">发送后会随本条消息交给 AI 分析</p>
                </div>
              </div>
            ) : (
              <p className="text-sm font-semibold text-rose-500">{uploadError}</p>
            )}
            <button
              type="button"
              onClick={onClearAttachment}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="移除图片"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-3 rounded-[28px] border border-black/[0.08] bg-[#fbfaf7] p-2 shadow-sm">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={onImageSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingImage || isStreaming}
            className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:bg-transparent disabled:text-slate-300"
            aria-label="上传图片"
            title="上传图片"
          >
            {uploadingImage ? <Loader2 size={17} className="animate-spin" /> : <ImagePlus size={18} />}
          </button>
          <textarea
            ref={inputRef}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            placeholder={`向 ${agentName} 说点什么...`}
            rows={1}
            className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none placeholder:text-slate-400"
          />
          {isStreaming ? (
            <button
              onClick={onStop}
              className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-500 text-white"
              aria-label="停止生成"
            >
              <Square size={17} />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={uploadingImage}
              className={cn(
                'mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition',
                'text-white shadow-sm'
              )}
              style={{ backgroundColor: categoryColor }}
              aria-label="发送消息"
            >
              <Send size={17} />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
