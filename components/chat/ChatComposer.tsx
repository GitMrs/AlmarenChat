'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Globe2, Image as ImageIcon, ImagePlus, Loader2, Plus, Send, Square, Trash2, X } from 'lucide-react';
import ComposerShell from '@/components/chat/ComposerShell';
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
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  mode: 'chat' | 'image';
  imageGenerationAvailable: boolean;
  onModeChange: (mode: 'chat' | 'image') => void;
  onClearMessages?: () => void;
  canClearMessages?: boolean;
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
  webSearchEnabled,
  onToggleWebSearch,
  mode,
  imageGenerationAvailable,
  onModeChange,
  onClearMessages,
  canClearMessages = false,
}: ChatComposerProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const close = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [toolsOpen]);

  return (
    <footer className="shrink-0 border-t border-black/[0.06] bg-white/88 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-4xl">
        {(pendingAttachment || pendingLargeTextMeta || uploadError) && (
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
            ) : pendingLargeTextMeta ? (
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#fbfaf7] text-xs font-black text-slate-500">
                  TXT
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-700">
                    {pendingLargeTextMeta.kind === 'json' ? '已添加 JSON 数据' : '已添加大段文本'}
                  </p>
                  <p className="text-xs font-semibold text-slate-400">
                    {pendingLargeTextMeta.chars.toLocaleString('zh-CN')} 字符，发送时会使用完整内容
                  </p>
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
        <ComposerShell
          rowClassName="gap-3"
          toolbar={mode === 'image' ? (
            <div className="inline-flex h-8 max-w-full items-center gap-2 rounded-lg bg-white px-2.5 text-xs font-black text-slate-600 shadow-sm">
              <ImageIcon size={13} className="shrink-0" />
              <span className="truncate">生成图片</span>
              <button
                type="button"
                onClick={() => onModeChange('chat')}
                aria-label="退出生图模式"
                title="退出生图模式"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={12} />
              </button>
            </div>
          ) : undefined}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={onImageSelect}
          />
          <div ref={toolsRef} className="relative mb-0.5 shrink-0">
            {toolsOpen && (
              <div className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-60 max-w-[calc(100vw-32px)] rounded-lg border border-black/[0.08] bg-white p-1.5 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setToolsOpen(false);
                    onModeChange('chat');
                    window.requestAnimationFrame(() => fileInputRef.current?.click());
                  }}
                  disabled={uploadingImage || isStreaming}
                  className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-black text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:text-slate-300"
                >
                  {uploadingImage ? <Loader2 className="animate-spin" size={16} /> : <ImagePlus size={16} />}
                  <span className="min-w-0 flex-1">上传图片</span>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={webSearchEnabled}
                  onClick={() => {
                    onModeChange('chat');
                    onToggleWebSearch();
                    setToolsOpen(false);
                  }}
                  disabled={isStreaming}
                  className={cn(
                    'flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-black transition disabled:text-slate-300',
                    webSearchEnabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                  )}
                >
                  <Globe2 size={16} />
                  <span className="min-w-0 flex-1">联网搜索</span>
                  {webSearchEnabled && <Check size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onModeChange(mode === 'image' ? 'chat' : 'image');
                    setToolsOpen(false);
                  }}
                  disabled={!imageGenerationAvailable || Boolean(pendingAttachment) || Boolean(pendingLargeTextMeta) || isStreaming}
                  title={!imageGenerationAvailable ? '请先在账号设置中配置图片生成模型' : undefined}
                  className={cn(
                    'flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-black transition disabled:text-slate-300',
                    mode === 'image' ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                  )}
                >
                  <ImageIcon size={16} />
                  <span className="min-w-0 flex-1">生成图片</span>
                  {mode === 'image' && <Check size={14} />}
                </button>
                {canClearMessages && onClearMessages && (
                  <>
                    <div className="my-1 h-[1px] bg-black/[0.06]" />
                    <button
                      type="button"
                      onClick={() => {
                        setToolsOpen(false);
                        onClearMessages();
                      }}
                      disabled={isStreaming}
                      className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-black text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:text-slate-300 cursor-pointer"
                    >
                      <Trash2 size={16} />
                      <span className="min-w-0 flex-1">清空聊天记录</span>
                    </button>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setToolsOpen((open) => !open)}
              disabled={isStreaming}
              aria-label={toolsOpen ? '关闭工具菜单' : '打开工具菜单'}
              aria-expanded={toolsOpen}
              title="工具"
              className={cn(
                'relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:text-slate-300',
                toolsOpen && 'bg-white text-slate-950 shadow-sm'
              )}
            >
              <Plus size={19} className={cn('transition-transform', toolsOpen && 'rotate-45')} />
              {(webSearchEnabled || mode === 'image') && (
                <span className={cn('absolute right-2 top-2 h-2 w-2 rounded-full ring-2 ring-white', mode === 'image' ? 'bg-rose-500' : 'bg-emerald-500')} />
              )}
            </button>
          </div>
          <textarea
            ref={inputRef}
            onPaste={onPaste}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            placeholder={mode === 'image' ? '描述你想生成的图片...' : `向 ${agentName} 说点什么...`}
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
        </ComposerShell>
      </div>
    </footer>
  );
}
