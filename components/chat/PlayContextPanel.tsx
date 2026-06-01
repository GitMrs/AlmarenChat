'use client';

import { Compass, Crosshair, Lightbulb, MapPin, Scroll, Sparkles, Target, X } from 'lucide-react';
import type { DisplayAgent } from '@/components/chat/ChatMessageItem';
import type { RuntimeState } from '@/types/runtime';
import type { BlueprintRuntimeState, MysteryBlueprint } from '@/types/blueprint';

type EngineRuntimeState = {
  engine: 'blueprint-v1';
  blueprint: MysteryBlueprint;
  state: BlueprintRuntimeState;
  nextActionIds: string[];
};

type PlayContextPanelProps = {
  displayAgent: DisplayAgent;
  categoryColor: string;
  isOpen: boolean;
  onClose: () => void;
  messageCount: number;
  runtimeState?: RuntimeState | null;
  onQuickAction?: (action: string) => void;
  recentUserTexts?: string[];
  actionHistory?: string[];
};

const CATEGORY_SCENE: Record<string, string> = {
  悬疑推理: '案件现场',
  浪漫言情: '邂逅时刻',
  奇幻冒险: '冒险起点',
  都市剧情: '城市街头',
  社交推理: '讨论大厅',
  心理博弈: '博弈空间',
  喜剧搞笑: '欢乐舞台',
  恐怖惊悚: '未知深处',
  科幻探索: '星际航站',
};

const CATEGORY_OBJECTIVE: Record<string, string> = {
  悬疑推理: '收集线索，推理真相',
  浪漫言情: '了解角色，推进关系',
  奇幻冒险: '探索世界，完成任务',
  都市剧情: '做出选择，书写人生',
  社交推理: '找出真相，投票决策',
  心理博弈: '分析局势，制定策略',
  喜剧搞笑: '放飞想象，享受欢乐',
  恐怖惊悚: '保持冷静，活着离开',
  科幻探索: '发现未知，记录探索',
};

