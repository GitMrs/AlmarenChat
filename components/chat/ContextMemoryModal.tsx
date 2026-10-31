'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import {
  Brain,
  Sparkles,
  Layers,
  Activity,
  CheckCircle2,
  ChevronDown,
  Trash2,
  Loader2,
  X,
  Clock,
  MessageSquare,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/client/utils';
import type { ChatContextStats, AssistantExperience, AssistantExperienceMessage } from '@/types';

export interface ContextMemorySource {
  getStats: (conversationId: string) => Promise<ChatContextStats>;
  archive: (data: { conversationId: string; preserveRecent: number }) => Promise<{ experience?: AssistantExperience; archivedCount: number; remainingCount: number }>;
  getExperience: (id: string, conversationId: string) => Promise<{ experience: { messages?: AssistantExperienceMessage[] } }>;
  removeExperience: (id: string) => Promise<unknown>;
}

interface ContextMemoryModalProps {
  source: ContextMemorySource;
  subject: string;
  variant?: 'assistant' | 'agent';
  settings?: ReactNode;
  open: boolean;
  onClose: () => void;
  conversationId: string;
  conversationMode: 'MAIN' | 'TEMPORARY';
  onArchived?: (experience: AssistantExperience) => void;
  onDeleted?: (experienceId: string) => void;
}

