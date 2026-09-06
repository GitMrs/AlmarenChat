'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Copy, ExternalLink, Eye, Globe2, Image as ImageIcon, Loader2, Maximize2, Minimize2, Package, Save, X } from 'lucide-react';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import MarkdownPublishingPreview from '@/components/spaces/MarkdownPublishingPreview';
import StaticHtmlPreview from '@/components/spaces/StaticHtmlPreview';
import { spaces as spacesApi } from '@/lib/api';
import { isWechatPublishableMarkdownFile, splitWechatArticleMarkdown } from '@/lib/wechat-publishing.mjs';
import { getWechatPublishingTheme, WECHAT_PUBLISHING_THEMES } from '@/lib/wechat-publishing-themes.mjs';
import type { SpaceFile } from '@/types';

const WECHAT_THEME_STORAGE_KEY = 'almaren:wechat-publishing-theme';

function turnTablesIntoCards(root: HTMLElement, theme: ReturnType<typeof getWechatPublishingTheme>) {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent?.trim() || '');
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    if (headers.length === 0 || rows.length === 0) continue;

    const list = document.createElement('section');
    list.setAttribute('style', 'margin:20px 0;');
    for (const row of rows) {
      const values = Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim() || '');
      const card = document.createElement('section');
      card.setAttribute('style', `margin:0 0 12px;padding:14px 16px;border:1px solid ${theme.border};background-color:${theme.cardBackground};`);
      values.forEach((value, index) => {
        if (!value) return;
        const line = document.createElement('p');
        line.setAttribute('style', `margin:${index === 0 ? '0 0 8px' : '4px 0'};color:#374151;font-size:${index === 0 ? '16px' : '14px'};line-height:1.7;`);
        if (index === 0) {
          const strong = document.createElement('strong');
          strong.textContent = value;
          line.appendChild(strong);
        } else {
          const label = document.createElement('strong');
          label.textContent = `${headers[index] || `项目 ${index + 1}`}：`;
          line.append(label, document.createTextNode(value));
        }
        card.appendChild(line);
      });
      list.appendChild(card);
    }
    table.replaceWith(list);
  }
}

function legacyCopyHtml(html: string) {
  const target = document.createElement('div');
  target.contentEditable = 'true';
  target.style.position = 'fixed';
  target.style.left = '-10000px';
  target.innerHTML = html;
  document.body.appendChild(target);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(target);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const copied = document.execCommand('copy');
  selection?.removeAllRanges();
  target.remove();
  if (!copied) throw new Error('copy failed');
}

function legacyCopyText(text: string) {
  const target = document.createElement('textarea');
  target.value = text;
  target.style.position = 'fixed';
  target.style.left = '-10000px';
  document.body.appendChild(target);
  target.select();
  const copied = document.execCommand('copy');
  target.remove();
  if (!copied) throw new Error('copy failed');
}

