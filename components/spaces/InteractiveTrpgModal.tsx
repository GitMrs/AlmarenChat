'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Compass,
  Dices,
  Flame,
  Gamepad2,
  Heart,
  HelpCircle,
  Loader2,
  Lock,
  Package,
  Play,
  Plus,
  RotateCcw,
  Scroll,
  Send,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Swords,
  Volume2,
  VolumeX,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  createTrpgGame,
  selectChoice,
  executePendingCheck,
  rerollWithFatePoint,
  performFreeAction,
  generateTrpgBattleReport,
  getItemDefinition,
  useInventoryItem,
  triggerCompanionAssist,
  type TrpgGameState,
  type TrpgHistoryItem,
  type TrpgItemDefinition,
} from '@/lib/trpg/engine.ts';
import {
  SCENARIOS,
  type TrpgScenario,
  type ScenarioCharacterPreset,
  type NodeChoice,
} from '@/lib/trpg/scenarios.ts';
import {
  playDiceRollSound,
  playCheckResultSound,
  playItemUseSound,
  type SkillCheckResult,
} from '@/lib/trpg/dice.ts';
import { useTTS } from '@/hooks/useTTS';
import type { Agent } from '@/types';

export interface InteractiveTrpgModalProps {
  isOpen: boolean;
  onClose: () => void;
  spaceAgents?: Agent[];
  onShareToSpace?: (content: string) => void;
  initialScenarioId?: string;
}

