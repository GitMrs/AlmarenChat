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

  const accentClass = destructive ? 'bg-rose-50 text-rose-500' : 'bg-slate-100 text-slate-700';
  const confirmClass = destructive
    ? 'bg-rose-500 text-white hover:bg-rose-600 disabled:bg-slate-200 disabled:text-slate-400'
    : 'bg-slate-950 text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-black/[0.08] bg-white p-6 shadow-2xl">
        {icon && (
          <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl ${accentClass}`}>
            {icon}
          </div>
        )}
        <h2 className="text-xl font-black text-slate-950">{title}</h2>
        <div className="mt-3 text-sm leading-6 text-slate-500">{description}</div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center rounded-full border border-black/[0.06] bg-white px-5 text-sm font-black text-slate-600 shadow-sm transition hover:text-slate-950 disabled:text-slate-300"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-black shadow-sm transition ${confirmClass}`}
          >
            {loading ? <Loader2 className="animate-spin" size={15} /> : icon}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
