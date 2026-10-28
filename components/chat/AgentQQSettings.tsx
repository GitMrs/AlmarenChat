'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { agents as agentsApi } from '@/lib/client/api';
import { cn } from '@/lib/client/utils';
import type { AgentQQBinding } from '@/types';

type Props = {
  open: boolean;
  agentId: string;
  agentName: string;
  onClose: () => void;
};

const STATUS_META: Record<AgentQQBinding['status'], { label: string; className: string; dot: string }> = {
  PENDING: { label: '等待连接', className: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  CONNECTING: { label: '连接中', className: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500 animate-pulse' },
  READY: { label: '已连接', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  ERROR: { label: '连接异常', className: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-500' },
  DISABLED: { label: '已停用', className: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
};

function formatTime(value?: string | null) {
  if (!value) return '暂无';
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return value;
  }
}

export default function AgentQQSettings({ open, agentId, agentName, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [binding, setBinding] = useState<AgentQQBinding | null>(null);
  const [maxBots, setMaxBots] = useState<number | undefined>();
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await agentsApi.getQQBinding(agentId);
      setBinding(result.binding);
      setMaxBots(result.maxBots);
      setAppId(result.binding?.appId || '');
      setAppSecret('');
      setWebhookUrl('');
      setPasswordOpen(false);
      setPassword('');
      setConfirmDelete(false);
    } catch (loadError: any) {
      setError(loadError?.message || '读取 QQ Bot 配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setNotice('');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId]);

  if (!open) return null;

  const status = binding ? STATUS_META[binding.status] : null;

  const save = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setError('请填写 QQ Bot 的 AppID 和 AppSecret');
      return;
    }
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const result = await agentsApi.saveQQBinding(agentId, { appId: appId.trim(), appSecret: appSecret.trim() });
      setBinding(result.binding);
      setAppId(result.binding?.appId || appId.trim());
      setAppSecret('');
      setNotice('已保存，QQ Worker 会自动连接这个 Bot。');
    } catch (saveError: any) {
      setError(saveError?.message || '保存 QQ Bot 配置失败');
    } finally {
      setBusy(null);
    }
  };

  const update = async (data: { enabled?: boolean; action?: string; password?: string }, successMessage: string) => {
    setBusy(data.action || (typeof data.enabled === 'boolean' ? 'toggle' : 'update'));
    setError('');
    setNotice('');
    try {
      const result = await agentsApi.updateQQBinding(agentId, data);
      setBinding(result.binding);
      if (result.webhookUrl) setWebhookUrl(result.webhookUrl);
      if (data.action === 'reveal-webhook') setPasswordOpen(false);
      setNotice(successMessage);
      return result;
    } catch (updateError: any) {
      setError(updateError?.message || '更新 QQ Bot 配置失败');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const revealWebhook = async () => {
    if (!password) {
      setPasswordError('请输入当前账号密码');
      return;
    }
    setPasswordError('');
    const result = await update({ action: 'reveal-webhook', password }, '已显示当前 Webhook 地址。');
    if (result) {
      setPassword('');
    } else {
      setPasswordError('密码校验失败，请重试。');
    }
  };

  const testPush = async () => {
    setBusy('test');
    setError('');
    setNotice('');
    try {
      await agentsApi.testQQBinding(agentId);
      setNotice('测试消息已发送，请到 QQ 私聊中查看。');
    } catch (testError: any) {
      setError(testError?.message || '测试推送失败，请确认 QQ Worker 已启动并完成私聊绑定');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError('');
    setNotice('');
    try {
      await agentsApi.deleteQQBinding(agentId);
      setBinding(null);
      setAppId('');
      setAppSecret('');
      setWebhookUrl('');
      setConfirmDelete(false);
      setNotice('已解除这个 Agent 的 QQ Bot 绑定。');
    } catch (deleteError: any) {
      setError(deleteError?.message || '解除 QQ Bot 绑定失败');
    } finally {
      setBusy(null);
    }
  };

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setNotice('Webhook 地址已复制。');
    } catch {
      setError('复制失败，请手动选择地址复制。');
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-black/[0.06] bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-sm">
              <Bot size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-950">接入 QQ Bot</h2>
              <p className="truncate text-xs font-semibold text-slate-500">{agentName} · QQ 通道</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl bg-[#fbfaf7] px-4 py-10 text-sm font-bold text-slate-500">
              <Loader2 size={18} className="animate-spin" /> 正在读取 QQ Bot 配置…
            </div>
          ) : (
            <>
              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  <AlertCircle size={17} className="mt-0.5 shrink-0" />
                  <span className="break-words">{error}</span>
                </div>
              )}
              {notice && (
                <div role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
                  <span className="break-words">{notice}</span>
                </div>
              )}

              {binding && status && (
                <section className="rounded-2xl border border-black/[0.06] bg-[#fbfaf7] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2.5 w-2.5 rounded-full', status.dot)} />
                      <span className={cn('rounded-full border px-2.5 py-1 text-xs font-black', status.className)}>{status.label}</span>
                      <span className="text-xs font-bold text-slate-500">AppID {binding.appId}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void update({ enabled: !binding.enabled }, binding.enabled ? '已停用这个 QQ Bot。' : '已启用这个 QQ Bot，等待 Worker 连接。')}
                      disabled={busy !== null}
                      className="rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {binding.enabled ? '停用' : '启用'}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-500 sm:grid-cols-2">
                    <p>QQ 接收人：<span className="text-slate-800">{binding.peerBound ? '已绑定' : '等待对方私聊机器人'}</span></p>
                    <p>最近接收：<span className="text-slate-800">{formatTime(binding.lastInboundAt)}</span></p>
                    <p>连接时间：<span className="text-slate-800">{formatTime(binding.connectedAt)}</span></p>
                    <p>Webhook：<span className="text-slate-800">{binding.webhookConfigured ? '已生成' : '未生成'}</span></p>
                  </div>
                  {binding.lastError && (
                    <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-rose-700">{binding.lastError}</p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void testPush()}
                      disabled={busy !== null || !binding.webhookConfigured}
                      className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-40"
                    >
                      {busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      测试推送
                    </button>
                    <button
                      type="button"
                      onClick={() => void update({ action: 'reset-peer' }, '已重置 QQ 接收人，请让对方重新私聊机器人。')}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3.5 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                    >
                      <Unplug size={14} /> 重置接收人
                    </button>
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-black/[0.06] p-4">
                <div className="flex items-center gap-2">
                  <KeyRound size={16} className="text-slate-500" />
                  <h3 className="text-sm font-black text-slate-900">{binding ? '更新 AppID / AppSecret' : '填写 QQ Bot 凭据'}</h3>
                </div>
                <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                  在 QQ 开放平台创建机器人后，把 AppID 和 AppSecret 填到这里。每个 Agent 使用自己的 Bot，消息不会互相串线。
                  {maxBots ? ` 当前每个账号最多接入 ${maxBots} 个 Bot。` : ''}
                </p>
                <div className="mt-3 grid gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-600">AppID</span>
                    <input
                      value={appId}
                      onChange={(event) => setAppId(event.target.value)}
                      placeholder="例如 102012345"
                      autoComplete="off"
                      className="w-full rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-bold text-slate-600">AppSecret</span>
                    <div className="relative">
                      <input
                        value={appSecret}
                        onChange={(event) => setAppSecret(event.target.value)}
                        placeholder={binding ? '如需更新，请重新粘贴 AppSecret' : '粘贴 AppSecret'}
                        type={showSecret ? 'text' : 'password'}
                        autoComplete="new-password"
                        className="w-full rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 pr-11 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret((value) => !value)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label={showSecret ? '隐藏 AppSecret' : '显示 AppSecret'}
                      >
                        {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy !== null}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-sky-700 disabled:opacity-50"
                >
                  {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
                  {binding ? '保存并重新连接' : '保存并接入'}
                </button>
              </section>

              {binding && (
                <section className="rounded-2xl border border-black/[0.06] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-black text-slate-900">Webhook 主动通知</h3>
                      <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                        供外部任务或后续自动化投递主动消息。当前个人助理提醒仍走个人 QQ 通道；QQ 私聊回复不需要 Webhook。
                      </p>
                    </div>
                    {!binding.webhookConfigured && (
                      <button
                        type="button"
                        onClick={() => void update({ action: 'generate-webhook' }, 'Webhook 地址已生成。')}
                        disabled={busy !== null}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-40"
                      >
                        <RefreshCw size={14} /> 生成
                      </button>
                    )}
                  </div>

                  {binding.webhookConfigured && (
                    <>
                      <div className="mt-3 grid gap-1 text-xs font-semibold text-slate-500 sm:grid-cols-2">
                        <p>创建时间：<span className="text-slate-800">{formatTime(binding.webhookCreatedAt)}</span></p>
                        <p>最近使用：<span className="text-slate-800">{formatTime(binding.webhookLastUsedAt)}</span></p>
                      </div>
                      {webhookUrl && (
                        <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#fbfaf7] p-2.5">
                          <code className="min-w-0 flex-1 break-all text-xs leading-5 text-slate-600">{webhookUrl}</code>
                          <button
                            type="button"
                            onClick={() => void copyWebhook()}
                            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-800"
                            aria-label="复制 Webhook"
                          >
                            <Copy size={15} />
                          </button>
                        </div>
                      )}
                      {passwordOpen && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs font-bold text-amber-900">查看 Webhook 需要验证当前账号密码</p>
                          <div className="mt-2 flex gap-2">
                            <input
                              type="password"
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              placeholder="当前账号密码"
                              autoComplete="current-password"
                              className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-amber-400"
                            />
                            <button
                              type="button"
                              onClick={() => void revealWebhook()}
                              disabled={busy !== null}
                              className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                            >
                              查看
                            </button>
                          </div>
                          {passwordError && <p className="mt-1.5 text-xs font-semibold text-rose-600">{passwordError}</p>}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {!webhookUrl && (
                          <button
                            type="button"
                            onClick={() => setPasswordOpen((value) => !value)}
                            className="rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-50"
                          >
                            查看 Webhook
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void update({ action: 'rotate-webhook' }, 'Webhook 地址已轮换，旧地址立即失效。')}
                          disabled={busy !== null}
                          className="rounded-full border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                        >
                          轮换
                        </button>
                        <button
                          type="button"
                          onClick={() => void update({ action: 'revoke-webhook' }, 'Webhook 地址已撤销。')}
                          disabled={busy !== null}
                          className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
                        >
                          撤销
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}

              {binding && (
                <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
                  <h3 className="text-sm font-black text-rose-900">解除绑定</h3>
                  <p className="mt-1 text-xs font-medium leading-5 text-rose-700">
                    解除后，这个 Agent 会停止接收 QQ 消息。已有聊天记录和记忆仍会保留。
                  </p>
                  {confirmDelete ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void remove()}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3.5 py-2 text-xs font-black text-white disabled:opacity-50"
                      >
                        {busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        确认解除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-full border border-rose-200 bg-white px-3.5 py-2 text-xs font-black text-rose-700"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-white px-3.5 py-2 text-xs font-black text-rose-700 transition hover:bg-rose-50"
                    >
                      <Trash2 size={14} /> 解除这个 Agent 的 QQ Bot
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
