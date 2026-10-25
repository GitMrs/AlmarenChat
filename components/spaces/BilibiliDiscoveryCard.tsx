'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Play, RefreshCw, Share2, Sparkles } from 'lucide-react';
import { spaces as spacesApi } from '@/lib/client/api';
import {
  BILIBILI_AUTOMATION_TEMPLATES,
  BILIBILI_DISCOVERY_MARKER,
  BILIBILI_DISCOVERY_TEMPLATE_ID,
} from '@/lib/space/bilibili-automation-templates';
import type { SpaceAutomation, SpaceWebhook } from '@/types';

type ShareTarget = 'NONE' | 'PERSONAL_QQ' | 'CUSTOM_WEBHOOK';

function formatDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function executionLabel(automation: SpaceAutomation | null) {
  const execution = automation?.executions?.[0];
  if (!execution) return automation?.enabled ? '等待第一次运行' : '还没跑过';
  if (execution.status === 'TRIGGERED') return '正在发现';
  if (execution.status === 'COMPLETED') return `上次完成 · ${formatDateTime(execution.updatedAt)}`;
  if (execution.status === 'FAILED' || execution.status === 'FAILED_VALIDATION') {
    return `上次失败 · ${formatDateTime(execution.updatedAt)}`;
  }
  return `上次 ${execution.status} · ${formatDateTime(execution.updatedAt)}`;
}

