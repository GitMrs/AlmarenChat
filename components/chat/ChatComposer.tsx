'use client';

import { ImagePlus, Loader2, Send, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageAttachment } from '@/types';

type ChatComposerProps = {
  agentName: string;
  categoryColor: string;
  pendingAttachment: MessageAttachment | null;
  pendingLargeTextMeta: { chars: number; kind: 'json' | 'text' } | null;
  uploadError: string;
  uploadingImage: boolean;
  isStreaming: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onImageSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onInput: (event: React.FormEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onClearAttachment: () => void;
  onSend: () => void;
  onStop: () => void;
};

export default function ChatComposer({
  agentName,
  categoryColor,
  pendingAttachment,
  pendingLargeTextMeta,
  uploadError,
  uploadingImage,
  isStreaming,
  inputRef,
  fileInputRef,
  onImageSelect,
  onPaste,
  onInput,
  onKeyDown,
  onFocus,
  onClearAttachment,
  onSend,
  onStop,
}: ChatComposerProps) {
  return (
    <footer className="shrink-0 border-t border-white/10 bg-[#19172a]/88 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-4xl">
        {(pendingAttachment || pendingLargeTextMeta || uploadError) && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.08] px-3 py-2">
            {pendingAttachment ? (
              <div className="flex min-w-0 items-center gap-3">
                <img
                  src={pendingAttachment.url}
                  alt={pendingAttachment.name || '待发送图片'}
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white/70">{pendingAttachment.name || '已选择图片'}</p>
                  <p className="text-xs font-semibold text-white/40">发送后会随本条消息交给 AI 分析</p>
                </div>
              </div>
            ) : pendingLargeTextMeta ? (
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-xs font-black text-white/54">
                  TXT
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white/70">
                    {pendingLargeTextMeta.kind === 'json' ? '已添加 JSON 数据' : '已添加大段文本'}
                  </p>
                  <p className="text-xs font-semibold text-white/40">
                    {pendingLargeTextMeta.chars.toLocaleString('zh-CN')} 字符，发送时会使用完整内容
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm font-semibold text-rose-400">{uploadError}</p>
            )}
            <button
              type="button"
              onClick={onClearAttachment}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-white/[0.08] hover:text-white/70"
              aria-label="移除图片"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-3 rounded-[28px] border border-white/10 bg-white/[0.08] p-2">
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
            className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white/54 transition hover:bg-white/[0.08] hover:text-white disabled:bg-transparent disabled:text-white/30"
            aria-label="上传图片"
            title="上传图片"
          >
            {uploadingImage ? <Loader2 size={17} className="animate-spin" /> : <ImagePlus size={18} />}
          </button>
          <textarea
            ref={inputRef}
            onPaste={onPaste}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            placeholder={`向 ${agentName} 说点什么...`}
            rows={1}
            className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-4 py-3 text-sm font-medium leading-6 text-white outline-none placeholder:text-white/40"
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
