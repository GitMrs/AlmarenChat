'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Bot, CheckCircle2, Loader2, Power, Trash2, UserRound, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { agents as agentsApi, assistant, botBindings as botBindingsApi } from '@/lib/client/api';
import type { BotBindingSummary } from '@/types';
import { cn } from '@/lib/client/utils';

function statusInfo(binding: BotBindingSummary) {
  if (!binding.enabled || binding.status === 'DISABLED') {
    return { label: '已停用', className: 'border-slate-200 bg-slate-100 text-slate-500' };
  }
  if (binding.status === 'READY') {
    return { label: '已连接', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  }
  if (binding.status === 'ERROR') {
    return { label: '连接异常', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  }
  if (binding.status === 'CONNECTING') {
    return { label: '连接中', className: 'border-sky-200 bg-sky-50 text-sky-700' };
  }
  return { label: '待连接', className: 'border-indigo-200 bg-indigo-50 text-indigo-700' };
}

export default function BotBindingsManager() {
  const router = useRouter();
  const [bindings, setBindings] = useState<BotBindingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<BotBindingSummary | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await botBindingsApi.list();
      setBindings(result.bindings || []);
    } catch (loadError: any) {
      setError(loadError?.message || '加载 Bot 管理列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (binding: BotBindingSummary) => {
    setBusyId(binding.id);
    setError('');
    try {
      if (binding.kind === 'PERSONAL') {
        await assistant.updateQQBinding({ enabled: !binding.enabled });
      } else if (binding.agentId) {
        await agentsApi.updateQQBinding(binding.agentId, { enabled: !binding.enabled });
      }
      await load();
    } catch (actionError: any) {
      setError(actionError?.message || '更新 Bot 状态失败');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    const binding = pendingDelete;
    setBusyId(binding.id);
    setError('');
    try {
      if (binding.kind === 'PERSONAL') {
        await assistant.deleteQQBinding();
      } else if (binding.agentId) {
        await agentsApi.deleteQQBinding(binding.agentId);
      }
      setPendingDelete(null);
      await load();
    } catch (actionError: any) {
      setError(actionError?.message || '解除 Bot 绑定失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold text-slate-400">消息通道</p>
          <h2 className="text-2xl font-black text-slate-950">Bot 管理</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">查看个人小伴和各个 Agent 已绑定的 Bot 通道。</p>
        </div>
        {!loading && <div className="text-sm font-bold text-slate-400">共 {bindings.length} 个</div>}
      </div>

      {error && <div role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-black/[0.06] bg-white py-20 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : bindings.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-black/[0.1] bg-white px-6 py-16 text-center">
          <Bot size={30} className="mx-auto text-slate-300" />
          <p className="mt-3 text-sm font-black text-slate-600">还没有绑定 Bot</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">可以在个人小伴设置或 Agent 详情中接入 Bot 通道。</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {bindings.map((binding) => {
            const status = statusInfo(binding);
            const busy = busyId === binding.id;
            const isPersonal = binding.kind === 'PERSONAL';
            return (
              <article key={`${binding.kind}:${binding.id}`} className="rounded-[24px] border border-black/[0.07] bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', isPersonal ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-700')}>
                    {isPersonal ? <UserRound size={21} /> : <Bot size={21} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-black text-slate-950">{isPersonal ? '个人小伴' : binding.agentName || binding.agentId}</h3>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-500">QQ</span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold', status.className)}>{status.label}</span>
                    </div>
                    <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                      AppID {binding.appId} · {binding.peerBound ? '已绑定接收人' : '等待 QQ 私聊绑定'}
                    </p>
                    {binding.lastError && <p className="mt-1 truncate text-xs font-semibold text-rose-600">{binding.lastError}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(isPersonal ? '/me?tab=assistant' : `/chat/${encodeURIComponent(binding.agentId || '')}`)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                    >
                      {isPersonal ? '管理小伴' : '查看 Agent'} <ArrowRight size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggle(binding)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : binding.enabled ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                      {binding.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(binding)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                    >
                      <Trash2 size={13} /> 解除
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-black/[0.06] pt-3 text-[11px] font-semibold text-slate-400">
                  <span>{binding.kind === 'PERSONAL' ? '个人小伴通道' : 'Agent 专属通道'}</span>
                  <span>{binding.connectedAt ? `连接于 ${new Date(binding.connectedAt).toLocaleString('zh-CN')}` : '尚未连接'}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="解除这个 Bot 绑定？"
        description={pendingDelete ? `解除后，${pendingDelete.kind === 'PERSONAL' ? '个人小伴' : pendingDelete.agentName || '这个 Agent'} 将停止通过 QQ 接收消息。已有聊天记录和记忆会保留。` : ''}
        confirmText="确认解除"
        cancelText="取消"
        destructive
        loading={Boolean(busyId)}
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      />
    </section>
  );
}
