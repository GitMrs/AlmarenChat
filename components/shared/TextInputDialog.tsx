'use client';

import { useEffect, useState } from 'react';

interface TextInputDialogProps {
  open: boolean;
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}

export default function TextInputDialog({ open, title, label, defaultValue = '', placeholder, confirmLabel = '保存', loading = false, onCancel, onConfirm }: TextInputDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  if (!open) return null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextValue = value.trim();
    if (!nextValue || loading) return;
    await onConfirm(nextValue);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="text-input-dialog-title">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <h2 id="text-input-dialog-title" className="text-lg font-black text-slate-950">{title}</h2>
        {label && <label className="mt-4 block text-xs font-bold text-slate-500">{label}</label>}
        <input autoFocus disabled={loading} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-black/[0.1] px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 disabled:bg-slate-50" />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={loading} onClick={onCancel} className="rounded-xl px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 disabled:text-slate-300">取消</button>
          <button type="submit" disabled={loading} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">{loading ? '保存中...' : confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
