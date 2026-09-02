'use client';

import { useEffect, useState } from 'react';
import { Code2, Copy, ExternalLink, Eye, Globe2, Image as ImageIcon, Loader2, Maximize2, Minimize2, Save, X } from 'lucide-react';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import StaticHtmlPreview from '@/components/spaces/StaticHtmlPreview';
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
  const [mode, setMode] = useState<'preview' | 'source'>('source');
  const [preview, setPreview] = useState<{ url: string; rootUrl: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [externalImages, setExternalImages] = useState(true);
  const [externalImagesBusy, setExternalImagesBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [share, setShare] = useState<{ enabled: boolean; url: string | null } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const dirty = content !== originalContent;
  const htmlPreview = /\.html?$/i.test(file?.fileName || '');

  useEffect(() => {
    if (!file) return;
    let active = true;
    setLoading(true);
    setError('');
    setContent('');
    setOriginalContent('');
    setReadOnlyReason(null);
    setMode(/\.html?$/i.test(file.fileName) ? 'preview' : 'source');
    setPreview(null);
    setPreviewError('');
    setExternalImages(true);
    setExternalImagesBusy(false);
    setFullscreen(false);
    setShare(null);
    setShareBusy(false);
    setShareError('');
    setShareMessage('');
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
    if (/\.html?$/i.test(file.fileName)) {
      spacesApi.createFilePreview(spaceId, file.id, { externalImages: true })
        .then((result) => {
          if (active) setPreview(result);
        })
        .catch((reason: any) => {
          if (active) setPreviewError(reason.message || '创建网页预览失败');
        });
      spacesApi.getFileShare(spaceId, file.id)
        .then((result) => {
          if (active) setShare(result);
        })
        .catch((reason: any) => {
          if (active) setShareError(reason.message || '读取共享状态失败');
        });
    }
    return () => {
      active = false;
    };
  }, [file, spaceId]);

  useEffect(() => {
    if (!file) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      if (fullscreen) {
        setFullscreen(false);
        return;
      }
      if (dirty) setDiscardOpen(true);
      else onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dirty, file, fullscreen, onClose, saving]);

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
      if (htmlPreview) {
        try {
          setPreview(await spacesApi.createFilePreview(spaceId, file.id, { externalImages }));
          setPreviewError('');
        } catch (reason: any) {
          setPreview(null);
          setPreviewError(reason.message || '创建网页预览失败');
        }
      }
      onSaved(result.file);
    } catch (reason: any) {
      setError(reason.message || '保存文件失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleExternalImages = async () => {
    if (!htmlPreview || externalImagesBusy) return;
    const next = !externalImages;
    setExternalImagesBusy(true);
    setPreviewError('');
    try {
      const result = await spacesApi.createFilePreview(spaceId, file.id, { externalImages: next });
      setExternalImages(next);
      setPreview(result);
    } catch (reason: any) {
      setPreviewError(reason.message || '更新外部图片权限失败');
    } finally {
      setExternalImagesBusy(false);
    }
  };

  const toggleShare = async () => {
    if (shareBusy || !share || (dirty && !share.enabled)) return;
    setShareBusy(true);
    setShareError('');
    setShareMessage('');
    try {
      const result = share.enabled
        ? await spacesApi.disableFileShare(spaceId, file.id)
        : await spacesApi.enableFileShare(spaceId, file.id);
      setShare(result);
      setShareMessage(result.enabled ? '任何获得链接的人都可以访问' : '共享已关闭，原链接已失效');
    } catch (reason: any) {
      setShareError(reason.message || '更新共享状态失败');
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = async () => {
    if (!share?.url) return;
    try {
      await navigator.clipboard.writeText(new URL(share.url, window.location.origin).toString());
      setShareError('');
      setShareMessage('共享链接已复制');
    } catch {
      setShareError('复制共享链接失败');
    }
  };

  return (
    <>
      <div className={`fixed inset-0 z-40 flex bg-slate-950/30 sm:items-center sm:justify-center ${fullscreen ? '' : 'sm:p-6'}`} role="dialog" aria-modal="true" aria-labelledby="space-file-editor-title">
        <div className={`flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl ${fullscreen ? '' : 'sm:max-h-[90vh] sm:max-w-5xl sm:rounded-lg sm:border sm:border-black/[0.08]'}`}>
          <header className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              {htmlPreview && mode === 'preview' ? <Eye size={17} /> : <Code2 size={17} />}
            </div>
            <div className="min-w-0 flex-1">
              <div id="space-file-editor-title" className="truncate text-sm font-black text-slate-900">{file.fileName}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-slate-400">
                <span>{htmlPreview && mode === 'preview' ? 'HTML 预览' : '文本编辑'}</span>
                {dirty && <span className="text-amber-600">尚未保存</span>}
              </div>
            </div>
            {htmlPreview && !loading && (
              <div className="flex shrink-0 rounded-lg bg-slate-100 p-1" role="group" aria-label="文件查看方式">
                <button
                  type="button"
                  onClick={() => setMode('preview')}
                  aria-pressed={mode === 'preview'}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-black transition ${mode === 'preview' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}
                >
                  <Eye size={14} />
                  <span className="hidden sm:inline">预览</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('source')}
                  aria-pressed={mode === 'source'}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-black transition ${mode === 'source' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}
                >
                  <Code2 size={14} />
                  <span className="hidden sm:inline">源码</span>
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setFullscreen((value) => !value)}
              aria-label={fullscreen ? '退出全屏' : '全屏查看'}
              title={fullscreen ? '退出全屏' : '全屏查看'}
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950 sm:flex"
            >
              {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
            <button type="button" onClick={requestClose} disabled={saving} aria-label="关闭编辑器" title="关闭" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-200">
              <X size={18} />
            </button>
          </header>

          <div className="relative min-h-0 flex-1 bg-[#fbfaf7]">
            {loading ? (
              <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={22} /></div>
            ) : error && !content ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-rose-600">{error}</div>
            ) : htmlPreview && mode === 'preview' && preview ? (
              <StaticHtmlPreview title={file.fileName} entryUrl={preview.url} />
            ) : htmlPreview && mode === 'preview' ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-slate-400">
                {previewError || <Loader2 className="animate-spin" size={22} />}
              </div>
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
            <div className="min-w-0 flex-1 text-xs font-semibold text-slate-400">
              <div className={error ? 'text-rose-600' : ''}>
                {readOnlyReason || error || `${new Blob([content]).size.toLocaleString('zh-CN')} 字节 · UTF-8`}
              </div>
              {htmlPreview && (
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                  <ImageIcon size={14} className={externalImages ? 'text-emerald-600' : 'text-slate-400'} />
                  <span className="text-slate-600">外部图片</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={externalImages}
                    aria-label="加载 HTTPS 外部图片"
                    onClick={toggleExternalImages}
                    disabled={externalImagesBusy}
                    title={externalImages ? '停止加载外部图片' : '加载 HTTPS 外部图片'}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${externalImages ? 'bg-emerald-600' : 'bg-slate-200'} disabled:opacity-50`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${externalImages ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                  {externalImagesBusy && <Loader2 size={13} className="animate-spin" />}
                  <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />
                  <Globe2 size={14} className={share?.enabled ? 'text-emerald-600' : 'text-slate-400'} />
                  <span className="text-slate-600">公开共享</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(share?.enabled)}
                    aria-label="公开共享网页"
                    onClick={toggleShare}
                    disabled={!share || shareBusy || (dirty && !share.enabled)}
                    title={dirty && !share?.enabled ? '请先保存文件' : share?.enabled ? '关闭共享' : '开启共享'}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${share?.enabled ? 'bg-emerald-600' : 'bg-slate-200'} disabled:opacity-50`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${share?.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                  {shareBusy && <Loader2 size={13} className="animate-spin" />}
                  {share?.enabled && share.url && (
                    <>
                      <button type="button" onClick={copyShareLink} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950">
                        <Copy size={13} />
                        复制链接
                      </button>
                      <button type="button" onClick={() => window.open(share.url!, '_blank', 'noopener,noreferrer')} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950">
                        <ExternalLink size={13} />
                        打开网页
                      </button>
                    </>
                  )}
                  {(shareError || shareMessage) && (
                    <span className={shareError ? 'text-rose-600' : 'text-emerald-600'}>{shareError || shareMessage}</span>
                  )}
                </div>
              )}
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