export function ContextMemoryModal({
  source,
  subject,
  variant = 'assistant',
  settings,
  open,
  onClose,
  conversationId,
  conversationMode,
  onArchived,
  onDeleted,
}: ContextMemoryModalProps) {
  const [stats, setStats] = useState<ChatContextStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [archiveSuccess, setArchiveSuccess] = useState('');
  const [preserveRecent, setPreserveRecent] = useState(4);
  const [expandedExperienceId, setExpandedExperienceId] = useState<string | null>(null);
  const [experienceMessages, setExperienceMessages] = useState<Record<string, AssistantExperienceMessage[]>>({});
  const [loadingExperienceId, setLoadingExperienceId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const requestVersion = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const isAgent = variant === 'agent';
  const memoryLabel = isAgent ? '对话归档' : '经历记忆';

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => { previousFocus?.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmDeleteId && !archiving && !deleting) onClose();
      if (event.key === 'Tab' && !confirmDeleteId) {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]');
        const first = controls?.[0];
        const last = controls?.[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); };
  }, [open, onClose, confirmDeleteId, archiving, deleting]);

  const fetchStats = useCallback(async () => {
    if (!conversationId) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setStats(null);
    setError('');
    try {
      const data = await source.getStats(conversationId);
      if (version === requestVersion.current) setStats(data);
    } catch (err: any) {
      if (version === requestVersion.current) setError(err.message || '获取上下文统计失败');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [conversationId, source]);

  useEffect(() => {
    if (open) {
      setArchiveSuccess('');
      setExpandedExperienceId(null);
      setExperienceMessages({});
      fetchStats();
    }
    return () => { requestVersion.current += 1; };
  }, [open, fetchStats]);

  const handleArchive = async () => {
    if (archiving || !conversationId) return;
    setArchiving(true);
    setError('');
    setArchiveSuccess('');
    try {
      const res = await source.archive({
        conversationId,
        preserveRecent,
      });
      setArchiveSuccess(`已归档 ${res.archivedCount} 条对话，剩余 ${res.remainingCount} 条未归档原文。`);
      await fetchStats();
      if (res.experience) {
        onArchived?.(res.experience);
      }
    } catch (err: any) {
      setError(err.message || '沉淀经历记忆失败');
    } finally {
      setArchiving(false);
    }
  };

  const toggleExperienceMessages = async (id: string) => {
    if (expandedExperienceId === id) {
      setExpandedExperienceId(null);
      return;
    }
    setExpandedExperienceId(id);
    if (!experienceMessages[id]) {
      setLoadingExperienceId(id);
      try {
        const res = await source.getExperience(id, conversationId);
        setExperienceMessages((prev) => ({ ...prev, [id]: res.experience.messages || [] }));
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取归档原文失败');
      } finally {
        setLoadingExperienceId(null);
      }
    }
  };

  const handleDeleteExperience = async () => {
    if (!confirmDeleteId || deleting) return;
    setDeleting(true);
    try {
      await source.removeExperience(confirmDeleteId);
      const deletedId = confirmDeleteId;
      setConfirmDeleteId(null);
      await fetchStats();
      onDeleted?.(deletedId);
    } catch (err: any) {
      setError(err.message || '删除经历记忆失败');
    } finally {
      setDeleting(false);
    }
  };

  if (!open) return null;

  const estimatedKTokens = stats
    ? Math.max(0.1, Math.round((stats.recentContextTokens ?? stats.estimatedTokens) / 100) / 10)
    : 0;

  const usageRatio = conversationMode === 'MAIN' && stats && stats.archiveTrigger > 0
    ? Math.min(1, stats.unarchivedCount / stats.archiveTrigger)
    : 0;

  const usageColor =
    usageRatio > 0.75
      ? 'text-rose-600 bg-rose-50 border-rose-200'
      : usageRatio > 0.45
        ? 'text-amber-600 bg-amber-50 border-amber-200'
        : 'text-emerald-600 bg-emerald-50 border-emerald-200';

  return (
    <div className="fixed inset-0 z-70 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4 animate-in fade-in duration-150">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${subject}上下文与${memoryLabel}`} className="relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:max-w-xl sm:rounded-2xl">
        {/* Header */}
        <header className="flex h-15 shrink-0 items-center justify-between border-b border-black/[0.06] px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <Brain size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-slate-900">{subject}上下文与{memoryLabel}</h2>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-black',
                  conversationMode === 'MAIN' ? 'bg-slate-950 text-white' : 'bg-amber-100 text-amber-800'
                )}>
                  {conversationMode === 'MAIN' ? '主聊天' : '临时聊天'}
                </span>
              </div>
              <p className="text-[11px] font-semibold text-slate-400">查看近期上下文与历史对话归档</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={fetchStats}
              disabled={loading}
              title="刷新统计"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
            >
              <RefreshCw size={15} className={cn(loading && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="关闭"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {archiveSuccess && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 animate-in fade-in">
              <CheckCircle2 size={15} className="shrink-0" />
              <span>{archiveSuccess}</span>
            </div>
          )}

          {settings}
          <p className="text-xs leading-5 text-slate-500">近期原文上限为 {stats?.contextLimit ?? '…'} 条历史消息（当前输入另计，不是对话轮数）。归档只建立历史索引，不会直接把原文从近期窗口排除。</p>
          {conversationId && <>
          {/* 指标卡片网格 */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className={cn('rounded-xl border p-3 transition', usageColor)}>
              <div className="flex items-center justify-between text-[11px] font-bold">
                <span>未归档对话</span>
                <Activity size={13} />
              </div>
              <div className="mt-1 text-lg font-black tracking-tight">
                {stats ? stats.unarchivedCount : '...'}
                <span className="text-xs font-bold opacity-75">{conversationMode === 'MAIN' && stats ? ` / ${stats.archiveTrigger}` : ''} 条</span>
              </div>
              <div className="mt-0.5 text-[10px] font-semibold opacity-80">
                {conversationMode === 'MAIN' ? '自动归档进度' : '当前未归档消息'}
              </div>
            </div>

            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-sky-800">
              <div className="flex items-center justify-between text-[11px] font-bold text-sky-700">
                <span>近期原文候选 Tokens</span>
                <Sparkles size={13} />
              </div>
              <div className="mt-1 text-lg font-black tracking-tight text-sky-950">
                ~{stats ? (estimatedKTokens >= 1 ? `${estimatedKTokens}k` : `${stats.recentContextTokens ?? stats.estimatedTokens}`) : '...'}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold text-sky-600">
                {`最近 ${stats?.recentContextCount ?? '…'} 条原文估算，实际使用见下方请求记录`}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-amber-800">
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-700">
                <span>{isAgent ? '对话归档' : '沉淀经历'}</span>
                <Brain size={13} />
              </div>
              <div className="mt-1 text-lg font-black tracking-tight text-amber-950">
                {stats ? stats.experiencesCount : '...'}
                <span className="text-xs font-bold text-amber-700"> 段</span>
              </div>
              <div className="mt-0.5 text-[10px] font-semibold text-amber-600">
                {isAgent ? '当前会话的对话归档' : '深度归档摘要'}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-700">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
                <span>历史总数</span>
                <Layers size={13} />
              </div>
              <div className="mt-1 text-lg font-black tracking-tight text-slate-900">
                {stats ? stats.totalCount : '...'}
                <span className="text-xs font-bold text-slate-500"> 条</span>
              </div>
              <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
                含已归档消息
              </div>
            </div>
          </div>

          <p className="text-xs leading-5 text-slate-500">
            模型最多读取最近 {stats ? stats.contextLimit : '…'} 条未归档原文，仍受 Token 预算限制；主会话另会按相关性使用历史记忆。Token 统计不含设定、额外记忆、知识检索和思考内容。
          </p>

          {/* 深度归档沉淀操作卡片 */}
          <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-black text-emerald-900">
                  <Sparkles size={14} className="text-emerald-600" />
                  <span>{isAgent ? '整理早期对话' : '🌱 沉淀为经历记忆（深度归档）'}</span>
                </div>
                <p className="mt-1 text-xs font-medium leading-5 text-slate-600">
                  {conversationMode === 'MAIN'
                    ? `主会话在未归档对话达到 ${stats ? stats.archiveTrigger : '…'} 条时，于后续请求中自动分批归档早期消息，至少保留最近 ${stats ? stats.autoPreserveRecent : '…'} 条未归档原文。`
                    : isAgent ? '临时聊天不写入 Agent 的长期对话归档。' : '临时会话不自动沉淀经历。'}
                  {(!isAgent || conversationMode === 'MAIN') && <>手动归档每次整理一批早期对话，至少保留最近 {preserveRecent} 条未归档原文；剩余早期消息可继续归档，原始聊天记录不删除。</>}
                </p>
              </div>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-100/80 pt-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <span>保留最近对话：</span>
                <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold">
                  {[2, 4, 6, 8].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setPreserveRecent(num)}
                      disabled={archiving || (isAgent && conversationMode !== 'MAIN')}
                      className={cn(
                        'rounded-md px-2 py-0.5 transition cursor-pointer',
                        preserveRecent === num
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      {num} 条
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleArchive}
                disabled={archiving || loading || !stats?.canArchive || stats.unarchivedCount <= preserveRecent || (isAgent && conversationMode !== 'MAIN')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-black transition cursor-pointer shadow-xs',
                  stats?.canArchive
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                )}
                title={stats?.canArchive ? '立即浓缩早期对话' : '活跃对话少于阈值，无需归档'}
              >
                {archiving ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>正在提炼并沉淀...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={13} />
                    <span>{isAgent ? '立即归档' : '立即沉淀经历记忆'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {stats?.lastRequest && (
            <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs leading-6 text-sky-950">
              <div className="font-bold">最近一次上下文拼装（Token 为估算）</div>
              <div>输入约 {stats.lastRequest.estimatedInputTokens} Tokens；窗口输入上限 {stats.lastRequest.hardInputBudget}；回复预留 {stats.lastRequest.replyReserve}。</div>
              <div>近期原文 {stats.lastRequest.recentCount} 条；会话摘要承接 {stats.lastRequest.summarySourceCount} 条。</div>
              <div>已加入：{stats.lastRequest.included?.join('、') || '无额外历史资料'}。</div>
              {!!stats.lastRequest.omitted?.length && <div>因预算未加入：{stats.lastRequest.omitted.join('、')}。</div>}
              <div>记录时间：{new Date(stats.lastRequest.capturedAt).toLocaleString()}。{stats.lastRequest.phase === 'prepared' ? '准备记录不表示模型已接收。' : '模型请求阶段记录，不代表回复已完成。'}</div>
            </section>
          )}
          {stats?.workingSummary?.text && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950">
              <div className="font-bold">当前会话承接记录（与历史经历归档分别管理）</div>
              <div className="mt-1">承接 {stats.workingSummary.sourceCount} 条（表示处理范围，不保证保留全部细节），边界：{stats.workingSummary.throughCreatedAt ? new Date(stats.workingSummary.throughCreatedAt).toLocaleString() : '未记录'}。</div>
              <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap font-sans leading-6">{stats.workingSummary.text}</pre>
            </section>
          )}
          {stats?.memoryContext !== undefined && (
            <details className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600">
              <summary className="cursor-pointer font-bold">记忆召回预览</summary>
              <p className="mt-2 leading-5 text-slate-400">根据最近一句提问预览；实际发送时会按新问题重新检索。知识笔记在知识库中管理。</p>
              <div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap leading-6">{stats.memoryContext || (conversationMode === 'MAIN' ? '本次预览没有召回长期记忆。' : '临时聊天不使用个人记忆与历史经历。')}</div>
            </details>
          )}
          {/* 经历记忆列表 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                <Brain size={14} className="text-amber-600" />
                <span>{isAgent ? '当前会话的对话归档' : '已沉淀的经历记忆'}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {stats?.experiences.length || 0} 段
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-400">
                {subject}会在相关话题时关联召回
              </span>
            </div>

            {!stats || stats.experiences.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/10 py-8 text-center text-xs font-semibold text-slate-400">
                {isAgent ? '当前会话暂无对话归档。' : '暂未沉淀经历记忆。当活跃对话增多时，小伴会自动或由你在此一键归档。'}
              </div>
            ) : (
              <div className="space-y-2.5">
                {stats.experiences.map((exp) => (
                  <div
                    key={exp.id}
                    className="rounded-xl border border-black/[0.06] bg-slate-50/50 p-3.5 transition hover:border-black/10"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                        <span className="flex items-center gap-1 text-slate-500">
                          <Clock size={12} />
                          {new Date(exp.startAt).toLocaleDateString('zh-CN')} 至 {new Date(exp.endAt).toLocaleDateString('zh-CN')}
                        </span>
                        <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                          {exp.messageCount} 条原始对话
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleExperienceMessages(exp.id)}
                          title={expandedExperienceId === exp.id ? '收起原文' : '展开原始对话'}
                          className="flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[11px] font-bold text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-800 cursor-pointer"
                        >
                          <MessageSquare size={12} />
                          <span>{expandedExperienceId === exp.id ? '收起' : '原文'}</span>
                          {loadingExperienceId === exp.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <ChevronDown
                              size={12}
                              className={cn('transition-transform', expandedExperienceId === exp.id && 'rotate-180')}
                            />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(exp.id)}
                          title={isAgent ? '遗忘这条归档（保留原始聊天）' : '删除该经历（恢复消息为未归档）'}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <p className="mt-2 whitespace-pre-wrap text-xs font-medium leading-relaxed text-slate-700">
                      {exp.summary}
                    </p>

                    {expandedExperienceId === exp.id && experienceMessages[exp.id] && (
                      <div className="mt-3 max-h-60 space-y-2 overflow-y-auto rounded-lg border border-slate-200/80 bg-white p-3">
                        {experienceMessages[exp.id].map((msg) => (
                          <div key={msg.id} className="text-xs">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                              <span className={cn(
                                'rounded px-1 py-0.2',
                                msg.role === 'user' ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-800'
                              )}>
                                {msg.role === 'user' ? '用户' : '助理'}
                              </span>
                              <span>{new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <p className="mt-0.5 whitespace-pre-wrap text-xs font-medium text-slate-600 leading-5">
                              {msg.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          </>}
        </div>
      </section>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title={`移除这段${memoryLabel}？`}
        description={isAgent ? '移除后这条归档不再参与回忆，原始聊天保留；自动归档不会重新创建它。' : '移除后该经历摘要将被删除，原有的对话消息将恢复为未归档状态并重新计入活跃上下文。'}
        icon={<Trash2 size={20} />}
        confirmText="确认删除"
        cancelText="保留"
        destructive
        loading={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDeleteId(null);
        }}
        onConfirm={handleDeleteExperience}
      />
    </div>
  );
}
