'use client';

import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  icon?: ReactNode;
  cancelText?: string;
  confirmText?: string;
  loading?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  icon,
  cancelText = '取消',
  confirmText = '确认',
  loading = false,
  destructive = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;

  const accentClass = destructive ? 'bg-rose-500/20 text-rose-400' : 'bg-white/[0.08] text-white/70';
  const confirmClass = destructive
    ? 'bg-rose-500 text-white hover:bg-rose-600 disabled:bg-white/[0.08] disabled:text-white/30'
    : 'bg-white text-[#19172a] hover:bg-white/90 disabled:bg-white/[0.08] disabled:text-white/30';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#242039] p-6">
        {icon && (
          <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl ${accentClass}`}>
            {icon}
          </div>
        )}
        <h2 className="text-xl font-black text-white">{title}</h2>
        <div className="mt-3 text-sm leading-6 text-white/54">{description}</div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] px-5 text-sm font-black text-white/70 transition hover:text-white disabled:text-white/30"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-black transition ${confirmClass}`}
          >
            {loading ? <Loader2 className="animate-spin" size={15} /> : icon}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
