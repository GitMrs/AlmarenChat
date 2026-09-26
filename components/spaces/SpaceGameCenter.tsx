'use client';

import { useEffect, useState } from 'react';
import {
  Gamepad2,
  MessagesSquare,
  User,
  Users,
} from 'lucide-react';
import InteractiveGomokuModal from '@/components/spaces/InteractiveGomokuModal';
import type { Agent } from '@/types';

export interface SpaceGameCenterProps {
  spaceAgents?: Agent[];
  onShareToSpace?: (content: string) => void;
  onBackToChat?: () => void;
  initialGame?: 'gomoku' | null;
}

export default function SpaceGameCenter({
  spaceAgents = [],
  onShareToSpace,
  onBackToChat,
  initialGame = null,
}: SpaceGameCenterProps) {
  const [isGomokuModalOpen, setIsGomokuModalOpen] = useState(Boolean(initialGame === 'gomoku'));
  const [gomokuMode, setGomokuMode] = useState<'pve' | 'eve'>('pve');

  useEffect(() => {
    if (initialGame === 'gomoku') {
      setGomokuMode('pve');
      setIsGomokuModalOpen(true);
    }
  }, [initialGame]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbfaf7]">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8 space-y-6">
        {/* 大厅顶部导航 */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.07] pb-5">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-2xl text-white shadow-md ring-4 ring-amber-100">
              🎮
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-slate-950">开黑游戏中心</h2>
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-black text-amber-800">
                  专属休闲娱乐工坊
                </span>
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                空间陪玩团随时在线待命 · 支持双人切磋、全员内战复盘与语音互动
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {onBackToChat && (
              <button
                type="button"
                onClick={onBackToChat}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3.5 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"
              >
                <MessagesSquare size={15} />
                返回空间对话
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setGomokuMode('pve');
                setIsGomokuModalOpen(true);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white shadow-md transition hover:bg-slate-800"
            >
              <Gamepad2 size={16} className="text-amber-400" />
              立即畅玩五子棋
            </button>
          </div>
        </div>

        {/* 开放游戏列表（五子棋作为当前唯一的类型） */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-slate-900">精选游戏库</h3>
              <span className="rounded-md bg-amber-500/10 border border-amber-200 px-2 py-0.5 text-xs font-black text-amber-800">
                当前开放 1 款
              </span>
            </div>
            <span className="text-xs text-slate-400 font-semibold">类型：经典棋盘博弈</span>
          </div>

          {/* 核心游戏大卡片：五子棋 */}
          <div className="relative overflow-hidden rounded-2xl border-2 border-amber-300/90 bg-white p-6 shadow-sm transition hover:shadow-md hover:border-amber-400">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-3xl text-white shadow-lg ring-4 ring-amber-100">
                  ♟️
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h4 className="text-lg font-black text-slate-900">五子棋 AI 竞技场</h4>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-black text-emerald-700">
                      现已开放
                    </span>
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-800">
                      全语音陪玩
                    </span>
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-black text-blue-700">
                      战术军师解析
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600 max-w-2xl">
                    经典的 15×15 棋盘博弈，搭载启发式棋力引擎与多层战术深度评估。支持随时与璐璐、诺克斯、可可进行人机切磋（PVE），或开启自动对局观摩全员巅峰内战与互怼复盘（EVE）！
                  </p>
                  <div className="mt-3.5 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                    <span className="flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-lg border border-black/[0.06]">
                      🎙️ 180+ 句个性台词 (开局/残局/专属互怼)
                    </span>
                    <span className="flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-lg border border-black/[0.06]">
                      💡 军师点位深度战术指导
                    </span>
                    <span className="flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-lg border border-black/[0.06]">
                      🔊 实木敲击拟真落子音效
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-row lg:flex-col gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setGomokuMode('pve');
                    setIsGomokuModalOpen(true);
                  }}
                  className="flex-1 lg:flex-none inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-xs font-black text-white shadow-md transition hover:bg-slate-800"
                >
                  <User size={15} />
                  开始人机对弈 (PVE)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGomokuMode('eve');
                    setIsGomokuModalOpen(true);
                  }}
                  className="flex-1 lg:flex-none inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 text-xs font-black text-slate-800 shadow-sm transition hover:bg-slate-50 hover:border-slate-400"
                >
                  <Users size={15} />
                  开启全员观战 (EVE)
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 筹备中游戏企划卡片 */}
        <div>
          <div className="text-xs font-black text-slate-400 mb-3 flex items-center gap-1.5">
            <span>🚀 更多游戏企划 (筹备中)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-60">
            <div className="flex items-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-white p-5">
              <span className="text-3xl">🎲</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-slate-800">谁是卧底 · 语言推理</span>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    筹备中
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 truncate">
                  多 Agent 身份隐藏与陈述辩论推理，敬请期待
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 rounded-2xl border border-dashed border-slate-300 bg-white p-5">
              <span className="text-3xl">♟️</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-slate-800">国际象棋 · 战术推演</span>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                    规划中
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 truncate">
                  诺克斯军师定制战术残局复盘与推演
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 五子棋对弈与观战专属弹框 */}
      <InteractiveGomokuModal
        isOpen={isGomokuModalOpen}
        onClose={() => setIsGomokuModalOpen(false)}
        spaceAgents={spaceAgents}
        initialMode={gomokuMode}
        onShareToSpace={(text) => {
          setIsGomokuModalOpen(false);
          onShareToSpace?.(text);
        }}
      />
    </div>
  );
}
