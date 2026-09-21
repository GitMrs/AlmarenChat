'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { assistant as assistantApi } from '@/lib/api';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/utils';
import type { AssistantContextStats, AssistantExperience, AssistantExperienceMessage } from '@/types';

interface AssistantContextModalProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  conversationMode: 'MAIN' | 'TEMPORARY';
  onArchived?: (experience: AssistantExperience) => void;
  onDeleted?: (experienceId: string) => void;
}

export function AssistantContextModal({
  open,
  onClose,
  conversationId,
  conversationMode,
  onArchived,
  onDeleted,
}: AssistantContextModalProps) {
  const [stats, setStats] = useState<AssistantContextStats | null>(null);
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

  const fetchStats = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError('');
    try {
      const data = await assistantApi.getContextStats(conversationId);
      setStats(data);
    } catch (err: any) {
      setError(err.message || '获取上下文统计失败');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (open) {
      setArchiveSuccess('');
      fetchStats();
    }
  }, [open, fetchStats]);

  const handleArchive = async () => {
    if (archiving || !conversationId) return;
    setArchiving(true);
    setError('');
    setArchiveSuccess('');
    try {
      const res = await assistantApi.archiveExperience({
        conversationId,
        preserveRecent,
      });
      setArchiveSuccess(`已成功沉淀 ${res.archivedCount} 条对话为经历记忆，保留最近 ${res.remainingCount} 条活跃上下文！`);
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
        const res = await assistantApi.getExperience(id);
        setExperienceMessages((prev) => ({ ...prev, [id]: res.experience.messages || [] }));
      } catch (err) {
        console.error('Failed to load experience messages:', err);
      } finally {
        setLoadingExperienceId(null);
      }
    }
  };

  const handleDeleteExperience = async () => {
    if (!confirmDeleteId || deleting) return;
    setDeleting(true);
    try {
      await assistantApi.deleteExperience(confirmDeleteId);
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
    ? Math.max(0.1, Math.round(stats.estimatedTokens / 100) / 10)
    : 0;

  const usageRatio = stats && stats.contextLimit > 0
    ? Math.min(1, stats.unarchivedCount / stats.contextLimit)
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
      <section className="relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl">
        {/* Header */}
        <header className="flex h-15 shrink-0 items-center justify-between border-b border-black/[0.06] px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <Brain size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-slate-900">小伴上下文与经历记忆</h2>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-black',
                  conversationMode === 'MAIN' ? 'bg-slate-950 text-white' : 'bg-amber-100 text-amber-800'
                )}>
                  {conversationMode === 'MAIN' ? '主聊天' : '临时聊天'}
                </span>
              </div>
              <p className="text-[11px] font-semibold text-slate-400">实时透明查看上下文负荷，一键沉淀深度记忆</p>
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

          {/* 指标卡片网格 */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className={cn('rounded-xl border p-3 transition', usageColor)}>
              <div className="flex items-center justify-between text-[11px] font-bold">
                <span>活跃对话</span>
                <Activity size={13} />
              </div>
              <div className="mt-1 text-lg font-black tracking-tight">
                {stats ? stats.unarchivedCount : '...'}
                <span className="text-xs font-bold opacity-75"> / {stats ? stats.contextLimit : 40} 条</span>
              </div>
              <div className="mt-0.5 text-[10px] font-semibold opacity-80">
                实时供给模型
              </div>
            </div>

            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-sky-800">
              <div className="flex items-center justify-between text-[11px] font-bold text-sky-700">
                <span>活跃 Tokens</span>
                <Sparkles size={13} />
              </div>
              <div className="mt-1 text-lg font-black tracking-tight text-sky-950">
                ~{stats ? (estimatedKTokens >= 1 ? `${estimatedKTokens}k` : `${stats.estimatedTokens}`) : '...'}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold text-sky-600">
                预估上下文消耗
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-amber-800">
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-700">
                <span>沉淀经历</span>
                <Brain size={13} />
              </div>
              <div className="mt-1 text-lg font-black tracking-tight text-amber-950">
                {stats ? stats.experiencesCount : '...'}
                <span className="text-xs font-bold text-amber-700"> 段</span>
              </div>
              <div className="mt-0.5 text-[10px] font-semibold text-amber-600">
                深度归档摘要
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

          {/* 深度归档沉淀操作卡片 */}
          <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-black text-emerald-900">
                  <Sparkles size={14} className="text-emerald-600" />
                  <span>🌱 沉淀为经历记忆（深度归档）</span>
                </div>
                <p className="mt-1 text-xs font-medium leading-5 text-slate-600">
                  小伴通常在活跃对话达到 64 条时自动归档。点击此处可随时将早期活跃对话浓缩为结构化经历摘要，并保留最近 {preserveRecent} 条近期上下文，瞬间释放模型记忆负荷。
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
                disabled={archiving || !stats?.canArchive}
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
                    <span>立即沉淀经历记忆</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 经历记忆列表 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                <Brain size={14} className="text-amber-600" />
                <span>已沉淀的经历记忆</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {stats?.experiences.length || 0} 段
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-400">
                小伴会在相关话题时自动关联召回
              </span>
            </div>

            {!stats || stats.experiences.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/10 py-8 text-center text-xs font-semibold text-slate-400">
                暂未沉淀经历记忆。当活跃对话增多时，小伴会自动或由你在此一键归档。
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
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => toggleExperienceMessages(exp.id)}
                          title={expandedExperienceId === exp.id ? '收起原文' : '展开原始对话'}
                          className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-800 cursor-pointer"
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
                          title="删除该经历（恢复消息为未归档）"
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
        </div>
      </section>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="移除这段经历记忆？"
        description="移除后该经历摘要将被删除，原有的对话消息将恢复为未归档状态并重新计入活跃上下文。"
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
