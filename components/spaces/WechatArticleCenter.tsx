'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, FileText } from 'lucide-react';
import type { SpaceFile, SpaceWork } from '@/types';
import WechatPublishingSettingsDialog from './WechatPublishingSettingsDialog';

export default function WechatArticleCenter({ work, files, locked, onOpenFile, onDiscuss, onStrategy, onSaveObjective, onSavePublishing, spaceId }: {
  spaceId: string;
  work: SpaceWork | null;
  files: SpaceFile[];
  locked: boolean;
  onOpenFile: (file: SpaceFile) => void;
  onDiscuss: () => void;
  onStrategy: () => Promise<void>;
  onSaveObjective: (work: SpaceWork, objective: string) => Promise<void>;
  onSavePublishing: (work: SpaceWork, settings: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingWork, setEditingWork] = useState<SpaceWork | null>(null);
  const [publishingWork, setPublishingWork] = useState<SpaceWork | null>(null);
  const editingWorkId = editingWork?.id || '';
  const [objectiveDraft, setObjectiveDraft] = useState('');
  const objectiveDirty = Boolean(editingWork) && objectiveDraft !== (editingWork?.objective || '');
  useEffect(() => {
    if (!objectiveDirty) return;
    const preventDiscard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventDiscard);
    return () => window.removeEventListener('beforeunload', preventDiscard);
  }, [objectiveDirty]);

  const openStrategy = async () => {
    setError('');
    setBusy(true);
    try { await onStrategy(); }
    catch (reason: any) { setError(reason.message || '打开账号定位失败'); }
    finally { setBusy(false); }
  };

  const saveObjective = async (work: SpaceWork) => {
    if (busy || locked) return;
    setBusy(true);
    setError('');
    try { await onSaveObjective(editingWork || work, objectiveDraft.trim()); setEditingWork(null); }
    catch (reason: any) { setError(reason.message || '保存文章需求失败'); }
    finally { setBusy(false); }
  };

  const article = work ? files.find((file) => file.workId === work.id && /(?:^|\/)article\.md$/i.test(file.fileName)) : null;
  const details = work ? files.find((file) => file.workId === work.id && /(?:^|\/)publish-info\.md$/i.test(file.fileName)) : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbfaf7]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-emerald-700">公众号工作室</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">当前文章</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">这里展示左侧选中的文章。新建或切换文章，继续使用左侧入口。</p>
          </div>
          <button type="button" onClick={() => void openStrategy()} disabled={busy} className="rounded-lg border border-black/[0.08] bg-white px-4 py-2.5 text-xs font-bold text-slate-600 disabled:opacity-40">账号定位与风格</button>
        </div>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <section aria-label="公众号当前文章">
          {!work ? <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">还没有当前文章。可以先在对话里聊想法，或从左侧选择已有文章。</div> : (
            <article className="rounded-xl border border-black/[0.07] bg-white p-4">
              <div className="flex items-start justify-between gap-3"><h4 className="min-w-0 break-words text-sm font-black text-slate-800">{work.title}</h4><span className="shrink-0 text-xs text-slate-400">{work.status === 'ARCHIVED' ? '已归档' : work.status === 'COMPLETED' ? '已完成' : article ? '已有正文' : '选题 / 待制作'}</span></div>
              {work.objective && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-500">{work.objective}</p>}
              {!article && <p className="mt-2 text-sm text-slate-400">正文尚未生成，可以继续在对话里讨论或制作。</p>}
              {editingWorkId === work.id && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="编辑本篇需求"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
                <label className="block text-xs font-bold text-slate-500">本篇需求 · {work.title}
                  <textarea value={objectiveDraft} onChange={(event) => setObjectiveDraft(event.target.value)} maxLength={4000} rows={5} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800" />
                </label>
                {error && <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>}
                <div className="mt-2 flex gap-4 text-xs font-bold"><button type="button" disabled={busy || locked} onClick={() => void saveObjective(work)} className="text-emerald-700 disabled:opacity-40">保存需求</button><button type="button" disabled={busy} onClick={() => setEditingWork(null)} className="text-slate-500">取消</button></div>
              </div></div>}
              <div className="mt-4 flex flex-wrap gap-4 text-xs font-bold">
                <button type="button" onClick={onDiscuss} disabled={locked || Boolean(editingWorkId)} className="inline-flex items-center gap-1 text-emerald-700 disabled:opacity-40">继续讨论 / 修改<ArrowRight size={13} /></button>
                <button type="button" disabled={locked || busy || Boolean(editingWorkId)} onClick={() => { setEditingWork(work); setObjectiveDraft(work.objective || ''); }} className="text-slate-600 disabled:opacity-40">编辑本篇需求</button>
                <button type="button" disabled={locked} onClick={() => setPublishingWork(work)} className="text-slate-600 disabled:opacity-40">设置发布资料</button>
                {article && <button type="button" onClick={() => onOpenFile(article)} className="inline-flex items-center gap-1 text-slate-600"><FileText size={13} />打开正文</button>}
                {details && <button type="button" onClick={() => onOpenFile(details)} className="text-slate-600">发布资料</button>}
              </div>
            </article>
          )}
        </section>
        {publishingWork && <WechatPublishingSettingsDialog spaceId={spaceId} work={publishingWork} files={files} onSave={onSavePublishing} onClose={() => setPublishingWork(null)} />}
      </div>
    </div>
  );
}
