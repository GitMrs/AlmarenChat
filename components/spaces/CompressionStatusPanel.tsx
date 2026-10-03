'use client';

import { useState } from 'react';
import {
  HardDrive,
  Zap,
  CheckCircle2,
  AlertCircle,
  Activity,
  X,
  Loader2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useContextCompression } from '@/hooks/useContextCompression';
import { spaces as spacesApi } from '@/lib/api';

interface CompressionStatusPanelProps {
  spaceId: string;
  enabled?: boolean;
  refreshKey?: string | number;
  compact?: boolean;
  showMessageCount?: boolean;
}

const THRESHOLD_OPTIONS = [
  { value: 30, label: '30 KB (轻量)' },
  { value: 50, label: '50 KB (推荐)' },
  { value: 100, label: '100 KB (深度)' },
];

export function CompressionStatusPanel({
  spaceId,
  enabled = true,
  refreshKey,
  compact = false,
}: CompressionStatusPanelProps) {
  const [thresholdKB, setThresholdKB] = useState(50);
  const { stats, isLoading, refetch } = useContextCompression({
    spaceId,
    enabled,
    autoRefresh: false,
    refreshKey,
    thresholdKB,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [actionError, setActionError] = useState('');

  if (isLoading && !stats) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <div className="h-4 w-4 animate-pulse rounded-full bg-slate-200" />
        加载上下文容量...
      </div>
    );
  }

  if (!stats) return null;

  const isCompressed = Boolean(stats.isCompressed || stats.checkpoint);
  const usagePercentage = Math.min(100, Math.max(0, stats.usagePercentage ?? 0));
  const isNearLimit = !isCompressed && usagePercentage >= 80;

  const handleCompress = async () => {
    if (compressing) return;
    setCompressing(true);
    setActionError('');
    try {
      await spacesApi.createCheckpoint(spaceId);
      await refetch(thresholdKB);
    } catch (err: any) {
      setActionError(err.message || '压缩归档失败');
    } finally {
      setCompressing(false);
    }
  };

  const handleClearCheckpoint = async () => {
    if (compressing) return;
    if (!window.confirm('确认清除检查点？空间将恢复为常规全量对话模式。')) return;
    setCompressing(true);
    setActionError('');
    try {
      await spacesApi.clearCheckpoint(spaceId);
      await refetch(thresholdKB);
    } catch (err: any) {
      setActionError(err.message || '清除检查点失败');
    } finally {
      setCompressing(false);
    }
  };

  const handleThresholdChange = (newKB: number) => {
    setThresholdKB(newKB);
    void refetch(newKB);
  };

  const renderFullContent = () => (
    <div className="space-y-4">
      {/* 顶部容量状态看板 */}
      <div className={`rounded-xl border p-4 transition-all ${
        isCompressed
          ? 'border-sky-200 bg-sky-50/60'
          : isNearLimit
            ? 'border-amber-200 bg-amber-50/60'
            : 'border-slate-200 bg-slate-50/70'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              isCompressed ? 'bg-sky-500 text-white' : isNearLimit ? 'bg-amber-500 text-white' : 'bg-slate-800 text-white'
            }`}>
              {isCompressed ? <Zap size={16} /> : isNearLimit ? <AlertCircle size={16} /> : <HardDrive size={16} />}
            </div>
            <div>
              <div className="text-xs font-black text-slate-900">
                {isCompressed ? '增量检查点已生效' : isNearLimit ? '即将达到自动压缩阈值' : '上下文容量健康'}
              </div>
              <div className="text-[11px] font-semibold text-slate-500">
                {isCompressed
                  ? `当前活跃 ${stats.formattedActive || '0 KB'} · 原始体积 ${stats.formattedTotal || '0 KB'}`
                  : `当前已用 ${stats.formattedActive || stats.formattedTotal || '0 KB'} / 额度 ${stats.formattedThreshold || '50 KB'}`}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-base font-black ${
              isCompressed ? 'text-sky-700' : isNearLimit ? 'text-amber-700' : 'text-slate-800'
            }`}>
              {isCompressed ? `省 ${stats.formattedSaved}` : `${usagePercentage}%`}
            </div>
            <div className="text-[10px] font-bold text-slate-400">
              {isCompressed ? `已节省 ${stats.reductionPercentage}%` : '使用率'}
            </div>
          </div>
        </div>

        {/* 进度条 */}
        <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-black/10">
          <div
            className={`h-full transition-all duration-300 ${
              isCompressed
                ? 'bg-sky-500'
                : isNearLimit
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.max(4, usagePercentage)}%` }}
          />
        </div>
      </div>

      {/* 说明卡片 */}
      {isCompressed ? (
        <div className="rounded-xl border border-sky-100 bg-white p-3.5 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-sky-800">
            <CheckCircle2 size={14} className="text-sky-600" />
            <span>旧历史已自动浓缩为背景提要</span>
          </div>
          <p className="mt-1.5 leading-5 text-slate-600">
            早期 {stats.archivedMessages || stats.checkpoint?.sourceMessageCount || 0} 条历史对话已沉淀为紧凑前情提要，当前模型仅携带提要与最新的 {stats.activeMessages || 10} 条活跃消息，彻底避免长对话导致的遗忘与高额 Token 消耗。
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Sparkles size={14} className="text-amber-500" />
            <span>自动压缩机制已就绪</span>
          </div>
          <p className="mt-1.5 leading-5 text-slate-600">
            当空间消息累积达到 <b>{thresholdKB} KB</b> 时，系统将自动触发背景摘要归档，无需手动操作。你也可以随时点击下方按钮进行主动压缩。
          </p>
        </div>
      )}

      {/* 拆解指标 */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-black/[0.06] bg-white p-3">
          <div className="text-[11px] font-bold text-slate-400">活跃最新对话</div>
          <div className="mt-1 text-sm font-black text-slate-800">
            {stats.activeMessages ?? stats.messageCount} 条
            <span className="ml-1 text-xs font-semibold text-slate-500">
              ({stats.formattedActive || stats.formattedTotal || '0 KB'})
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-black/[0.06] bg-white p-3">
          <div className="text-[11px] font-bold text-slate-400">归档背景摘要</div>
          <div className="mt-1 text-sm font-black text-slate-800">
            {isCompressed ? (
              <>
                {stats.archivedMessages || stats.checkpoint?.sourceMessageCount || 0} 条
                <span className="ml-1 text-xs font-semibold text-emerald-600">
                  (省 {stats.formattedSaved})
                </span>
              </>
            ) : (
              <span className="text-slate-400 font-semibold">全量保留中</span>
            )}
          </div>
        </div>
      </div>

      {/* 阈值切换 */}
      <div className="rounded-xl border border-black/[0.06] bg-white p-3.5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-slate-700">自动压缩额度</div>
          <div className="text-[11px] font-semibold text-slate-400">到达额度时自动归档</div>
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {THRESHOLD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleThresholdChange(opt.value)}
              className={`rounded-lg py-2 text-center text-xs font-bold transition cursor-pointer ${
                thresholdKB === opt.value
                  ? 'bg-slate-950 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
          {actionError}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleCompress}
          disabled={compressing}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-50 shadow-xs cursor-pointer"
        >
          {compressing ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} className="text-amber-300 fill-amber-300" />}
          {isCompressed ? '重新归档更新检查点' : '立即归档压缩（主动压缩）'}
        </button>

        {isCompressed && (
          <button
            type="button"
            onClick={handleClearCheckpoint}
            disabled={compressing}
            className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 cursor-pointer"
            title="恢复为常规全量对话"
          >
            <RotateCcw size={13} />
            清除检查点
          </button>
        )}

        <button
          type="button"
          onClick={() => void refetch(thresholdKB)}
          disabled={compressing}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          <Activity size={13} />
          刷新
        </button>
      </div>
    </div>
  );

  // 紧凑模式（展示在空间左侧边栏）
  if (compact) {
    return (
      <>
        <div className="px-6 py-2.5">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className={`w-full group flex flex-col gap-1.5 rounded-xl border p-2.5 text-left transition hover:shadow-xs cursor-pointer ${
              isCompressed
                ? 'border-sky-200 bg-sky-50/50 hover:bg-sky-50'
                : isNearLimit
                  ? 'border-amber-200 bg-amber-50/50 hover:bg-amber-50'
                  : 'border-slate-200/80 bg-white hover:bg-slate-50/80'
            }`}
            title="点击查看上下文容量与压缩详情"
          >
            <div className="flex items-center justify-between text-xs">
              <span className={`inline-flex items-center gap-1.5 font-bold ${
                isCompressed ? 'text-sky-700' : isNearLimit ? 'text-amber-700' : 'text-slate-700'
              }`}>
                {isCompressed ? (
                  <>
                    <Zap size={13} className="text-sky-600 fill-sky-600" />
                    已归档压缩
                  </>
                ) : (
                  <>
                    <HardDrive size={13} className={isNearLimit ? 'text-amber-600' : 'text-slate-500'} />
                    上下文容量
                  </>
                )}
              </span>
              <span className={`font-black text-[11px] ${
                isCompressed ? 'text-sky-700' : isNearLimit ? 'text-amber-700' : 'text-slate-500'
              }`}>
                {isCompressed ? `活跃 ${stats.formattedActive}` : `${stats.formattedActive || stats.formattedTotal} (${usagePercentage}%)`}
              </span>
            </div>

            {/* 微型进度条 */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full transition-all duration-300 ${
                  isCompressed
                    ? 'bg-sky-500'
                    : isNearLimit
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.max(4, usagePercentage)}%` }}
              />
            </div>
          </button>
        </div>

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6 animate-in fade-in duration-150">
            <button
              type="button"
              aria-label="关闭"
              className="absolute inset-0 cursor-default"
              onClick={() => setModalOpen(false)}
            />
            <section className="relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl">
              <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.06] px-5">
                <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                  <HardDrive size={16} className="text-slate-700" />
                  空间上下文容量
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  title="关闭"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {renderFullContent()}
              </div>
            </section>
          </div>
        )}
      </>
    );
  }

  return renderFullContent();
}
