export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'alert';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  symbol?: string;
  actionLabel?: string;
  onAction?: () => void;
  createdAt: number;
}

type ToastListener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<ToastListener>();

function notify() {
  const current = [...toasts];
  listeners.forEach((listener) => {
    try {
      listener(current);
    } catch (err) {
      console.error('[toast] listener error:', err);
    }
  });
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function showToast(item: Omit<ToastItem, 'id' | 'createdAt'>): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const duration = item.duration ?? (item.type === 'alert' ? 6000 : 3200);

  const newToast: ToastItem = {
    ...item,
    id,
    duration,
    createdAt: Date.now(),
  };

  // 最多保留最近 5 条通知，避免堆叠过多
  toasts = [newToast, ...toasts.slice(0, 4)];
  notify();

  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }

  return id;
}

export const toast = {
  success: (message: string, duration?: number) =>
    showToast({ type: 'success', message, duration }),
  info: (message: string, duration?: number) =>
    showToast({ type: 'info', message, duration }),
  warning: (message: string, duration?: number) =>
    showToast({ type: 'warning', message, duration }),
  error: (message: string, duration?: number) =>
    showToast({ type: 'error', message, duration }),
  alert: (options: {
    title: string;
    message: string;
    symbol?: string;
    actionLabel?: string;
    onAction?: () => void;
    duration?: number;
  }) => showToast({ type: 'alert', ...options }),
  dismiss: dismissToast,
};