export default function BilibiliDiscoveryCard({ spaceId }: { spaceId: string }) {
  const template = useMemo(
    () => BILIBILI_AUTOMATION_TEMPLATES.find((item) => item.id === BILIBILI_DISCOVERY_TEMPLATE_ID),
    []
  );
  const [automation, setAutomation] = useState<SpaceAutomation | null>(null);
  const [webhooks, setWebhooks] = useState<SpaceWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shareTarget, setShareTarget] = useState<ShareTarget>('NONE');
  const [webhookId, setWebhookId] = useState('');

  const applyAutomation = useCallback((next: SpaceAutomation | null) => {
    setAutomation(next);
    if (!next) {
      setShareTarget('NONE');
      setWebhookId('');
      return;
    }
    const target =
      next.completionAction === 'WEBHOOK_NOTIFY'
        ? next.completionConfig?.target === 'CUSTOM_WEBHOOK'
          ? 'CUSTOM_WEBHOOK'
          : 'PERSONAL_QQ'
        : 'NONE';
    setShareTarget(target);
    setWebhookId(next.completionConfig?.webhookId || '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [automationResult, webhookResult] = await Promise.all([
        spacesApi.automations(spaceId),
        spacesApi.webhooks(spaceId).catch(() => ({ webhooks: [] as SpaceWebhook[] })),
      ]);
      const found =
        automationResult.automations.find(
          (item) => item.prompt.includes(BILIBILI_DISCOVERY_MARKER) || item.name === template?.name
        ) || null;
      applyAutomation(found);
      const currentWebhookId = found?.completionConfig?.webhookId;
      setWebhooks(
        (webhookResult.webhooks || []).filter((item) => item.enabled || item.id === currentWebhookId)
      );
    } catch (err: any) {
      setError(err?.message || '读取发现机器人状态失败');
    } finally {
      setLoading(false);
    }
  }, [applyAutomation, spaceId, template?.name]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildCompletion = useCallback((target: ShareTarget, selectedWebhookId: string) => {
    if (target === 'NONE') {
      return { completionAction: 'NONE' as const, completionConfig: null };
    }
    if (target === 'PERSONAL_QQ') {
      return {
        completionAction: 'WEBHOOK_NOTIFY' as const,
        completionConfig: { target: 'PERSONAL_QQ' as const },
      };
    }
    return {
      completionAction: 'WEBHOOK_NOTIFY' as const,
      completionConfig: { target: 'CUSTOM_WEBHOOK' as const, webhookId: selectedWebhookId },
    };
  }, []);

  const create = useCallback(
    async (enabled: boolean, target: ShareTarget, selectedWebhookId: string) => {
      if (!template) throw new Error('发现机器人模板不存在');
      if (target === 'CUSTOM_WEBHOOK' && !selectedWebhookId) {
        throw new Error('请先选择一个自定义 Webhook');
      }
      const completion = buildCompletion(target, selectedWebhookId);
      const result = await spacesApi.createAutomation(spaceId, {
        name: template.name,
        prompt: template.prompt,
        scheduleType: 'DAILY',
        intervalMinutes: 1440,
        timeZone: 'Asia/Shanghai',
        scheduleHour: template.scheduleHour ?? 9,
        scheduleMinute: template.scheduleMinute ?? 0,
        workStrategy: template.workStrategy,
        executionMode: 'PROMPT',
        networkPolicy: template.networkPolicy,
        ...completion,
        enabled,
      });
      applyAutomation(result.automation);
      return result.automation;
    },
    [applyAutomation, buildCompletion, spaceId, template]
  );

  const enabled = Boolean(automation?.enabled);
  const selectedWebhook = webhooks.find((webhook) => webhook.id === webhookId);
  const shareTargetReady = shareTarget !== 'CUSTOM_WEBHOOK' || Boolean(selectedWebhook?.enabled);
  const scheduleText = !automation
    ? '每天 09:00'
    : automation.scheduleType === 'DAILY'
      ? `每天 ${String(automation.scheduleHour ?? 9).padStart(2, '0')}:${String(automation.scheduleMinute ?? 0).padStart(2, '0')}`
      : automation.scheduleType === 'WEEKLY'
        ? '每周'
        : '按计划';
  const switchDisabled = busy || loading || !template || (!enabled && !shareTargetReady);

  const toggle = async () => {
    if (busy || loading) return;
    if (!automation?.enabled && shareTarget === 'CUSTOM_WEBHOOK' && !selectedWebhook?.enabled) {
      setError('请先选择一个已启用的 Webhook');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!automation) {
        await create(true, shareTarget, webhookId);
        setNotice(`已开启。${scheduleText}会自动去 B 站找好玩的。`);
      } else {
        const result = await spacesApi.updateAutomation(spaceId, automation.id, {
          enabled: !automation.enabled,
        });
        applyAutomation(result.automation);
        setNotice(result.automation.enabled ? '已开启，会按计划主动发现。' : '已关闭，不会主动发现。');
      }
    } catch (err: any) {
      setError(err?.message || '更新发现机器人失败');
    } finally {
      setBusy(false);
    }
  };

  const changeShareTarget = async (next: ShareTarget) => {
    setShareTarget(next);
    setError('');
    setNotice('');
    if (next !== 'CUSTOM_WEBHOOK') setWebhookId('');
    if (!automation) return;
    if (next === 'CUSTOM_WEBHOOK' && !webhookId) return;
    setBusy(true);
    try {
      const completion = buildCompletion(next, webhookId);
      const result = await spacesApi.updateAutomation(spaceId, automation.id, completion);
      applyAutomation(result.automation);
      setNotice(next === 'NONE' ? '已改为只在空间记录，不外发。' : '分享目标已更新。');
    } catch (err: any) {
      setError(err?.message || '更新分享目标失败');
    } finally {
      setBusy(false);
    }
  };

  const changeWebhook = async (nextId: string) => {
    setWebhookId(nextId);
    if (!automation || shareTarget !== 'CUSTOM_WEBHOOK' || !nextId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await spacesApi.updateAutomation(spaceId, automation.id, {
        completionAction: 'WEBHOOK_NOTIFY',
        completionConfig: { target: 'CUSTOM_WEBHOOK', webhookId: nextId },
      });
      applyAutomation(result.automation);
      setNotice('分享目标已更新。');
    } catch (err: any) {
      setError(err?.message || '更新 Webhook 失败');
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (busy || loading) return;
    if (shareTarget === 'CUSTOM_WEBHOOK' && !selectedWebhook?.enabled) {
      setError('请先选择一个已启用的 Webhook');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const targetAutomation = automation || (await create(true, shareTarget, webhookId));
      await spacesApi.triggerAutomation(spaceId, targetAutomation.id);
      setNotice('已排队，稍后会在空间里看到发现结果。');
      window.setTimeout(() => void load(), 1500);
    } catch (err: any) {
      setError(err?.message || '启动发现失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Sparkles size={17} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-black text-slate-950">发现机器人</h3>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">Beta</span>
              <span className={`text-[10px] font-black ${enabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                {enabled ? '已开启' : '已关闭'}
              </span>
            </div>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
              开启后{scheduleText}去 B 站找 3 条好玩的，并记住它们。没指定分享目标时只在空间留记录，不外发。
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? '关闭发现机器人' : '开启发现机器人'}
          onClick={() => void toggle()}
          disabled={switchDisabled}
          className={`relative mt-1 h-6 w-10 shrink-0 rounded-full transition ${
            enabled ? 'bg-emerald-500' : 'bg-slate-200'
          } disabled:opacity-50`}
        >
          <span
            className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${
              enabled ? 'left-5' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-400">
            <Share2 size={12} /> 分享目标
          </span>
          <select
            value={shareTarget}
            onChange={(event) => void changeShareTarget(event.target.value as ShareTarget)}
            disabled={busy || loading}
            className="mt-1 h-9 w-full rounded-lg border border-black/[0.08] bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 disabled:opacity-50"
          >
            <option value="NONE">不分享（只记在空间）</option>
            <option value="PERSONAL_QQ">个人 QQ（需已绑定）</option>
            <option value="CUSTOM_WEBHOOK">自定义 Webhook</option>
          </select>
        </label>

        {shareTarget === 'CUSTOM_WEBHOOK' ? (
          <label className="block">
            <span className="text-[11px] font-black text-slate-400">Webhook</span>
            <select
              value={webhookId}
              onChange={(event) => void changeWebhook(event.target.value)}
              disabled={busy || loading}
              className="mt-1 h-9 w-full rounded-lg border border-black/[0.08] bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-slate-400 disabled:opacity-50"
            >
              <option value="">选择已启用的 Webhook</option>
              {webhooks.map((webhook) => (
                <option key={webhook.id} value={webhook.id}>
                  {webhook.name}{webhook.enabled ? '' : '（已停用）'}
                </option>
              ))}
            </select>
            {webhooks.length === 0 ? (
              <span className="mt-1 block text-[10px] font-semibold text-amber-600">
                还没有启用的 Webhook，可先在空间设置里添加。
              </span>
            ) : !webhookId ? (
              <span className="mt-1 block text-[10px] font-semibold text-amber-600">
                选择 Webhook 后才能开启或立即发现。
              </span>
            ) : !selectedWebhook?.enabled ? (
              <span className="mt-1 block text-[10px] font-semibold text-amber-600">
                当前 Webhook 已停用，请换一个。
              </span>
            ) : null}
          </label>
        ) : (
          <div className="rounded-lg bg-[#fbfaf7] px-3 py-2 text-[11px] font-semibold leading-5 text-slate-400">
            {shareTarget === 'NONE'
              ? '发现结果只写进空间和 bilibili-finds.md，不会推送到外部。'
              : '会推送到个人 QQ；需要先在空间里绑定 QQ 助手。'}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runNow()}
          disabled={busy || loading || !template || !shareTargetReady}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} 立即发现
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy || loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-black text-slate-500 transition hover:border-slate-300 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 刷新状态
        </button>
        <span className="text-[11px] font-semibold text-slate-400">{executionLabel(automation)}</span>
      </div>

      {automation?.lastError ? (
        <div className="mt-2 text-[11px] font-semibold leading-5 text-rose-500">
          上次错误：{String(automation.lastError).slice(0, 180)}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          <Check size={14} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}
    </section>
  );
}
