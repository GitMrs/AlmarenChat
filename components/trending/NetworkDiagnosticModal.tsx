'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wifi,
  Radio,
  Coins,
  Newspaper,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { NetworkDiagnosticsResult } from '@/lib/network/proxy';

interface NetworkDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NetworkDiagnosticModal({ isOpen, onClose }: NetworkDiagnosticModalProps) {
  const [data, setData] = useState<NetworkDiagnosticsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/system/network-check', {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: NetworkDiagnosticsResult = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || '网络体检请求失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runCheck();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getStatusIcon = (status?: 'ok' | 'degraded' | 'failed') => {
    if (status === 'ok') return <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />;
    if (status === 'degraded') return <AlertTriangle size={16} className="text-amber-500 shrink-0" />;
    return <XCircle size={16} className="text-rose-500 shrink-0" />;
  };

  const getStatusBadge = (status?: 'ok' | 'degraded' | 'failed', latencyMs?: number) => {
    if (status === 'ok') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {latencyMs ? `${latencyMs}ms` : '畅通'}
        </span>
      );
    }
    if (status === 'degraded') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          部分受阻
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
        离线 / 阻断
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 p-6 shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95 transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 to-sky-500 text-white shadow-md shadow-indigo-500/20">
              <Activity size={18} className="animate-pulse" />
            </span>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                全链路网络与代理体检
                {data && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      data.ok
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                    }`}
                  >
                    {data.ok ? '全绿通过' : '建议关注'}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                双轨智能探测：本地代理 · 微软语音 · OKX/Web3 · 国内热搜
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Diagnostic Items */}
        <div className="my-5 space-y-3">
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-500">
              <RefreshCw size={24} className="animate-spin text-indigo-500 mb-2" />
              <p className="text-xs font-semibold">正在并发探测全链路连通性...</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          ) : data ? (
            <>
              {/* 1. 本地代理中枢 */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800/60 dark:bg-slate-800/40">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                    <Wifi size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {data.services.proxy.name}
                      </span>
                      {getStatusIcon(data.services.proxy.status)}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {data.services.proxy.message}
                    </p>
                  </div>
                </div>
                {getStatusBadge(data.services.proxy.status, data.services.proxy.latencyMs)}
              </div>

              {/* 2. 微软 Edge TTS 语音服务 */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800/60 dark:bg-slate-800/40">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                    <Radio size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {data.services.tts.name}
                      </span>
                      {getStatusIcon(data.services.tts.status)}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {data.services.tts.message}
                    </p>
                  </div>
                </div>
                {getStatusBadge(data.services.tts.status, data.services.tts.latencyMs)}
              </div>

              {/* 3. OKX / 加密 Web3 数据源 */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800/60 dark:bg-slate-800/40">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
                    <Coins size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {data.services.web3.name}
                      </span>
                      {getStatusIcon(data.services.web3.status)}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {data.services.web3.message}
                    </p>
                  </div>
                </div>
                {getStatusBadge(data.services.web3.status, data.services.web3.latencyMs)}
              </div>

              {/* 4. 国内主流热搜源 (百度/知乎) */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800/60 dark:bg-slate-800/40">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                    <Newspaper size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {data.services.domestic.name}
                      </span>
                      {getStatusIcon(data.services.domestic.status)}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {data.services.domestic.message}
                    </p>
                  </div>
                </div>
                {getStatusBadge(data.services.domestic.status, data.services.domestic.latencyMs)}
              </div>
            </>
          ) : null}
        </div>

        {/* Intelligent Recommendation */}
        {data && (
          <div
            className={`mb-5 rounded-2xl p-3.5 text-xs font-medium border ${
              data.ok
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300'
            }`}
          >
            <div className="flex items-start gap-2">
              <Zap size={14} className="shrink-0 mt-0.5" />
              <div>{data.recommendation}</div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-slate-400">
            {data?.timestamp ? `最近检测：${new Date(data.timestamp).toLocaleTimeString()}` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={runCheck}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-indigo-500' : ''} />
              <span>{loading ? '测速中...' : '重新检测'}</span>
            </button>
            <button
              onClick={onClose}
              className="rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
