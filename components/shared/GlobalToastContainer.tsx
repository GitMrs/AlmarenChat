'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Info,
  AlertTriangle,
  AlertCircle,
  X,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import { subscribeToasts, dismissToast, type ToastItem } from '@/lib/toast';

export default function GlobalToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts((next) => {
      setItems(next);
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed top-5 right-5 z-[9999] flex flex-col items-end gap-2.5 pointer-events-none max-w-sm w-full select-none"
      aria-live="polite"
    >
      {items.map((item) => {
        if (item.type === 'alert') {
          return (
            <div
              key={item.id}
              className="pointer-events-auto w-full rounded-2xl border border-black/[0.08] bg-white/95 p-3.5 shadow-2xl backdrop-blur-md transition-all duration-300 ease-out transform translate-x-0 opacity-100"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {item.symbol && (
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-black text-white">
                      {item.symbol}
                    </span>
                  )}
                  <span className="text-xs font-black text-slate-950">
                    {item.title || '行情风控提醒'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(item.id)}
                  className="text-slate-400 hover:text-slate-700 transition cursor-pointer p-0.5 rounded"
                  title="关闭"
                >
                  <X size={13} />
                </button>
              </div>

              <p className="mt-1.5 text-xs font-semibold leading-relaxed text-slate-600">
                {item.message}
              </p>

              {item.actionLabel && (
                <div className="mt-2.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      item.onAction?.();
                      dismissToast(item.id);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-2.5 py-1 text-[11px] font-black text-white shadow-sm transition hover:bg-slate-800 cursor-pointer"
                  >
                    <span>{item.actionLabel}</span>
                    <ExternalLink size={11} />
                  </button>
                </div>
              )}
            </div>
          );
        }

        // 普通轻量操作反馈 Toast (Mini Capsule)
        return (
          <div
            key={item.id}
            className="pointer-events-auto flex items-center gap-2.5 rounded-2xl border border-white/10 bg-slate-950/90 px-3.5 py-2.5 text-white shadow-2xl backdrop-blur-md transition-all duration-300 ease-out transform translate-x-0 opacity-100 max-w-[340px]"
          >
            {item.type === 'success' && (
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
            )}
            {item.type === 'info' && (
              <Info size={15} className="text-blue-400 shrink-0" />
            )}
            {item.type === 'warning' && (
              <AlertTriangle size={15} className="text-amber-400 shrink-0" />
            )}
            {item.type === 'error' && (
              <AlertCircle size={15} className="text-rose-400 shrink-0" />
            )}

            <span className="text-xs font-bold leading-snug tracking-tight text-slate-100 flex-1">
              {item.message}
            </span>

            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              className="text-slate-400 hover:text-white transition cursor-pointer p-0.5 ml-0.5"
              title="关闭"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
