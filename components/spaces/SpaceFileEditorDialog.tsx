'use client';

import { useEffect, useState } from 'react';
import { Code2, Loader2, Save, X } from 'lucide-react';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { spaces as spacesApi } from '@/lib/api';
import type { SpaceFile } from '@/types';

export default function SpaceFileEditorDialog({
  spaceId,
  file,
  onClose,
  onSaved,
}: {
  spaceId: string;
  file: SpaceFile | null;
  onClose: () => void;
  onSaved: (file: SpaceFile) => void;
}) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const dirty = content !== originalContent;

  useEffect(() => {
    if (!file) return;
    let active = true;
    setLoading(true);
    setError('');
    setContent('');
    setOriginalContent('');
    setReadOnlyReason(null);
    spacesApi.readFileText(spaceId, file.id)
      .then((result) => {
        if (!active) return;
        setContent(result.content);
        setOriginalContent(result.content);
        setUpdatedAt(result.updatedAt);
        setReadOnlyReason(result.readOnlyReason);
      })
      .catch((reason: any) => {
        if (active) setError(reason.message || '读取文件失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [file, spaceId]);

  useEffect(() => {
    if (!file) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      if (dirty) setDiscardOpen(true);
      else onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dirty, file, onClose, saving]);

  if (!file) return null;

  const requestClose = () => {
    if (saving) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  };

  const save = async () => {
    if (saving || loading || readOnlyReason || !dirty) return;
    setSaving(true);
    setError('');
    try {
      const result = await spacesApi.updateFileText(spaceId, file.id, content, updatedAt);
      setOriginalContent(content);
      setUpdatedAt(result.file.updatedAt || null);
      onSaved(result.file);
    } catch (reason: any) {
      setError(reason.message || '保存文件失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 flex bg-slate-950/30 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="space-file-editor-title">
        <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[90vh] sm:max-w-5xl sm:rounded-lg sm:border sm:border-black/[0.08]">
          <header className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Code2 size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div id="space-file-editor-title" className="truncate text-sm font-black text-slate-900">{file.fileName}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-slate-400">
                <span>文本编辑</span>
                {dirty && <span className="text-amber-600">尚未保存</span>}
              </div>
            </div>
            <button type="button" onClick={requestClose} disabled={saving} aria-label="关闭编辑器" title="关闭" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-200">
              <X size={18} />
            </button>
          </header>

          <div className="relative min-h-0 flex-1 bg-[#fbfaf7]">
            {loading ? (
              <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={22} /></div>
            ) : error && !content ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-rose-600">{error}</div>
            ) : (
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                readOnly={Boolean(readOnlyReason)}
                spellCheck={false}
                aria-label={`${file.fileName} 文件内容`}
                className="h-full w-full resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-6 text-slate-800 outline-none read-only:text-slate-500 sm:px-6 sm:py-5"
              />
            )}
          </div>

          <footer className="flex shrink-0 flex-col gap-3 border-t border-black/[0.06] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0 text-xs font-semibold text-slate-400">
              {readOnlyReason || error || `${new Blob([content]).size.toLocaleString('zh-CN')} 字节 · UTF-8`}
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={requestClose} disabled={saving} className="inline-flex h-10 flex-1 items-center justify-center rounded-lg px-4 text-xs font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-300 sm:flex-none">
                关闭
              </button>
              <button type="button" onClick={save} disabled={loading || saving || Boolean(readOnlyReason) || !dirty} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 sm:flex-none">
                {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
                保存文件
              </button>
            </div>
          </footer>
        </div>
      </div>
      <ConfirmDialog
        open={discardOpen}
        title="放弃未保存的修改？"
        description="关闭后，本次尚未保存的内容会丢失。"
        cancelText="继续编辑"
        confirmText="放弃修改"
        destructive
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