export default function SpaceFileEditorDialog({
  spaceId,
  file,
  publishTarget,
  onClose,
  onSaved,
}: {
  spaceId: string;
  file: SpaceFile | null;
  publishTarget?: 'wechat';
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
  const [externalDependencies, setExternalDependencies] = useState(false);
  const [externalDependenciesBusy, setExternalDependenciesBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [share, setShare] = useState<{ enabled: boolean; url: string | null; externalDependencies: boolean } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [copyError, setCopyError] = useState('');
  const [wechatThemeId, setWechatThemeId] = useState('fresh-green');
  const markdownPreviewRef = useRef<HTMLDivElement>(null);
  const dirty = content !== originalContent;
  const htmlPreview = /\.html?$/i.test(file?.fileName || '');
  const markdownPreview = /\.(?:md|markdown)$/i.test(file?.fileName || '');
  const previewable = htmlPreview || markdownPreview;
  const wechatPublishing = publishTarget === 'wechat' && isWechatPublishableMarkdownFile(file?.fileName);
  const article = useMemo(
    () => (wechatPublishing ? splitWechatArticleMarkdown(content) : { title: '', body: content }),
    [content, wechatPublishing]
  );
  const wechatTheme = useMemo(() => getWechatPublishingTheme(wechatThemeId), [wechatThemeId]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(WECHAT_THEME_STORAGE_KEY);
      if (WECHAT_PUBLISHING_THEMES.some((item) => item.id === stored)) setWechatThemeId(stored!);
    } catch {
      // Browser privacy settings may disable local storage; the default theme still works.
    }
  }, []);

  useEffect(() => {
    if (!file) return;
    let active = true;
    setLoading(true);
    setError('');
    setContent('');
    setOriginalContent('');
    setReadOnlyReason(null);
    setMode(/\.(?:html?|md|markdown)$/i.test(file.fileName) ? 'preview' : 'source');
    setPreview(null);
    setPreviewError('');
    setExternalImages(true);
    setExternalImagesBusy(false);
    setExternalDependencies(false);
    setExternalDependenciesBusy(false);
    setFullscreen(false);
    setShare(null);
    setShareBusy(false);
    setShareError('');
    setShareMessage('');
    setCopyError('');
    setCopyMessage('');
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
      void (async () => {
        let allowExternalDependencies = false;
        try {
          const result = await spacesApi.getFileShare(spaceId, file.id);
          if (!active) return;
          setShare(result);
          allowExternalDependencies = result.externalDependencies;
          setExternalDependencies(allowExternalDependencies);
        } catch (reason: any) {
          if (active) setShareError(reason.message || '读取共享状态失败');
        }
        try {
          const result = await spacesApi.createFilePreview(spaceId, file.id, {
            externalImages: true,
            externalDependencies: allowExternalDependencies,
          });
          if (active) setPreview(result);
        } catch (reason: any) {
          if (active) setPreviewError(reason.message || '创建网页预览失败');
        }
      })();
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
          setPreview(await spacesApi.createFilePreview(spaceId, file.id, { externalImages, externalDependencies }));
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
      const result = await spacesApi.createFilePreview(spaceId, file.id, {
        externalImages: next,
        externalDependencies,
      });
      setExternalImages(next);
      setPreview(result);
    } catch (reason: any) {
      setPreviewError(reason.message || '更新外部图片权限失败');
    } finally {
      setExternalImagesBusy(false);
    }
  };

  const toggleExternalDependencies = async () => {
    if (!htmlPreview || externalDependenciesBusy) return;
    const next = !externalDependencies;
    setExternalDependenciesBusy(true);
    setPreviewError('');
    setShareError('');
    setShareMessage('');
    try {
      if (share?.enabled) {
        setShare(await spacesApi.enableFileShare(spaceId, file.id, { externalDependencies: next }));
      }
      const result = await spacesApi.createFilePreview(spaceId, file.id, {
        externalImages,
        externalDependencies: next,
      });
      setExternalDependencies(next);
      setPreview(result);
      if (share?.enabled) setShareMessage(next ? '共享页已允许受信任的外部依赖' : '共享页已停止加载外部依赖');
    } catch (reason: any) {
      setPreviewError(reason.message || '更新外部依赖权限失败');
    } finally {
      setExternalDependenciesBusy(false);
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
        : await spacesApi.enableFileShare(spaceId, file.id, { externalDependencies });
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

  const copyWechatTitle = async () => {
    if (!article.title) {
      setCopyError('正文缺少一级标题，请先在源码中补充');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(article.title);
      else legacyCopyText(article.title);
      setCopyError('');
      setCopyMessage('标题已复制');
    } catch {
      try {
        legacyCopyText(article.title);
        setCopyError('');
        setCopyMessage('标题已复制');
      } catch {
        setCopyError('复制标题失败');
      }
    }
  };

  const copyWechatBody = async () => {
    if (!markdownPreviewRef.current || !article.body) {
      setCopyError('没有可复制的公众号正文');
      return;
    }
    const clone = markdownPreviewRef.current.cloneNode(true) as HTMLDivElement;
    turnTablesIntoCards(clone, wechatTheme);
    const html = `<section style="margin:0 auto;max-width:680px;color:#374151;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${clone.innerHTML}</section>`;
    const plainText = clone.textContent || '';
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        })]);
      } else {
        legacyCopyHtml(html);
      }
      setCopyError('');
      setCopyMessage('公众号正文已按富文本格式复制');
    } catch {
      try {
        legacyCopyHtml(html);
        setCopyError('');
        setCopyMessage('公众号正文已按富文本格式复制');
      } catch {
        setCopyError('复制正文失败，请使用最新版浏览器重试');
      }
    }
  };

  const selectWechatTheme = (themeId: string) => {
    setWechatThemeId(themeId);
    setCopyError('');
    setCopyMessage('');
    try {
      window.localStorage.setItem(WECHAT_THEME_STORAGE_KEY, themeId);
    } catch {
      // Keep the in-memory selection when storage is unavailable.
    }
  };

  return (
    <>
      <div className={`fixed inset-0 z-40 flex bg-slate-950/30 sm:items-center sm:justify-center ${fullscreen ? '' : 'sm:p-6'}`} role="dialog" aria-modal="true" aria-labelledby="space-file-editor-title">
        <div className={`flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl ${fullscreen ? '' : 'sm:max-h-[90vh] sm:max-w-5xl sm:rounded-lg sm:border sm:border-black/[0.08]'}`}>
          <header className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-4 py-3 sm:px-5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              {previewable && mode === 'preview' ? <Eye size={17} /> : <Code2 size={17} />}
            </div>
            <div className="min-w-0 flex-1">
              <div id="space-file-editor-title" className="truncate text-sm font-black text-slate-900">{file.fileName}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-slate-400">
                <span>{mode === 'preview' && htmlPreview ? 'HTML 预览' : mode === 'preview' && markdownPreview ? (wechatPublishing ? '公众号发布预览' : 'Markdown 预览') : '文本编辑'}</span>
                {dirty && <span className="text-amber-600">尚未保存</span>}
              </div>
            </div>
            {previewable && !loading && (
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
            ) : markdownPreview && mode === 'preview' ? (
              <div className="h-full overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
                {wechatPublishing && (
                  <div className="mx-auto mb-6 max-w-[680px] border-b border-black/[0.08] pb-5">
                    <div className="mb-5 flex min-w-0 items-center gap-3 overflow-x-auto pb-1" role="group" aria-label="公众号排版主题">
                      <span className="shrink-0 text-[11px] font-black text-slate-400">排版主题</span>
                      {WECHAT_PUBLISHING_THEMES.map((theme) => {
                        const selected = theme.id === wechatTheme.id;
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            onClick={() => selectWechatTheme(theme.id)}
                            aria-pressed={selected}
                            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-black transition ${selected ? 'border-slate-900 bg-white text-slate-900 shadow-sm' : 'border-black/[0.06] bg-white/60 text-slate-500 hover:border-black/[0.14]'}`}
                          >
                            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: theme.accent }} aria-hidden="true" />
                            {theme.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-[11px] font-black text-slate-400">公众号标题</div>
                    <div className="mt-2 text-xl font-black leading-8 text-slate-900">{article.title || '尚未设置一级标题'}</div>
                  </div>
                )}
                <MarkdownPublishingPreview ref={markdownPreviewRef} content={article.body} themeId={wechatTheme.id} />
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
                  <Package size={14} className={externalDependencies ? 'text-emerald-600' : 'text-slate-400'} />
                  <span className="text-slate-600">外部依赖</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={externalDependencies}
                    aria-label="加载受信任 CDN 的外部依赖"
                    onClick={toggleExternalDependencies}
                    disabled={externalDependenciesBusy}
                    title={externalDependencies ? '停止加载外部依赖' : '允许加载受信任 CDN 的脚本、样式和字体'}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${externalDependencies ? 'bg-emerald-600' : 'bg-slate-200'} disabled:opacity-50`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${externalDependencies ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                  {externalDependenciesBusy && <Loader2 size={13} className="animate-spin" />}
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
              {wechatPublishing && mode === 'preview' && (copyError || copyMessage) && (
                <div className={`mt-1 ${copyError ? 'text-rose-600' : 'text-emerald-600'}`}>{copyError || copyMessage}</div>
              )}
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
              {wechatPublishing && mode === 'preview' && (
                <>
                  <button type="button" onClick={copyWechatTitle} disabled={!article.title} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:text-slate-300 sm:flex-none">
                    <Copy size={14} />
                    复制标题
                  </button>
                  <button type="button" onClick={copyWechatBody} disabled={!article.body} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white transition hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 sm:flex-none">
                    <Copy size={14} />
                    复制公众号正文
                  </button>
                </>
              )}
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
