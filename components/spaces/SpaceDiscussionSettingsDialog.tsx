'use client';

import React, { useState } from 'react';
import {
  SlidersHorizontal,
  X,
  Loader2,
  Check,
  MessagesSquare,
  Sparkles,
  AtSign,
  Coffee,
  HelpCircle,
} from 'lucide-react';
import type { SpaceDiscussionSettings } from '@/types';
import { DEFAULT_SPACE_DISCUSSION_SETTINGS } from '@/types';

interface SpaceDiscussionSettingsDialogProps {
  open: boolean;
  settings?: SpaceDiscussionSettings | null;
  onClose: () => void;
  onSave: (settings: SpaceDiscussionSettings) => Promise<void>;
}

export default function SpaceDiscussionSettingsDialog({
  open,
  settings,
  onClose,
  onSave,
}: SpaceDiscussionSettingsDialogProps) {
  const initial = settings || DEFAULT_SPACE_DISCUSSION_SETTINGS;
  const [botChainLimit, setBotChainLimit] = useState<number>(initial.botChainLimit ?? 3);
  const [autoBotChat, setAutoBotChat] = useState<boolean>(initial.autoBotChat ?? true);
  const [botAtMentionTriggersReply, setBotAtMentionTriggersReply] = useState<boolean>(initial.botAtMentionTriggersReply ?? true);
  const [idleTalk, setIdleTalk] = useState<boolean>(initial.idleTalk ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        botChainLimit,
        autoBotChat,
        botAtMentionTriggersReply,
        idleTalk,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || '保存设置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 p-0 sm:items-center sm:p-6">
      <button type="button" aria-label="关闭" className="absolute inset-0" onClick={onClose} />
      <section className="relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-lg bg-white shadow-2xl sm:max-w-lg sm:rounded-lg">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.06] px-5">
          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
            <SlidersHorizontal size={17} className="text-slate-700" />
            讨论与互动规则
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition"
          >
            <X size={18} />
          </button>
        </header>

        {/* Content */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 text-left">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}

          {/* 1. 连续互聊上限 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                <MessagesSquare size={14} className="text-slate-500" />
                AI 连续互聊上限 (轮数)
              </span>
              <span className="text-xs font-bold text-slate-500">
                当前: <span className="text-slate-950 font-black">{botChainLimit} 轮</span>
              </span>
            </div>
            <p className="mb-3 text-[11px] font-medium leading-4 text-slate-400">
              群聊或讨论中，多 AI 连续交接达该轮数后，最后一位发言者将主动总结要点并归还发言权，避免无限刷屏。
            </p>
            <div className="grid grid-cols-6 gap-1.5 rounded-lg border border-black/[0.08] bg-[#fbfaf7] p-1">
              {[1, 2, 3, 4, 5, 6].map((num) => {
                const isSelected = botChainLimit === num;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setBotChainLimit(num)}
                    className={`relative flex h-10 flex-col items-center justify-center rounded-md text-xs font-black transition ${
                      isSelected
                        ? 'bg-slate-950 text-white shadow-sm'
                        : 'text-slate-500 hover:bg-white hover:text-slate-900'
                    }`}
                  >
                    <span>{num} 轮</span>
                    {num === 3 && (
                      <span className={`text-[9px] font-semibold leading-none ${isSelected ? 'text-amber-300' : 'text-slate-400'}`}>
                        推荐
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. 交互功能开关列表 */}
          <div className="space-y-4 rounded-lg border border-black/[0.08] bg-[#fbfaf7] p-4">
            {/* 自动接话 */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                  <Sparkles size={14} className="text-amber-600" />
                  允许 AI 自动接话与互动
                </div>
                <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-400">
                  开启后，多成员群聊中成员可根据语境自主参与对话；关闭后仅响应用户明确 @ 或直接指定。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoBotChat}
                onClick={() => setAutoBotChat(!autoBotChat)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  autoBotChat ? 'bg-slate-950' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    autoBotChat ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="border-t border-black/[0.05]" />

            {/* 伙伴 @ 提及触发接话 */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                  <AtSign size={14} className="text-sky-600" />
                  伙伴 @ 提及触发接话 (Mention Relay)
                </div>
                <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-400">
                  当某位成员在发言中 @ 空间内其他伙伴时，自动触发被提及伙伴接力发言（受互聊轮数上限约束）。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={botAtMentionTriggersReply}
                disabled={!autoBotChat}
                onClick={() => setBotAtMentionTriggersReply(!botAtMentionTriggersReply)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 ${
                  botAtMentionTriggersReply && autoBotChat ? 'bg-slate-950' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    botAtMentionTriggersReply && autoBotChat ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="border-t border-black/[0.05]" />

            {/* 空闲主动搭话 */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                  <Coffee size={14} className="text-emerald-600" />
                  空闲主动搭话 (Idle Talk)
                </div>
                <p className="mt-1 text-[11px] font-medium leading-relaxed text-slate-400">
                  在群聊处于较长时间空闲时，AI 是否允许基于空间目标或最近讨论主动发起话题探讨。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={idleTalk}
                onClick={() => setIdleTalk(!idleTalk)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  idleTalk ? 'bg-slate-950' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    idleTalk ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* 机制说明提示 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold text-slate-700 mb-1">
              <HelpCircle size={13} />
              什么是“向用户还麦”？
            </div>
            当 AI 成员之间的多轮交叉讨论达到设定的轮数上限时，最后一位成员不会继续呼叫其他 AI，而是会向您归纳核心要点并主动提出选项邀请您决策，保证人机协同节奏可控。
          </div>
        </div>

        {/* Footer */}
        <footer className="flex h-16 shrink-0 items-center justify-end gap-3 border-t border-black/[0.06] px-5 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 rounded-lg px-4 text-xs font-black text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-slate-950 px-5 text-xs font-black text-white hover:bg-slate-800 transition shadow-sm disabled:bg-slate-300"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            保存规则
          </button>
        </footer>
      </section>
    </div>
  );
}