export default function InteractiveTrpgModal({
  isOpen,
  onClose,
  spaceAgents = [],
  onShareToSpace,
  initialScenarioId = 'coc_blackwood_manor',
}: InteractiveTrpgModalProps) {
  const [mounted, setMounted] = useState(false);

  // 模式：'setup' (选择剧本与角色卡) | 'in_game' (跑团进行中)
  const [mode, setMode] = useState<'setup' | 'in_game'>('setup');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(initialScenarioId);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [customHeroName, setCustomHeroName] = useState<string>('');

  // 游戏核心状态
  const [game, setGame] = useState<TrpgGameState>(() => createTrpgGame(initialScenarioId));
  const [autoVoice, setAutoVoice] = useState(true);
  const [freeActionInput, setFreeActionInput] = useState('');

  // 骰子动效状态
  const [isRollingAnimation, setIsRollingAnimation] = useState(false);
  const [rollingDisplayNum, setRollingDisplayNum] = useState<number>(20);

  // 道具与援护使用反馈气泡提示
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const { play: playTTS, stop: stopTTS, isPlaying: isSpeaking } = useTTS();
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const rollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 弹窗开启时重置为选择界面并锁定外部滚动
  useEffect(() => {
    if (isOpen) {
      setMode('setup');
      setFreeActionInput('');
      setIsRollingAnimation(false);
      setActionNotice(null);
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    } else {
      stopTTS();
      if (rollingIntervalRef.current) clearInterval(rollingIntervalRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      setIsRollingAnimation(false);
    }
  }, [isOpen, stopTTS]);

  // 选中的剧本对象
  const activeScenario = SCENARIOS.find((s) => s.id === selectedScenarioId) || SCENARIOS[0];

  // 切换剧本时默认选中第一个角色预设
  useEffect(() => {
    if (activeScenario && activeScenario.characterPresets.length > 0) {
      setSelectedPresetId(activeScenario.characterPresets[0].id);
      setCustomHeroName(activeScenario.characterPresets[0].name);
    }
  }, [selectedScenarioId, activeScenario]);

  // 选中的角色预设对象
  const activePreset =
    activeScenario.characterPresets.find((p) => p.id === selectedPresetId) ||
    activeScenario.characterPresets[0];

  // 仅在对话流容器内部滚动到底部
  const scrollToBottom = useCallback((smooth = true) => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  useEffect(() => {
    if (mode === 'in_game') {
      scrollToBottom(true);
    }
  }, [game.history.length, mode, scrollToBottom]);

  // 当进入新场景时自动朗读 DM 剧情
  useEffect(() => {
    if (mode === 'in_game' && autoVoice && game.history.length > 0) {
      const latestItem = game.history[game.history.length - 1];
      if (latestItem && latestItem.narration) {
        const dmAgent = spaceAgents.find((a) => a.id === 'gaming-dm');
        const voice = dmAgent?.voice || 'zh-CN-YunjianNeural';
        playTTS(latestItem.narration.slice(0, 180), {
          voice,
          rate: '-4%',
        });
      }
    }
  }, [game.history.length, mode, autoVoice, spaceAgents, playTTS]);

  const triggerNotice = (text: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setActionNotice(text);
    noticeTimerRef.current = setTimeout(() => {
      setActionNotice(null);
    }, 2800);
  };

  // 开启跑团冒险
  const handleStartAdventure = () => {
    stopTTS();
    const newGame = createTrpgGame(selectedScenarioId, selectedPresetId, customHeroName);
    setGame(newGame);
    setMode('in_game');
    setFreeActionInput('');
    setActionNotice(null);
  };

  // 重置 / 返回选单
  const handleResetToSetup = () => {
    stopTTS();
    if (rollingIntervalRef.current) clearInterval(rollingIntervalRef.current);
    setIsRollingAnimation(false);
    setActionNotice(null);
    setMode('setup');
  };

  // 玩家选择一个预设分支
  const handleSelectChoice = (choiceId: string) => {
    if (isRollingAnimation) return;
    const currentNode = game.scenario.nodes[game.currentNodeId];
    const targetChoice = currentNode?.choices.find((c) => c.id === choiceId);

    // 校验前置道具
    if (targetChoice?.requiredItem) {
      const hasItem = game.character.inventory.some((it) => it.includes(targetChoice.requiredItem!));
      if (!hasItem) {
        triggerNotice(`缺少关键道具【${targetChoice.requiredItem}】，无法选择该分支`);
        return;
      }
    }

    const nextState = selectChoice(game, choiceId);
    setGame(nextState);
  };

  // 主动使用道具
  const handleUseItem = (itemName: string) => {
    if (isRollingAnimation) return;
    const result = useInventoryItem(game, itemName);
    if (result.success) {
      playItemUseSound();
      setGame(result.state);
      triggerNotice(result.message);
    } else {
      triggerNotice(result.message);
    }
  };

  // 呼叫队友战术援护技能
  const handleCallCompanion = (companionId: 'gaming-lulu' | 'gaming-koko' | 'gaming-nox') => {
    if (isRollingAnimation) return;
    const nextState = triggerCompanionAssist(game, companionId);
    playCheckResultSound('hard_success');
    setGame(nextState);

    if (companionId === 'gaming-koko') {
      triggerNotice('🦊 可可【元气救援】已生效！生命值 +8，理智值 +10！');
    } else if (companionId === 'gaming-nox') {
      triggerNotice('♟️ 诺克斯【战术推演】已激活！下次检定成功率 +25%！');
    } else if (companionId === 'gaming-lulu') {
      triggerNotice('🐱 璐璐【致命一击】加护已激活！下次检定成功直接升为大成功！');
    }
  };

  // 玩家执行自由行动
  const handleFreeActionSubmit = () => {
    if (!freeActionInput.trim() || isRollingAnimation) return;
    const nextState = performFreeAction(game, freeActionInput);
    setFreeActionInput('');
    setGame(nextState);
  };

  // 掷骰子动画与结算
  const handleRollDice = () => {
    if (isRollingAnimation || !game.pendingCheck) return;

    setIsRollingAnimation(true);
    playDiceRollSound();

    const maxSides = game.pendingCheck.rule === 'coc' ? 100 : 20;

    let count = 0;
    rollingIntervalRef.current = setInterval(() => {
      setRollingDisplayNum(Math.floor(Math.random() * maxSides) + 1);
      count++;
      if (count > 10) {
        if (rollingIntervalRef.current) clearInterval(rollingIntervalRef.current);
        const nextState = executePendingCheck(game);
        setGame(nextState);
        setIsRollingAnimation(false);

        if (nextState.lastCheckResult) {
          setRollingDisplayNum(nextState.lastCheckResult.diceRoll.roll);
          playCheckResultSound(nextState.lastCheckResult.level);
        }
      }
    }, 40);
  };

  // 消耗 1 点命运点逆转乾坤重掷
  const handleRerollLuck = () => {
    if (game.character.luck <= 0 || isRollingAnimation) return;
    const nextState = rerollWithFatePoint(game);
    setGame(nextState);
    triggerNotice('✨ 命运点已消耗，获得逆天改命重掷机会！');
  };

  // 分享战报到空间
  const handleShareReport = () => {
    if (!onShareToSpace) return;
    const report = generateTrpgBattleReport(game);
    onShareToSpace(report);
    onClose();
  };

  if (!isOpen || !mounted) return null;

  const currentNode = game.scenario.nodes[game.currentNodeId];

  // 章节路线指引
  const renderChapterProgress = () => {
    if (game.scenario.id === 'coc_blackwood_manor') {
      return (
        <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium overflow-x-auto py-0.5">
          <span className={`px-1.5 py-0.5 rounded font-bold ${currentNode?.id === 'node_foyer' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'}`}>
            1.门厅玄关
          </span>
          <span className="text-slate-300">➔</span>
          <span className={`px-1.5 py-0.5 rounded font-bold ${['node_dining', 'node_gallery', 'node_study'].includes(currentNode?.id || '') ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'}`}>
            2.庄园探索(西翼/东翼/书斋)
          </span>
          <span className="text-slate-300">➔</span>
          <span className={`px-1.5 py-0.5 rounded font-bold ${currentNode?.id === 'node_cellar_corridor' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'}`}>
            3.地窖回廊
          </span>
          <span className="text-slate-300">➔</span>
          <span className={`px-1.5 py-0.5 rounded font-bold ${currentNode?.id === 'node_basement' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'}`}>
            4.深渊祭坛决战
          </span>
        </div>
      );
    }

    if (game.scenario.id === 'dnd_forgotten_mine') {
      return (
        <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium overflow-x-auto py-0.5">
          <span className={`px-1.5 py-0.5 rounded font-bold ${currentNode?.id === 'dnd_entrance' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'}`}>
            1.吊桥哨卡
          </span>
          <span className="text-slate-300">➔</span>
          <span className={`px-1.5 py-0.5 rounded font-bold ${['dnd_dwarf_prison', 'dnd_forge'].includes(currentNode?.id || '') ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'}`}>
            2.水牢营救 / 符文神殿
          </span>
          <span className="text-slate-300">➔</span>
          <span className={`px-1.5 py-0.5 rounded font-bold ${currentNode?.id === 'dnd_dragon_lair' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'}`}>
            3.熔岩龙巢决战
          </span>
        </div>
      );
    }

    return (
      <div className="text-[11px] text-slate-500 font-medium">
        📍 {currentNode?.location}
      </div>
    );
  };

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-sm overflow-hidden overscroll-none">
      <div className="flex h-[90vh] max-h-[760px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
        
        {/* 顶部标题栏与通用工具按钮 */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 bg-white">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-2xl text-amber-700 shadow-inner">
              {mode === 'setup' ? activeScenario.coverIcon : game.scenario.coverIcon}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-slate-900">
                  沉浸跑团 · 命运骰子
                </h2>
                <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-black text-amber-800">
                  {mode === 'setup' ? activeScenario.systemName : game.scenario.systemName}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                  {mode === 'setup' ? '选择剧本与人物' : `第 ${game.turnCount} 幕 · 探险中`}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium truncate max-w-md mt-0.5">
                {mode === 'setup' ? activeScenario.tagline : game.scenario.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 语音播报开关 */}
            <button
              type="button"
              onClick={() => {
                if (autoVoice && isSpeaking) stopTTS();
                setAutoVoice(!autoVoice);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                autoVoice
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
              title={autoVoice ? 'DM 守秘人语音已开启' : '语音已关闭'}
            >
              {autoVoice ? <Volume2 size={14} /> : <VolumeX size={14} />}
              <span className="hidden sm:inline">{autoVoice ? 'DM 语音' : '静音'}</span>
            </button>

            {/* 顶部快捷开始游戏按钮 */}
            {mode === 'setup' && (
              <button
                type="button"
                onClick={handleStartAdventure}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-black text-white shadow-sm hover:bg-amber-700 transition cursor-pointer"
              >
                <Play size={13} className="fill-white" />
                <span>开始游戏</span>
              </button>
            )}

            {/* 切换剧本 / 重新开始 */}
            {mode === 'in_game' && (
              <button
                type="button"
                onClick={handleResetToSetup}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
                title="返回剧本与角色选择界面"
              >
                <RotateCcw size={13} />
                <span className="hidden sm:inline">选新剧本</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* 角色卡属性状态顶栏（跑团进行中展示） */}
        {mode === 'in_game' && (
          <div className="shrink-0 z-10 flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 sm:px-6 text-xs gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{game.character.avatar}</span>
              <div>
                <span className="font-black text-slate-900">{game.character.name}</span>
                <span className="ml-1.5 text-slate-500 font-semibold">({game.character.className})</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              {/* 生命值 HP */}
              <div className="flex items-center gap-1.5">
                <Heart size={14} className="text-rose-500 fill-rose-500/20" />
                <span className="font-bold text-slate-700">HP:</span>
                <div className="h-2.5 w-20 rounded-full bg-slate-200 overflow-hidden ring-1 ring-slate-300">
                  <div
                    className={`h-full transition-all duration-300 ${
                      game.character.hp <= game.character.maxHp * 0.3
                        ? 'bg-rose-500'
                        : game.character.hp <= game.character.maxHp * 0.6
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, (game.character.hp / game.character.maxHp) * 100))}%` }}
                  />
                </div>
                <span className="font-mono text-xs font-bold text-slate-800">
                  {game.character.hp}/{game.character.maxHp}
                </span>
              </div>

              {/* 理智值 SAN (克苏鲁剧本) */}
              {game.character.san !== undefined && (
                <div className="flex items-center gap-1.5">
                  <Flame size={14} className="text-purple-600 fill-purple-600/20" />
                  <span className="font-bold text-slate-700">SAN:</span>
                  <div className="h-2.5 w-20 rounded-full bg-slate-200 overflow-hidden ring-1 ring-slate-300">
                    <div
                      className="h-full bg-purple-600 transition-all duration-300"
                      style={{ width: `${Math.min(100, Math.max(0, (game.character.san / (game.character.maxSan || 100)) * 100))}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs font-bold text-purple-900">
                    {game.character.san}/{game.character.maxSan || 100}
                  </span>
                </div>
              )}

              {/* 命运点 LUCK */}
              <div className="flex items-center gap-1.5 bg-amber-100/70 border border-amber-300 px-2 py-0.5 rounded-md">
                <Sparkles size={13} className="text-amber-700" />
                <span className="text-[11px] font-black text-amber-900">
                  命运点: <span className="font-mono text-amber-950 font-black">{game.character.luck}</span>
                </span>
              </div>

              {/* 随身背包计数 */}
              <div className="flex items-center gap-1 text-[11px] text-slate-600">
                <Package size={13} className="text-amber-700" />
                <span className="font-bold">背包:</span>
                <span className="font-mono font-black text-amber-900">{game.character.inventory.length} 件</span>
              </div>
            </div>
          </div>
        )}

        {/* 核心内容区 */}
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
          {mode === 'setup' ? (
            /* ==================== 1. 剧本与角色选择界面 ==================== */
            <div className="flex-1 flex flex-col min-h-0 bg-[#fbfaf7]">
              {/* 向上滚动的内容区 */}
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <Compass size={17} className="text-amber-600" />
                    第 1 步：挑选你的冒险剧本模组
                  </h3>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3.5">
                    {SCENARIOS.map((sc) => {
                      const isSelected = sc.id === selectedScenarioId;
                      return (
                        <div
                          key={sc.id}
                          onClick={() => setSelectedScenarioId(sc.id)}
                          className={`group relative flex flex-col justify-between rounded-xl border p-4 transition-all cursor-pointer ${
                            isSelected
                              ? 'border-2 border-amber-500 bg-amber-50/40 shadow-sm ring-2 ring-amber-200'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-3xl">{sc.coverIcon}</span>
                              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">
                                {sc.difficulty}
                              </span>
                            </div>
                            <h4 className="mt-2.5 text-sm font-black text-slate-900">
                              {sc.title}
                            </h4>
                            <span className="inline-block mt-0.5 text-[11px] font-bold text-amber-700">
                              {sc.genre}
                            </span>
                            <p className="mt-2 text-xs text-slate-600 leading-relaxed line-clamp-3">
                              {sc.description}
                            </p>
                          </div>

                          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold">
                            <span className="text-slate-400">{sc.characterPresets.length} 位可选主角</span>
                            <span className={isSelected ? 'text-amber-700' : 'text-slate-400'}>
                              {isSelected ? '✓ 当前已选中' : '点击选择'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <Swords size={17} className="text-amber-600" />
                    第 2 步：选择或定制你的冒险角色
                  </h3>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                    {activeScenario.characterPresets.map((preset) => {
                      const isSelected = preset.id === selectedPresetId;
                      return (
                        <div
                          key={preset.id}
                          onClick={() => {
                            setSelectedPresetId(preset.id);
                            setCustomHeroName(preset.name);
                          }}
                          className={`rounded-xl border p-4 transition-all cursor-pointer ${
                            isSelected
                              ? 'border-2 border-amber-500 bg-amber-50/40 shadow-sm ring-2 ring-amber-200'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-2xl">{preset.avatar}</span>
                            <div>
                              <h5 className="text-xs font-black text-slate-900">{preset.name}</h5>
                              <span className="text-[10px] text-amber-700 font-bold">{preset.className}</span>
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] text-slate-600 line-clamp-2">
                            {preset.description}
                          </p>
                          <div className="mt-2.5 flex items-center gap-2 text-[10px] text-slate-700 font-mono">
                            <span className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded font-bold">HP: {preset.hp}</span>
                            {preset.san !== undefined && (
                              <span className="bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded text-purple-700 font-bold">
                                SAN: {preset.san}
                              </span>
                            )}
                            <span className="bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-amber-800 font-bold">
                              ✨ 幸运: {preset.luck}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 角色名定制输入 */}
                  <div className="mt-4 flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-bold text-slate-700">自定义角色名：</span>
                    <input
                      type="text"
                      value={customHeroName}
                      onChange={(e) => setCustomHeroName(e.target.value)}
                      placeholder="输入你在跑团中的尊姓大名..."
                      className="flex-1 min-w-[200px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-800 focus:border-amber-500 focus:bg-white focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* 吸底常驻的大型醒目开始冒险按钮条 */}
              <div className="shrink-0 border-t border-slate-200 bg-white px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-md">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 font-medium">当前准备：</span>
                  <span className="font-black text-slate-900">《{activeScenario.title}》</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-bold text-amber-700">
                    {customHeroName || activePreset?.name} ({activePreset?.className})
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleStartAdventure}
                  className="inline-flex h-12 items-center gap-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-9 text-sm font-black text-white shadow-lg shadow-amber-500/25 hover:brightness-105 active:scale-98 transition cursor-pointer"
                >
                  <Play size={18} className="fill-white" />
                  <span>开始游戏</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          ) : (
            /* ==================== 2. 跑团进行中核心界面 ==================== */
            <div className="min-h-0 flex-1 flex flex-col lg:flex-row overflow-hidden relative">
              
              {/* 操作浮动提示 Notice */}
              {actionNotice && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-slate-950/90 text-white px-4 py-2 text-xs font-bold shadow-xl border border-white/20 backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200">
                  {actionNotice}
                </div>
              )}

              {/* 左侧：命运之书与冒险记录 */}
              <div className="flex-1 min-h-0 min-w-0 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 bg-[#fbfaf7] overflow-hidden">
                
                {/* 场景氛围提示栏与章节脉络 */}
                <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-black text-slate-900 truncate">
                        {currentNode?.title}
                      </span>
                      <span className="text-slate-300">|</span>
                      <span className="text-[11px] text-slate-500 truncate font-semibold">
                        📍 {currentNode?.location}
                      </span>
                    </div>
                    <span className="text-[11px] text-amber-800 font-bold shrink-0 ml-2">
                      {currentNode?.environmentAtmosphere}
                    </span>
                  </div>
                  {renderChapterProgress()}
                </div>

                {/* 冒险日志信息流 */}
                <div
                  ref={chatContainerRef}
                  className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 font-sans text-xs scroll-smooth"
                >
                  {game.history.map((item, idx) => (
                    <div key={item.id || idx} className="space-y-3">
                      
                      {/* 1. 守秘人 DM 场景描摹 */}
                      {item.narration && (
                        <div className="flex items-start gap-3 rounded-xl border border-amber-200/90 bg-white p-4 shadow-2xs">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-200 text-xl text-amber-700">
                            📜
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-black text-amber-900 text-xs flex items-center gap-1.5">
                                {item.nodeTitle || '守秘人 (DM)'}
                                <span className="text-[10px] font-semibold text-slate-400">· 场景叙事</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => playTTS(item.narration.slice(0, 180), { voice: 'zh-CN-YunjianNeural', rate: '-4%' })}
                                className="text-slate-400 hover:text-amber-700 transition cursor-pointer p-0.5"
                                title="语音朗读该段落"
                              >
                                <Volume2 size={14} />
                              </button>
                            </div>
                            <p className="text-xs leading-relaxed text-slate-800 whitespace-pre-wrap font-serif">
                              {item.narration}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* 2. 玩家抉择气泡 */}
                      {item.choiceLabel && (
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-xl bg-amber-500/10 border border-amber-300 px-3.5 py-2 text-amber-950 font-bold shadow-2xs">
                            <span className="text-[10px] text-amber-700 block font-semibold">你的抉择：</span>
                            {item.choiceLabel}
                          </div>
                        </div>
                      )}

                      {/* 3. 骰子检定结果反馈 */}
                      {item.checkResult && (
                        <div
                          className={`rounded-xl border p-3 flex items-center justify-between shadow-2xs ${
                            item.checkResult.level === 'critical_success'
                              ? 'border-amber-400 bg-amber-50 text-amber-950'
                              : item.checkResult.level === 'fumble'
                              ? 'border-rose-400 bg-rose-50 text-rose-950'
                              : item.checkResult.isSuccess
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                              : 'border-slate-300 bg-slate-100 text-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-2xl">
                              {item.checkResult.level === 'critical_success'
                                ? '🌟'
                                : item.checkResult.level === 'fumble'
                                ? '💀'
                                : item.checkResult.isSuccess
                                ? '🎯'
                                : '❌'}
                            </span>
                            <div>
                              <div className="font-black text-xs">
                                {item.checkResult.summary}
                              </div>
                              <div className="text-[11px] opacity-80 font-mono mt-0.5">
                                {item.checkResult.detail}
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 font-mono text-base font-black px-2.5 py-1 rounded-md bg-white border border-black/10 shadow-inner">
                            {item.checkResult.diceRoll.roll}
                          </div>
                        </div>
                      )}

                      {/* 4. 分支结果反馈 */}
                      {item.outcomeText && (
                        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800 shadow-2xs">
                          <span className="font-bold text-amber-800 block mb-1">【局势变化】</span>
                          <p className="whitespace-pre-wrap">{item.outcomeText}</p>
                        </div>
                      )}

                      {/* 5. 队友伴聊弹幕反馈 */}
                      {item.companionSpeech && (
                        <div className="flex items-start gap-2.5 bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
                          <span className="text-xl shrink-0">{item.companionSpeech.agentAvatar}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-[11px] font-bold text-slate-500 block">
                              {item.companionSpeech.agentName}
                            </span>
                            <p className="text-xs text-slate-800 mt-0.5 leading-relaxed font-semibold">
                              “{item.companionSpeech.text}”
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* 终局胜利 / 陨落卡片 */}
                  {(game.status === 'victory' || game.status === 'game_over') && (
                    <div className="rounded-2xl border-2 border-amber-400 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 space-y-4 shadow-md">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">
                          {game.status === 'victory' ? '🏆' : '💀'}
                        </span>
                        <div>
                          <h4 className="text-base font-black text-slate-900">
                            {currentNode?.endingTitle || (game.status === 'victory' ? '冒险胜利达成！' : '旅途陨落……')}
                          </h4>
                          <p className="text-xs text-slate-600 mt-0.5">
                            历经 {game.turnCount} 幕 ｜ 命运掷骰 {game.rollCount} 次 (🌟大成功: {game.criticalCount} / ✅成功: {game.successCount} / 💀大失败: {game.fumbleCount})
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2.5 pt-1">
                        {onShareToSpace && (
                          <button
                            type="button"
                            onClick={handleShareReport}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 transition cursor-pointer shadow-sm"
                          >
                            <Share2 size={14} />
                            <span>分享战报到空间群聊</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleResetToSetup}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 transition cursor-pointer shadow-2xs"
                        >
                          <RotateCcw size={14} />
                          <span>再来一把 / 选新剧本</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧：命运罗盘、分支抉择、战术支援与随身背包 */}
              <div className="shrink-0 w-full lg:w-[380px] flex flex-col min-h-0 bg-white overflow-hidden">
                
                {/* 骰子动态摇号核心区（吸顶固定） */}
                <div className="shrink-0 border-b border-slate-200 p-3.5 bg-slate-50 text-center space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="flex items-center gap-1 font-black text-amber-800">
                      <Dices size={15} /> 命运之骰
                    </span>
                    <span className="font-mono text-[11px] font-bold text-slate-600">
                      {game.scenario.system === 'coc' ? '1d100 (百分骰)' : '1d20 (D20)'}
                    </span>
                  </div>

                  {/* 3D 拟态发光骰子 */}
                  <div className="relative py-1 flex items-center justify-center">
                    <div
                      className={`relative flex h-20 w-20 items-center justify-center rounded-2xl border-2 transition-all duration-300 ${
                        isRollingAnimation
                          ? 'animate-bounce border-amber-500 bg-amber-100 shadow-xl shadow-amber-500/20 scale-105'
                          : game.lastCheckResult?.level === 'critical_success'
                          ? 'border-amber-500 bg-amber-50 shadow-md shadow-amber-500/30 ring-4 ring-amber-200'
                          : game.lastCheckResult?.level === 'fumble'
                          ? 'border-rose-500 bg-rose-50 shadow-md shadow-rose-500/30 ring-4 ring-rose-200'
                          : 'border-amber-300 bg-white shadow-sm'
                      }`}
                    >
                      <span className="font-mono text-3xl font-black text-slate-900 tracking-tighter">
                        {isRollingAnimation ? rollingDisplayNum : game.lastCheckResult ? game.lastCheckResult.diceRoll.roll : (game.scenario.system === 'coc' ? 100 : 20)}
                      </span>

                      {/* 骰子角标标签 */}
                      <span className="absolute -bottom-2 -right-2 rounded-md bg-amber-600 px-1.5 py-0.5 text-[9px] font-black text-white shadow-xs">
                        {game.scenario.system === 'coc' ? 'D100' : 'D20'}
                      </span>
                    </div>
                  </div>

                  {/* 队友激活光环提示 */}
                  {game.companionSkills.lulu.activeForNextCheck && (
                    <div className="rounded-lg bg-amber-500/15 border border-amber-300 px-2 py-1 text-[11px] font-black text-amber-900 flex items-center justify-center gap-1 animate-pulse">
                      🌟 璐璐【致命一击】加护激活中！下次判定成功即大成功！
                    </div>
                  )}
                  {game.companionSkills.nox.activeForNextCheck && (
                    <div className="rounded-lg bg-indigo-500/15 border border-indigo-300 px-2 py-1 text-[11px] font-black text-indigo-900 flex items-center justify-center gap-1 animate-pulse">
                      ♟️ 诺克斯【战术透镜】激活中！检定成功率 +25%！
                    </div>
                  )}

                  {/* 检定目标与掷骰按钮 */}
                  {game.status === 'rolling' && game.pendingCheck ? (
                    <div className="space-y-2">
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-2 text-xs text-left">
                        <span className="font-black text-amber-900 block">
                          【{game.pendingCheck.skillName}】检定进行中
                        </span>
                        <div className="text-[11px] text-slate-600 font-semibold mt-0.5">
                          {game.pendingCheck.rule === 'coc'
                            ? `目标技能值 ≤ ${game.pendingCheck.targetValue}`
                            : `难度目标 DC ${game.pendingCheck.dc || game.pendingCheck.targetValue} (加值 ${game.pendingCheck.modifier >= 0 ? '+' : ''}${game.pendingCheck.modifier})`}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleRollDice}
                        disabled={isRollingAnimation}
                        className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-xs font-black text-white shadow-md shadow-amber-500/20 hover:brightness-105 active:scale-98 transition disabled:opacity-50 cursor-pointer"
                      >
                        <Dices size={15} />
                        <span>{isRollingAnimation ? '命运翻滚中...' : '🎲 掷出命运之骰！'}</span>
                      </button>
                    </div>
                  ) : (
                    <div>
                      {/* 若上次检定未成功且有剩余幸运点，支持重掷 */}
                      {game.lastCheckResult && !game.lastCheckResult.isSuccess && game.character.luck > 0 && game.status === 'playing' ? (
                        <button
                          type="button"
                          onClick={handleRerollLuck}
                          className="w-full inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-900 hover:bg-amber-100 transition cursor-pointer shadow-2xs"
                        >
                          <Sparkles size={13} className="text-amber-600" />
                          <span>消耗 1 点命运点逆转乾坤 (余 {game.character.luck})</span>
                        </button>
                      ) : (
                        <p className="text-[11px] text-slate-500 font-medium">
                          {game.status === 'playing' ? '在下方选择行动或使用战术支援' : '冒险已抵达终局'}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* 滚动中枢：分支抉择 + 队友战术援护 + 随身背包 */}
                <div className="min-h-0 flex-1 overflow-y-auto p-3.5 space-y-4">
                  
                  {/* 1. 当前行动分支决策 */}
                  <div className="space-y-2">
                    <div className="text-xs font-black text-slate-900 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Swords size={14} className="text-amber-600" /> 行动分支抉择
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold">
                        {game.status === 'rolling' ? '等待掷骰' : '请点击选择一项'}
                      </span>
                    </div>

                    {game.status === 'playing' && currentNode && !currentNode.isEnding && (
                      <div className="space-y-2">
                        {currentNode.choices.map((choice) => {
                          const hasReq = !choice.requiredItem || game.character.inventory.some((it) => it.includes(choice.requiredItem!));

                          return (
                            <button
                              key={choice.id}
                              type="button"
                              onClick={() => handleSelectChoice(choice.id)}
                              disabled={!hasReq}
                              className={`w-full text-left p-2.5 rounded-xl border transition-all shadow-2xs group ${
                                !hasReq
                                  ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                                  : choice.requiredItem
                                  ? 'border-emerald-300 bg-emerald-50/30 hover:border-emerald-500 hover:bg-emerald-50/60 cursor-pointer'
                                  : 'border-slate-200 bg-white hover:border-amber-400 hover:bg-amber-50/30 cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="text-xs font-black text-slate-900 group-hover:text-amber-900">
                                  {choice.label}
                                </span>
                                {choice.tag && (
                                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
                                    {choice.tag}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500 leading-relaxed group-hover:text-slate-700">
                                {choice.description}
                              </p>
                              {!hasReq && choice.requiredItem && (
                                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-rose-600 font-bold">
                                  <Lock size={12} />
                                  <span>需要道具：【{choice.requiredItem}】</span>
                                </div>
                              )}
                              {hasReq && choice.requiredItem && (
                                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-700 font-bold">
                                  <CheckCircle2 size={12} />
                                  <span>已拥有关键道具 · 免检定专属优势！</span>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {game.status === 'rolling' && (
                      <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-center space-y-1.5">
                        <Sparkles size={20} className="mx-auto text-amber-600 animate-pulse" />
                        <h5 className="text-xs font-black text-amber-900">命运之线交织收拢</h5>
                        <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                          当前抉择需要进行技能检定，请在上方点击【🎲 掷出命运之骰】！
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 2. 队友战术援护技能 */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="text-xs font-black text-slate-900 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck size={14} className="text-indigo-600" /> 队友战术援护 (每局限 1 次)
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {/* 璐璐 */}
                      <button
                        type="button"
                        onClick={() => handleCallCompanion('gaming-lulu')}
                        disabled={game.companionSkills.lulu.used || game.status !== 'playing'}
                        className={`flex flex-col items-center justify-between p-2 rounded-xl border text-center transition cursor-pointer ${
                          game.companionSkills.lulu.activeForNextCheck
                            ? 'border-amber-400 bg-amber-100/70 shadow-xs ring-1 ring-amber-300'
                            : game.companionSkills.lulu.used
                            ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
                            : 'border-amber-200 bg-amber-50/50 hover:bg-amber-100/60'
                        }`}
                      >
                        <span className="text-lg">🐱</span>
                        <div className="mt-1">
                          <div className="text-[11px] font-black text-slate-900">璐璐</div>
                          <div className="text-[9px] text-amber-800 font-semibold mt-0.5">
                            {game.companionSkills.lulu.activeForNextCheck
                              ? '加护中'
                              : game.companionSkills.lulu.used
                              ? '已支援'
                              : '🌟致命一击'}
                          </div>
                        </div>
                      </button>

                      {/* 可可 */}
                      <button
                        type="button"
                        onClick={() => handleCallCompanion('gaming-koko')}
                        disabled={game.companionSkills.koko.used || game.status !== 'playing'}
                        className={`flex flex-col items-center justify-between p-2 rounded-xl border text-center transition cursor-pointer ${
                          game.companionSkills.koko.used
                            ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
                            : 'border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/60'
                        }`}
                      >
                        <span className="text-lg">🦊</span>
                        <div className="mt-1">
                          <div className="text-[11px] font-black text-slate-900">可可</div>
                          <div className="text-[9px] text-emerald-800 font-semibold mt-0.5">
                            {game.companionSkills.koko.used ? '已救援' : '❤️回8HP+10SAN'}
                          </div>
                        </div>
                      </button>

                      {/* 诺克斯 */}
                      <button
                        type="button"
                        onClick={() => handleCallCompanion('gaming-nox')}
                        disabled={game.companionSkills.nox.used || game.status !== 'playing'}
                        className={`flex flex-col items-center justify-between p-2 rounded-xl border text-center transition cursor-pointer ${
                          game.companionSkills.nox.activeForNextCheck
                            ? 'border-indigo-400 bg-indigo-100/70 shadow-xs ring-1 ring-indigo-300'
                            : game.companionSkills.nox.used
                            ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
                            : 'border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100/60'
                        }`}
                      >
                        <span className="text-lg">♟️</span>
                        <div className="mt-1">
                          <div className="text-[11px] font-black text-slate-900">诺克斯</div>
                          <div className="text-[9px] text-indigo-800 font-semibold mt-0.5">
                            {game.companionSkills.nox.activeForNextCheck
                              ? '推演中'
                              : game.companionSkills.nox.used
                              ? '已推演'
                              : '♟️胜率+25%'}
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* 3. 随身行囊与道具主动使用 */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="text-xs font-black text-slate-900 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Package size={14} className="text-amber-700" /> 随身行囊 ({game.character.inventory.length})
                      </span>
                    </div>

                    {game.character.inventory.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-400">
                        行囊空空如也，探索场景寻找宝藏吧
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {game.character.inventory.map((item, idx) => {
                          const itemDef = getItemDefinition(item);
                          const isConsumable = itemDef.category === 'consumable' || Boolean(itemDef.hpDelta || itemDef.sanDelta);

                          return (
                            <div
                              key={`${item}_${idx}`}
                              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2 shadow-2xs hover:border-slate-300 transition"
                            >
                              <div className="flex items-center gap-2 min-w-0 pr-2">
                                <span className="text-base shrink-0">{itemDef.icon}</span>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-900 truncate">
                                    {item}
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-medium truncate mt-0.5">
                                    {itemDef.description}
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleUseItem(item)}
                                disabled={game.status !== 'playing'}
                                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-black transition cursor-pointer ${
                                  isConsumable
                                    ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-2xs'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                {isConsumable ? '使用' : '检视'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* 自由行动输入框（吸底常驻在右侧底端） */}
                {game.status === 'playing' && currentNode && !currentNode.isEnding && (
                  <div className="shrink-0 border-t border-slate-200 bg-white p-3 space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-600 block">
                      💡 自由奇思行动 (守秘人临场判定)：
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={freeActionInput}
                        onChange={(e) => setFreeActionInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing && freeActionInput.trim()) {
                            e.preventDefault();
                            handleFreeActionSubmit();
                          }
                        }}
                        placeholder="如：点燃火把丢向书架、悄悄绕后偷袭..."
                        className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={handleFreeActionSubmit}
                        disabled={!freeActionInput.trim()}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40 transition cursor-pointer shadow-2xs shrink-0"
                      >
                        <Send size={13} />
                        <span>确认行动</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
