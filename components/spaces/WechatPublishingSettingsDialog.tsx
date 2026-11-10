'use client';

import { useEffect, useState } from 'react';
import { spaces as spacesApi } from '@/lib/client/api';
import { normalizeWechatPublishingSettings, wechatCoverCrop } from '@/lib/workspace/wechat/wechat-publishing-validation.mjs';
import { WECHAT_PUBLISHING_THEMES } from '@/lib/workspace/wechat/wechat-publishing-themes.mjs';
import type { SpaceFile, SpaceWork } from '@/types';

export default function WechatPublishingSettingsDialog({ spaceId, work, files, onSave, onClose }: {
  spaceId: string; work: SpaceWork; files: SpaceFile[];
  onSave: (work: SpaceWork, settings: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const initial = (work.metadata?.wechatPublishing || {}) as Record<string, any>;
  const [settings, setSettings] = useState({ author: '', digest: '', contentSourceUrl: '', openComment: false, fansOnlyComment: false, themeId: 'fresh-green', coverFileId: '', ...initial });
  const initialCrops = Array.isArray(initial.coverInfo?.crop_percent_list) ? initial.coverInfo.crop_percent_list : [];
  const focus = (axis: 'x' | 'y') => {
    const crop = initialCrops.find((item: any) => item && Number(item[axis + '2']) - Number(item[axis + '1']) < 0.999999);
    const value = crop ? Number(crop[axis + '1']) / (1 - Number(crop[axis + '2']) + Number(crop[axis + '1'])) * 100 : 50;
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50;
  };
  const [focusX, setFocusX] = useState(focus('x'));
  const [focusY, setFocusY] = useState(focus('y'));
  const [image, setImage] = useState('');
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const update = (value: Record<string, unknown>) => { setSettings((current) => ({ ...current, ...value })); setDirty(true); };
  useEffect(() => {
    if (!dirty) return;
    const preventDiscard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventDiscard);
    return () => window.removeEventListener('beforeunload', preventDiscard);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setImage(''); setDimensions({ width: 0, height: 0 }); setError('');
    if (settings.coverFileId) spacesApi.downloadFile(spaceId, settings.coverFileId).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setImage(objectUrl); else URL.revokeObjectURL(objectUrl);
    }).catch((reason) => { if (active) setError(reason.message || '封面读取失败'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [spaceId, settings.coverFileId]);
  const save = async () => {
    setError(''); setBusy(true);
    try {
      if (settings.coverFileId && !dimensions.width) throw new Error('请等待封面加载完成后再保存');
      const coverInfo = settings.coverFileId ? { crop_percent_list: ['2.35_1', '1_1'].map((ratio) => wechatCoverCrop(dimensions.width, dimensions.height, ratio, focusX, focusY)) } : undefined;
      await onSave(work, normalizeWechatPublishingSettings({ ...settings, coverInfo }));
      onClose();
    } catch (reason: any) { setError(reason.message || '保存发布资料失败'); }
    finally { setBusy(false); }
  };
  const imageFiles = files.filter((file) => file.status === 'READY' && (!file.workId || file.workId === work.id) && String(file.mimeType || '').startsWith('image/'));
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3" role="dialog" aria-modal="true" aria-label="文章发布资料">
    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 sm:p-6">
      <h2 className="text-lg font-black text-slate-900">发布资料 · {work.title}</h2>
      <p className="mt-2 text-xs leading-5 text-slate-500">正式标题使用正文首行。这里保存本篇的发布设置，不会创建草稿或发布文章。</p>
      <div className="mt-4 space-y-4 text-xs font-bold text-slate-600">
        <label className="block">作者（最多 16 字）<input value={settings.author} onChange={(event) => update({ author: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
        <label className="block">摘要（最多 120 字）<textarea value={settings.digest} onChange={(event) => update({ digest: event.target.value })} rows={3} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
        <label className="block">原文链接<input value={settings.contentSourceUrl} onChange={(event) => update({ contentSourceUrl: event.target.value })} type="url" placeholder="https://…" className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
        <div className="flex flex-wrap gap-4"><label className="flex items-center gap-2"><input type="checkbox" checked={settings.openComment} onChange={(event) => update({ openComment: event.target.checked })} />开放评论</label><label className="flex items-center gap-2"><input type="checkbox" checked={settings.fansOnlyComment} disabled={!settings.openComment} onChange={(event) => update({ fansOnlyComment: event.target.checked })} />仅粉丝可评论</label></div>
        <label className="block">排版主题<select value={settings.themeId} onChange={(event) => update({ themeId: event.target.value })} className="ml-3 h-10 rounded-lg border border-slate-200 px-3">{WECHAT_PUBLISHING_THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
        <label className="block">本篇封面<select value={settings.coverFileId} onChange={(event) => { update({ coverFileId: event.target.value }); setFocusX(50); setFocusY(50); }} className="mt-2 h-10 w-full rounded-lg border border-slate-200 px-3"><option value="">暂不选择</option>{imageFiles.map((file) => <option key={file.id} value={file.id}>{file.fileName}</option>)}</select></label>
        {image && <div className="space-y-3">
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">{['2.35_1', '1_1'].map((ratio, index) => <div key={ratio}><p className="mb-2">{index ? '方图 1:1' : '宽图 2.35:1'}</p><div className="overflow-hidden rounded-lg bg-slate-100" style={{ aspectRatio: index ? '1' : '2.35' }}><img src={image} alt={index ? '方图裁剪预览' : '宽图裁剪预览'} onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} className="h-full w-full object-cover" style={{ objectPosition: `${focusX}% ${focusY}%` }} /></div></div>)}</div>
          <label className="flex items-center gap-3">左右位置<input type="range" min={0} max={100} value={focusX} onChange={(event) => { setFocusX(Number(event.target.value)); setDirty(true); }} className="min-w-0 flex-1" /></label>
          <label className="flex items-center gap-3">上下位置<input type="range" min={0} max={100} value={focusY} onChange={(event) => { setFocusY(Number(event.target.value)); setDirty(true); }} className="min-w-0 flex-1" /></label>
        </div>}
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-4 py-2">取消</button><button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-40">{busy ? '正在保存…' : '保存发布资料'}</button></div>
      </div>
    </div>
  </div>;
}
