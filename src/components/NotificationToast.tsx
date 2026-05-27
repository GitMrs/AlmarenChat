import React from 'react';
import { X, MessageCircle } from 'lucide-react';

interface Toast {
  id: string;
  title: string;
  message: string;
  avatar?: string;
  chatId?: string;
}

interface NotificationToastProps {
  toasts: Toast[];
  onClose: (id: string) => void;
  onToastClick: (chatId: string) => void;
}

export function NotificationToast({ toasts, onClose, onToastClick }: NotificationToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 w-80">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => toast.chatId && onToastClick(toast.chatId)}
          className="bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-gray-100 overflow-hidden cursor-pointer hover:shadow-[0_12px_40px_rgba(0,0,0,0.18)] hover:-translate-y-0.5 transition-all duration-200"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[#1e2329] to-[#2d3238]">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              {toast.avatar ? (
                <img src={toast.avatar} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                <MessageCircle size={20} className="text-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[15px] text-white">{toast.title}</p>
              <p className="text-[12px] text-white/60">New message</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(toast.id);
              }}
              className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
            >
              <X size={16} className="text-white/60" />
            </button>
          </div>

          {/* Content */}
          <div className="px-4 py-3">
            <p className="text-[14px] text-gray-700 leading-relaxed line-clamp-2">
              {toast.message}
            </p>
            {toast.chatId && (
              <p className="text-[12px] text-[#1e2329] font-medium mt-2 flex items-center gap-1">
                <span>Tap to reply</span>
                <span className="text-gray-300">→</span>
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Hook to manage notifications
export function useToastNotifications() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const addToast = (title: string, message: string, chatId?: string, avatar?: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setToasts((prev) => [...prev, { id, title, message, chatId, avatar }]);

    // Auto remove after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { toasts, addToast, removeToast };
}