export default function PlayContextPanel({
  displayAgent,
  categoryColor,
  isOpen,
  onClose,
  messageCount,
  runtimeState,
  onQuickAction,
  recentUserTexts = [],
  actionHistory = [],
}: PlayContextPanelProps) {
  if (!isOpen) return null;

  const category = displayAgent.category || '都市剧情';
  const engineRuntime = runtimeState && (runtimeState as any).engine === 'blueprint-v1'
    ? (runtimeState as unknown as EngineRuntimeState)
    : null;

  const scene = runtimeState?.sceneName || CATEGORY_SCENE[category] || '故事空间';
  const objective = runtimeState?.objective || CATEGORY_OBJECTIVE[category] || '探索故事，做出选择';
  const engineScene = engineRuntime?.blueprint.scenes.find((item) => item.id === engineRuntime.state.sceneId);
  const engineEnding = engineRuntime?.blueprint.endings.find((item) => item.id === engineRuntime.state.endingId);
  const displayEnded = Boolean(engineRuntime?.state.endedAt || runtimeState?.endedAt);
  const displayScene = displayEnded ? '案件已结束' : engineScene?.name || scene;
  const displayObjective = displayEnded
    ? engineEnding?.name || engineRuntime?.state.endingId || '结局已达成'
    : engineRuntime?.state.objective || objective;

  const engineClues = engineRuntime
    ? engineRuntime.state.discoveredClueIds
        .map((clueId) => engineRuntime.blueprint.clues.find((clue) => clue.id === clueId))
        .filter(Boolean)
    : [];
  const engineItems = engineRuntime
    ? engineRuntime.state.inventoryItemIds
        .map((itemId) => engineRuntime.blueprint.items?.find((item) => item.id === itemId))
        .filter(Boolean)
    : [];
  const engineActions = engineRuntime
    ? engineRuntime.nextActionIds
        .map((actionId) => engineRuntime.blueprint.actions.find((action) => action.id === actionId))
        .filter(Boolean)
    : [];

  const rawActions = displayEnded
    ? []
    : engineActions.length > 0
    ? engineActions.map((action: any) => action.label)
    : runtimeState?.suggestedActions || [];
  const recentLower = recentUserTexts.map((text) => text.toLowerCase());
  const filteredActions = rawActions.filter((action) => {
    const actionLower = action.toLowerCase();
    return !recentLower.some((text) => text.includes(actionLower) || actionLower.includes(text.slice(0, 15)));
  });
  const displayActions = filteredActions.length >= 2 ? filteredActions : rawActions;

  const displayClues = engineRuntime ? engineClues : runtimeState?.clues?.filter((clue) => clue.discovered) || [];
  const displayInventory = engineRuntime ? engineItems : runtimeState?.inventory || [];
  const recentActions = actionHistory.slice(-10);
  const latestAction = recentActions[recentActions.length - 1];
  const accusation = engineRuntime?.blueprint.accusation;
  const correctSuspectId = accusation?.correctSuspectId || '';
  const requiredClueIds = accusation?.requiredClueIds || [];
  const rawRequiredClueIds = requiredClueIds.filter((clueId) => !clueId.startsWith(`deduction_${correctSuspectId}_`));
  const deductionClueIds = requiredClueIds.filter((clueId) => clueId.startsWith(`deduction_${correctSuspectId}_`));
  const discoveredIds = new Set(engineRuntime?.state.discoveredClueIds || []);
  const flags = engineRuntime?.state.flags || {};
  const rawCluesDone = rawRequiredClueIds.length > 0 && rawRequiredClueIds.every((clueId) => discoveredIds.has(clueId));
  const askedCulpritDone = Boolean(correctSuspectId && flags[`asked_${correctSuspectId}`]);
  const confrontDone = deductionClueIds.length > 0 && deductionClueIds.every((clueId) => discoveredIds.has(clueId));
  const reviewDone = Boolean(flags.case_reviewed);
  const caseStage = displayEnded
    ? '结案'
    : !rawCluesDone
      ? '现场调查'
      : !askedCulpritDone
        ? '嫌疑人审问'
        : !confrontDone
          ? '证据对峙'
          : !reviewDone
            ? '整理案情'
            : '最终指认';
  const caseSteps = engineRuntime
    ? [
        { label: '关键物证', done: rawCluesDone, count: rawRequiredClueIds.filter((clueId) => discoveredIds.has(clueId)).length, total: rawRequiredClueIds.length },
        { label: '审问真凶', done: askedCulpritDone, count: askedCulpritDone ? 1 : 0, total: correctSuspectId ? 1 : 0 },
        { label: '证据对峙', done: confrontDone, count: deductionClueIds.filter((clueId) => discoveredIds.has(clueId)).length, total: deductionClueIds.length },
        { label: '整理案情', done: reviewDone, count: reviewDone ? 1 : 0, total: 1 },
      ].filter((step) => step.total > 0)
    : [];

  return (
    <div className="fixed inset-0 z-50 lg:relative lg:z-auto">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm lg:hidden" onClick={onClose} />

      <div className="absolute right-0 top-0 flex h-full w-[300px] flex-col border-l border-white/10 bg-[#19172a]/95 backdrop-blur-xl lg:relative lg:w-[280px]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Compass size={16} style={{ color: categoryColor }} />
            <span className="text-sm font-black text-white">冒险面板</span>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-white/[0.08]">
            <X size={16} className="text-white/40" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <PanelBlock icon={<MapPin size={13} style={{ color: categoryColor }} />} title="当前场景">
            <p className="text-sm font-black text-white">{displayScene}</p>
          </PanelBlock>

          <PanelBlock icon={<Target size={13} style={{ color: categoryColor }} />} title="当前目标">
            <p className="text-sm font-bold text-white/70">{displayObjective}</p>
          </PanelBlock>

          {engineRuntime && (
            <PanelBlock icon={<Target size={13} style={{ color: categoryColor }} />} title="案件阶段">
              <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2">
                <p className="text-sm font-black text-white">{caseStage}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {caseSteps.map((step) => (
                  <div
                    key={step.label}
                    className={`rounded-xl px-3 py-2 text-xs font-bold ${
                      step.done ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/[0.06] text-white/45'
                    }`}
                  >
                    <div>{step.label}</div>
                    <div className="mt-0.5 text-[11px] opacity-70">
                      {step.count}/{step.total}
                    </div>
                  </div>
                ))}
              </div>
            </PanelBlock>
          )}

          {recentActions.length > 0 && (
            <PanelBlock icon={<Crosshair size={13} style={{ color: categoryColor }} />} title="玩家行动">
              {latestAction && (
                <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2">
                  <p className="mb-1 text-[11px] font-black text-white/35">当前推进到</p>
                  <p className="text-xs font-bold leading-5 text-white/78">{latestAction}</p>
                </div>
              )}
              <div className="space-y-2">
                {recentActions.map((action, index) => (
                  <div key={`${index}-${action}`} className="flex gap-2 text-xs leading-5">
                    <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white/[0.08] text-[10px] font-black text-white/40">
                      {actionHistory.length - recentActions.length + index + 1}
                    </span>
                    <span className="text-white/62">{action}</span>
                  </div>
                ))}
              </div>
            </PanelBlock>
          )}

          {displayClues.length > 0 && (
            <PanelBlock icon={<Lightbulb size={13} style={{ color: categoryColor }} />} title={`已发现线索 (${displayClues.length})`}>
              <div className="space-y-2">
                {displayClues.map((clue: any) => (
                  <div key={clue.id} className="rounded-xl bg-white/[0.08] px-3 py-2">
                    <p className="text-xs font-bold text-white/70">{clue.name}</p>
                    {clue.description && <p className="mt-0.5 text-[11px] text-white/40">{clue.description}</p>}
                  </div>
                ))}
              </div>
            </PanelBlock>
          )}

          {displayInventory.length > 0 && (
            <PanelBlock icon={<Scroll size={13} style={{ color: categoryColor }} />} title={`物品栏 (${displayInventory.length})`}>
              <div className="flex flex-wrap gap-1.5">
                {displayInventory.map((item: any) => (
                  <span key={item.id} className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-bold text-white/64">
                    {item.name}
                  </span>
                ))}
              </div>
            </PanelBlock>
          )}

          <PanelBlock icon={<Scroll size={13} style={{ color: categoryColor }} />} title="故事进度">
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    backgroundColor: displayEnded ? '#10b981' : categoryColor,
                    width: displayEnded ? '100%' : `${Math.min(100, Math.max(5, (messageCount / 20) * 100))}%`,
                  }}
                />
              </div>
              <span className="text-xs font-bold text-white/54">{displayEnded ? '已结束' : `${messageCount} 条`}</span>
            </div>
          </PanelBlock>

          {displayActions.length > 0 && (
            <PanelBlock icon={<Sparkles size={13} style={{ color: categoryColor }} />} title="快捷行动">
              <div className="flex flex-wrap gap-2">
                {displayActions.map((action, index) => (
                  <button
                    key={`${index}-${action}`}
                    onClick={() => {
                      onQuickAction?.(action);
                      onClose();
                    }}
                    className="rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/64 transition hover:-translate-y-0.5 hover:bg-white/[0.12] hover:text-white"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </PanelBlock>
          )}
        </div>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-2 rounded-2xl p-3" style={{ backgroundColor: `${categoryColor}15` }}>
            <Sparkles size={14} style={{ color: categoryColor }} />
            <p className="text-xs font-bold" style={{ color: categoryColor }}>
              {category} / {displayAgent.tone || '沉浸'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white/40">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
