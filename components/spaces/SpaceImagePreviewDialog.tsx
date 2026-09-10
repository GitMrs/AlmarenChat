'use client';

import { useEffect } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import type { SpaceFile } from '@/types';

export default function SpaceImagePreviewDialog({
  file,
  url,
  downloading,
  onClose,
  onDownload,
}: {
  file: SpaceFile | null;
  url: string;
  downloading: boolean;
  onClose: () => void;
  onDownload: () => void;
}) {
  useEffect(() => {
    if (!file || !url) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [file, onClose, url]);

  if (!file || !url) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/95"
      role="dialog"
      aria-modal="true"
      aria-labelledby="space-image-preview-title"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-4 sm:px-6">
        <div id="space-image-preview-title" className="min-w-0 flex-1 truncate text-sm font-black text-white">{file.fileName}</div>
        <button type="button" onClick={onDownload} disabled={downloading} title="下载图片" className="flex h-10 w-10 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white disabled:text-white/30">
          {downloading ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
        </button>
        <button type="button" onClick={onClose} title="关闭预览" className="flex h-10 w-10 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white">
          <X size={20} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8" onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}>
        <img src={url} alt={file.fileName} className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  );
}
