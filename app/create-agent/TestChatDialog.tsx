'use client';

import { Send, X } from 'lucide-react';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { cn } from '@/lib/utils';
import type { TestChatMessage } from './types';

type TestChatDialogProps = {
  open: boolean;
  input: string;
  messages: TestChatMessage[];
  loading: boolean;
  onInputChange: (value: string) => void;
  onClose: () => void;
  onSend: () => void;
};

export default function TestChatDialog({
  open,
  input,
  messages,
  loading,
  onInputChange,
  onClose,
  onSend,
}: TestChatDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#19172a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-sm font-black text-white">测试对话</div>
            <div className="mt-1 text-xs text-white/40">临时沙盒，关闭后不会保存记录。</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white/64 transition hover:bg-white/[0.12] hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6',
                  message.role === 'user' ? 'bg-white text-[#19172a]' : 'bg-white/[0.08] text-white/76'
                )}
              >
                {message.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl bg-white/[0.08] px-4 py-3 text-sm text-white/54">
                <LoadingSpinner size="sm" />
                正在回复...
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-white/10 p-4">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
              placeholder="输入一句话测试角色反应..."
              className="h-11 min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.08] px-4 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={!input.trim() || loading}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-2xl transition',
                input.trim() && !loading
                  ? 'bg-white text-[#19172a] hover:-translate-y-0.5'
                  : 'bg-white/[0.08] text-white/30'
              )}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
