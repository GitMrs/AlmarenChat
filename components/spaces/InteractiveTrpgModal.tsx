'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronRight,
  Compass,
  Cpu,
  Dices,
  Eye,
  Flame,
  Gamepad2,
  Heart,
  HelpCircle,
  Key,
  Lightbulb,
  Loader2,
  Lock,
  Package,
  Play,
  Plus,
  RotateCcw,
  Scroll,
  Search,
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
  saveTrpgGame,
  loadSavedTrpgGame,
  clearSavedTrpgGame,
  setTrpgAiEnabled,
  AGENT_INFO,
  isChoiceAvailable,
  getSandboxRoomByNodeId,
  MANOR_CLUES,
  type TrpgGameState,
  type TrpgHistoryItem,
  type TrpgItemDefinition,
  type TrpgPlayMode,
  type SandboxRoom,
  type ManorClueDefinition,
} from '@/lib/trpg/engine.ts';
import { generateTrpgAiNarration } from '@/lib/trpg/ai-narrator';
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

const EMPTY_SPACE_AGENTS: Agent[] = [];
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
  spaceAgents = EMPTY_SPACE_AGENTS,
  onShareToSpace,
  initialScenarioId = 'coc_blackwood_manor',
}: InteractiveTrpgModalProps) {
  const [mounted, setMounted] = useState(false);

  // 模式：'setup' (选择剧本与角色卡) | 'in_game' (跑团进行中)
  const [mode, setMode] = useState<'setup' | 'in_game'>('setup');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(initialScenarioId);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [customHeroName, setCustomHeroName] = useState<string>('');
  const [selectedPlayMode, setSelectedPlayMode] = useState<TrpgPlayMode>('free');
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [isAiThinking, setIsAiThinking] = useState<boolean>(false);

  // 游戏核心状态
  const [game, setGame] = useState<TrpgGameState>(() => createTrpgGame(initialScenarioId));
  const [autoVoice, setAutoVoice] = useState(true);
  const [freeActionInput, setFreeActionInput] = useState('');

  // 右侧辅助面板 Tab: 'clues' | 'inventory' | 'choices' | 'companions'
  const [rightPanelTab, setRightPanelTab] = useState<'clues' | 'inventory' | 'choices' | 'companions'>('clues');
  const [selectedClueId, setSelectedClueId] = useState<string | null>(null);

  // 骰子动效状态
  const [isRollingAnimation, setIsRollingAnimation] = useState(false);
  const [rollingDisplayNum, setRollingDisplayNum] = useState<number>(20);

  // 道具与援护使用反馈气泡提示
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // 本地存储的未完成对局存档
  const [savedGame, setSavedGame] = useState<TrpgGameState | null>(null);

  const { play: playTTS, stop: stopTTS, isPlaying: isSpeaking } = useTTS();
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const rollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const noticeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortAiRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 弹窗开启时检测本地未完成对局，并锁定外部滚动
  useEffect(() => {
    if (isOpen) {
      const existingSave = loadSavedTrpgGame();
      if (existingSave && (existingSave.status === 'playing' || existingSave.status === 'rolling')) {
        setSavedGame(existingSave);
        setSelectedPlayMode(existingSave.playMode || 'free');
        setAiEnabled(existingSave.aiEnabled ?? true);
      } else {
        setSavedGame(null);
      }
      setMode('setup');
      setFreeActionInput('');
      setIsRollingAnimation(false);
      setIsAiThinking(false);
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
      if (abortAiRef.current) abortAiRef.current.abort();
      setIsRollingAnimation(false);
      setIsAiThinking(false);
    }
  }, [isOpen, stopTTS]);

  // 进行中实时无感自动保存游戏进度
  useEffect(() => {
    if (mode === 'in_game') {
      if (game.status === 'playing' || game.status === 'rolling') {
        saveTrpgGame(game);
      } else if (game.status === 'victory' || game.status === 'game_over') {
        clearSavedTrpgGame();
        setSavedGame(null);
      }
    }
  }, [game, mode]);

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
  }, [game.history.length, isAiThinking, mode, scrollToBottom]);

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

  // 恢复未完成的对局存档
  const handleResumeSavedGame = () => {
    if (!savedGame) return;
    stopTTS();
    if (abortAiRef.current) abortAiRef.current.abort();
    setIsAiThinking(false);
    setGame(savedGame);
    setSelectedScenarioId(savedGame.scenarioId);
    setSelectedPlayMode(savedGame.playMode || 'free');
    setAiEnabled(savedGame.aiEnabled ?? true);
    setMode('in_game');
    setFreeActionInput('');
    setIsRollingAnimation(false);
    setRightPanelTab(savedGame.playMode === 'classic' ? 'choices' : 'clues');
    triggerNotice(`已继续《${savedGame.scenario.title}》的冒险进度！`);
  };

  // 放弃旧存档并清除
  const handleDiscardSavedGame = () => {
    clearSavedTrpgGame();
    setSavedGame(null);
    triggerNotice('已清除旧存档，可挑选新剧本开启全新冒险');
  };

  // 开启全新跑团冒险
  const handleStartAdventure = () => {
    stopTTS();
    if (abortAiRef.current) abortAiRef.current.abort();
    setIsAiThinking(false);
    clearSavedTrpgGame();
    setSavedGame(null);
    const newGame = createTrpgGame(selectedScenarioId, selectedPresetId, customHeroName, selectedPlayMode, aiEnabled);
    setGame(newGame);
    saveTrpgGame(newGame);
    setMode('in_game');
    setFreeActionInput('');
    setActionNotice(null);
    setRightPanelTab(selectedPlayMode === 'classic' ? 'choices' : 'clues');
  };

  // 重置 / 返回选单
  const handleResetToSetup = () => {
    stopTTS();
    if (rollingIntervalRef.current) clearInterval(rollingIntervalRef.current);
    setIsRollingAnimation(false);
    setActionNotice(null);
    const existingSave = loadSavedTrpgGame();
    if (existingSave && (existingSave.status === 'playing' || existingSave.status === 'rolling')) {
      setSavedGame(existingSave);
    }
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

  // 切换 AI 守秘人模式 / 本地沙盘模式
  const handleToggleAiEngine = () => {
    if (mode === 'in_game') {
      const nextAiState = !game.aiEnabled;
      setAiEnabled(nextAiState);
      const updatedGame = setTrpgAiEnabled(game, nextAiState);
      setGame(updatedGame);
      saveTrpgGame(updatedGame);
      triggerNotice(
        nextAiState
          ? '🤖 已切换至【AI 守秘人模式】（接入真实大模型深度共创演绎）'
          : '⚡ 已切换至【本地沙盘模式】（0延迟 · 0 Token 极速推演）'
      );
    } else {
      const nextAiState = !aiEnabled;
      setAiEnabled(nextAiState);
      triggerNotice(
        nextAiState
          ? '🤖 已预设【AI 守秘人模式】（深度文学共创演绎）'
          : '⚡ 已预设【本地沙盘模式】（极速纯本地推演）'
      );
    }
  };

  // 玩家执行自由行动
  const handleFreeActionSubmit = async (overrideText?: string) => {
    const textToExecute = (overrideText !== undefined ? overrideText : freeActionInput).trim();
    if (!textToExecute || isRollingAnimation || isAiThinking) return;

    setFreeActionInput('');

    // 1. 本地规则状态机即刻判定与推进（保证数值与规则 100% 正确）
    const nextState = performFreeAction(game, textToExecute);
    setGame(nextState);

    // 2. 如果开启了 AI 守秘人，并且当前行动无需掷骰（直接探索生效），调用大语言模型进行小说级润色
    if (nextState.aiEnabled && nextState.status === 'playing' && nextState.history.length > 0) {
      const lastItem = nextState.history[nextState.history.length - 1];
      const localNarration = lastItem.narration;

      if (abortAiRef.current) abortAiRef.current.abort();
      const controller = new AbortController();
      abortAiRef.current = controller;

      setIsAiThinking(true);
      try {
        const aiResult = await generateTrpgAiNarration(
          nextState,
          textToExecute,
          null,
          localNarration,
          controller.signal
        );

        if (aiResult && aiResult.narration) {
          setGame((prev) => {
            if (prev.history.length === 0) return prev;
            const updatedHistory = [...prev.history];
            const target = updatedHistory[updatedHistory.length - 1];
            const companionSpeech = aiResult.companionSpeech
              ? {
                  agentId: aiResult.companionSpeech.agentId,
                  agentName: AGENT_INFO[aiResult.companionSpeech.agentId]?.name || '可可',
                  agentAvatar: AGENT_INFO[aiResult.companionSpeech.agentId]?.avatar || '🦊',
                  text: aiResult.companionSpeech.text,
                }
              : target.companionSpeech;

            updatedHistory[updatedHistory.length - 1] = {
              ...target,
              narration: aiResult.narration,
              companionSpeech,
            };
            return {
              ...prev,
              history: updatedHistory,
            };
          });
        }
      } catch (err) {
        console.warn('AI free action generation error:', err);
      } finally {
        setIsAiThinking(false);
      }
    }
  };

  // 掷骰子动画与结算
  const handleRollDice = () => {
    if (isRollingAnimation || !game.pendingCheck || isAiThinking) return;

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

        // 如果启用了 AI 守秘人大脑，调用大模型润色刚刚由骰点决定的场景叙事与伴聊
        if (nextState.aiEnabled && nextState.history.length > 0 && nextState.lastChoice) {
          const lastItem = nextState.history[nextState.history.length - 1];
          const localNarration = lastItem.narration;
          const actionLabel = nextState.lastChoice.label;

          if (abortAiRef.current) abortAiRef.current.abort();
          const controller = new AbortController();
          abortAiRef.current = controller;

          setIsAiThinking(true);
          generateTrpgAiNarration(
            nextState,
            actionLabel,
            nextState.lastCheckResult,
            localNarration,
            controller.signal
          )
            .then((aiResult) => {
              if (aiResult && aiResult.narration) {
                setGame((prev) => {
                  if (prev.history.length === 0) return prev;
                  const updatedHistory = [...prev.history];
                  const target = updatedHistory[updatedHistory.length - 1];
                  const companionSpeech = aiResult.companionSpeech
                    ? {
                        agentId: aiResult.companionSpeech.agentId,
                        agentName: AGENT_INFO[aiResult.companionSpeech.agentId]?.name || '可可',
                        agentAvatar: AGENT_INFO[aiResult.companionSpeech.agentId]?.avatar || '🦊',
                        text: aiResult.companionSpeech.text,
                      }
                    : target.companionSpeech;

                  updatedHistory[updatedHistory.length - 1] = {
                    ...target,
                    narration: aiResult.narration,
                    companionSpeech,
                  };
                  return {
                    ...prev,
                    history: updatedHistory,
                  };
                });
              }
            })
            .catch((err) => {
              console.warn('AI dice roll narrative error:', err);
            })
            .finally(() => {
              setIsAiThinking(false);
            });
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

  // 映射当前沙盘房间（布莱克伍德古宅）
  const sandboxRoom = game.scenarioId === 'coc_blackwood_manor'
    ? getSandboxRoomByNodeId(game.currentNodeId)
    : null;

  // 游玩模式下右侧面板有效激活 Tab（自由共创模式完全隐藏预设分支 Tab）
  const effectiveRightTab = (game.playMode === 'free' && rightPanelTab === 'choices') ? 'clues' : rightPanelTab;

  // 计算当前调查员已探明线索
  const discoveredClues: ManorClueDefinition[] = Object.values(MANOR_CLUES).filter((clue) =>
    game.evidence.some(
      (ev) => ev === clue.title || ev === clue.id || ev.includes(clue.title) || clue.title.includes(ev) || ev.includes(clue.id)
    )
  );
  game.evidence.forEach((ev, idx) => {
    if (!discoveredClues.some((c) => c.title === ev || c.id === ev)) {
      discoveredClues.push({
        id: `ev_${idx}`,
        title: ev,
        icon: '🔍',
        sourceRoom: '现场调查',
        text: `在古宅探索过程中搜集到的关键线索与实物证据：【${ev}】。`,
      });
    }
  });

  // 章节路线指引
  const renderChapterProgress = () => {
    if (game.scenario.id === 'coc_blackwood_manor') {
      return (
        <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium overflow-x-auto py-0.5">
          <span className={`px-1.5 py-0.5 rounded font-bold ${currentNode?.id === 'node_foyer' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'}`}>
            1.门厅玄关
          </span>
          <span className="text-slate-300">➔</span>
          <span className={`px-1.5 py-0.5 rounded font-bold ${['node_dining', 'node_gallery', 'node_study', 'node_attic'].includes(currentNode?.id || '') ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'text-slate-400'}`}>
            2.庄园探索(宴会厅/温室/书斋/阁楼)
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
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-black border ${
                  (mode === 'setup' ? selectedPlayMode : game.playMode) === 'free'
                    ? 'bg-amber-50 text-amber-900 border-amber-300'
                    : 'bg-indigo-50 text-indigo-900 border-indigo-300'
                }`}>
                  {(mode === 'setup' ? selectedPlayMode : game.playMode) === 'free' ? '🎲 自由共创' : '📜 经典抉择'}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                  {mode === 'setup' ? '配置角色与模式' : `第 ${game.turnCount} 幕 · 探险中`}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium truncate max-w-md mt-0.5">
                {mode === 'setup' ? activeScenario.tagline : game.scenario.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* AI 守秘人双核开关 */}
            <button
              type="button"
              onClick={handleToggleAiEngine}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition cursor-pointer border ${
                (mode === 'in_game' ? game.aiEnabled : aiEnabled)
                  ? 'bg-purple-50 text-purple-800 border-purple-300 hover:bg-purple-100 shadow-2xs'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
              }`}
              title={
                (mode === 'in_game' ? game.aiEnabled : aiEnabled)
                  ? '当前已开启 AI 守秘人大脑（点击切换为本地极速沙盘）'
                  : '当前为本地极速规则沙盘（点击开启 AI 守秘人）'
              }
            >
              {(mode === 'in_game' ? game.aiEnabled : aiEnabled) ? (
                <Sparkles size={14} className="text-purple-600 fill-purple-600/20 animate-pulse" />
              ) : (
                <Cpu size={14} className="text-slate-500" />
              )}
              <span className="hidden sm:inline">
                {(mode === 'in_game' ? game.aiEnabled : aiEnabled) ? 'AI 守秘人' : '本地沙盘'}
              </span>
            </button>

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

              {/* 当前大脑引擎指示与快速切换 */}
              <button
                type="button"
                onClick={handleToggleAiEngine}
                className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-md border font-bold transition cursor-pointer shadow-2xs ${
                  game.aiEnabled
                    ? 'bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100'
                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                }`}
                title={game.aiEnabled ? '当前为 AI 守秘人模式，点击切换为本地极速沙盘' : '当前为本地极速沙盘，点击切换为 AI 守秘人'}
              >
                {game.aiEnabled ? (
                  <Sparkles size={11} className="text-purple-600 animate-pulse" />
                ) : (
                  <Cpu size={11} className="text-slate-500" />
                )}
                <span>{game.aiEnabled ? 'AI 守秘人' : '本地沙盘'}</span>
              </button>

              {/* 实时自动保存指示 */}
              <div
                className="flex items-center gap-1.5 text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md shadow-2xs"
                title="游戏进度已实时自动保存在本地，随时可安心关闭并在下次一键恢复"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-bold">进度实时保存中</span>
              </div>
            </div>
          </div>
        )}

        {mode === 'in_game' && (
          <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 bg-white px-4 py-1.5 sm:px-6 text-[10px] text-slate-500">
            <span className="font-black text-slate-700">第 {game.chapter} 章</span>
            <span className="font-mono">庄园时间 {Math.floor(game.clockMinutes / 60).toString().padStart(2, '0')}:{(game.clockMinutes % 60).toString().padStart(2, '0')}</span>
            <span className="font-semibold">证据 {game.evidence.length} 条</span>
            {game.evidence.length > 0 && (
              <span className="min-w-0 truncate text-slate-400" title={game.evidence.join('、')}>
                {game.evidence.slice(-3).join(' · ')}
              </span>
            )}
            {Object.keys(game.npcs).length > 0 && (
              <span className="ml-auto font-semibold text-indigo-600">
                NPC 状态 {Object.values(game.npcs).filter((npc) => npc.alive).length}/{Object.keys(game.npcs).length} 存活
              </span>
            )}
          </div>
        )}

        {/* 核心内容区 */}
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
          {mode === 'setup' ? (
            /* ==================== 1. 剧本与角色选择界面 ==================== */
            <div className="flex-1 flex flex-col min-h-0 bg-[#fbfaf7]">
              {/* 向上滚动的内容区 */}
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                
                {/* 发现未完成的冒险进度卡片 */}
                {savedGame && (
                  <div className="rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-500/10 via-amber-100/40 to-orange-500/10 p-4 sm:p-5 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <span className="text-3xl shrink-0 p-2.5 rounded-2xl bg-amber-500/20 border border-amber-300 shadow-inner">
                        {savedGame.character.avatar || '📜'}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-amber-600 text-white font-black text-[10px] px-2 py-0.5 shadow-2xs">
                            发现进行中的冒险存档
                          </span>
                          <span className={`rounded-md text-[10px] font-black px-2 py-0.5 border ${
                            savedGame.playMode === 'classic'
                              ? 'bg-indigo-100 text-indigo-900 border-indigo-200'
                              : 'bg-amber-100 text-amber-900 border-amber-200'
                          }`}>
                            {savedGame.playMode === 'classic' ? '📜 经典抉择模式' : '🎲 自由共创模式'}
                          </span>
                          <span className={`rounded-md text-[10px] font-black px-2 py-0.5 border ${
                            savedGame.aiEnabled !== false
                              ? 'bg-purple-100 text-purple-900 border-purple-200'
                              : 'bg-slate-100 text-slate-800 border-slate-200'
                          }`}>
                            {savedGame.aiEnabled !== false ? '🤖 AI 深度大脑' : '⚡ 本地沙盘'}
                          </span>
                          <span className="text-xs font-bold text-slate-500 font-mono">
                            第 {savedGame.turnCount} 幕 · 探险中
                          </span>
                        </div>
                        <h4 className="text-sm font-black text-slate-900 mt-1">
                          《{savedGame.scenario.title}》· {savedGame.character.name}（{savedGame.character.className}）
                        </h4>
                        <p className="text-[11px] text-slate-600 mt-0.5 font-medium">
                          📍 停留在：{savedGame.scenario.nodes[savedGame.currentNodeId]?.title || savedGame.scenario.nodes[savedGame.currentNodeId]?.location || '探索途中'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[11px] font-mono">
                          <span className="text-rose-700 font-bold bg-white/90 border border-rose-200 px-2 py-0.5 rounded-md shadow-2xs">
                            ❤️ HP {savedGame.character.hp}/{savedGame.character.maxHp}
                          </span>
                          {savedGame.character.san !== undefined && (
                            <span className="text-purple-800 font-bold bg-white/90 border border-purple-200 px-2 py-0.5 rounded-md shadow-2xs">
                              🧠 SAN {savedGame.character.san}/{savedGame.character.maxSan || 100}
                            </span>
                          )}
                          <span className="text-amber-900 font-bold bg-white/90 border border-amber-200 px-2 py-0.5 rounded-md shadow-2xs">
                            🎒 背包 {savedGame.character.inventory.length} 件
                          </span>
                          <span className="text-slate-700 font-bold bg-white/90 border border-slate-200 px-2 py-0.5 rounded-md shadow-2xs">
                            ✨ 幸运: {savedGame.character.luck}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={handleResumeSavedGame}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-5 py-2.5 text-xs font-black text-white hover:brightness-105 shadow-md shadow-amber-500/20 active:scale-98 transition cursor-pointer"
                      >
                        <Play size={14} className="fill-white" />
                        <span>▶ 继续本次冒险</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDiscardSavedGame}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-500 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition cursor-pointer shadow-2xs"
                        title="放弃旧存档并清除"
                      >
                        <span>放弃存档</span>
                      </button>
                    </div>
                  </div>
                )}

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

                {/* 第 3 步：挑选本次冒险的游玩模式 */}
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Gamepad2 size={17} className="text-amber-600" />
                      第 3 步：挑选本次冒险的游玩模式
                    </h3>
                    <span className="text-[11px] text-slate-500 font-medium">支持随时关闭，进度无感自动保存</span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {/* 模式 1：沉浸自由共创模式 */}
                    <div
                      onClick={() => setSelectedPlayMode('free')}
                      className={`group relative flex flex-col justify-between rounded-xl border p-4 transition-all cursor-pointer ${
                        selectedPlayMode === 'free'
                          ? 'border-2 border-amber-500 bg-amber-50/40 shadow-sm ring-2 ring-amber-200'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">🎲</span>
                            <h4 className="text-sm font-black text-slate-900">
                              沉浸自由共创模式
                            </h4>
                          </div>
                          <span className="rounded-md bg-amber-600 px-2 py-0.5 text-[10px] font-black text-white shadow-2xs">
                            高自由度 · 推荐
                          </span>
                        </div>
                        <div className="mt-1.5 text-[11px] font-bold text-amber-800">
                          纯正 TRPG 跑团体验 · 守秘人实时动态裁决
                        </div>
                        <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                          摆脱预设单选题束缚！随心所欲输入你想执行的任意动作（撬暗格、用放大镜勘验血迹、潜行背刺、念咒封印等）。守秘人将根据场景、道具、技能与掷骰实时生成独一无二的沉浸故事与支线分支。
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold">
                        <span className="text-slate-500 font-medium">自由行动 · 探索互动 · 线索手账</span>
                        <span className={selectedPlayMode === 'free' ? 'text-amber-700' : 'text-slate-400'}>
                          {selectedPlayMode === 'free' ? '✓ 当前已选中' : '点击选择'}
                        </span>
                      </div>
                    </div>

                    {/* 模式 2：经典剧情抉择模式 */}
                    <div
                      onClick={() => setSelectedPlayMode('classic')}
                      className={`group relative flex flex-col justify-between rounded-xl border p-4 transition-all cursor-pointer ${
                        selectedPlayMode === 'classic'
                          ? 'border-2 border-indigo-500 bg-indigo-50/40 shadow-sm ring-2 ring-indigo-200'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">📜</span>
                            <h4 className="text-sm font-black text-slate-900">
                              经典剧情抉择模式
                            </h4>
                          </div>
                          <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-black text-indigo-800 border border-indigo-200">
                            传统分支单选
                          </span>
                        </div>
                        <div className="mt-1.5 text-[11px] font-bold text-indigo-700">
                          经典单选剧情流 · 快速体验完整主线
                        </div>
                        <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                          经典视觉小说与互动剧本玩法。在右侧提供精心设计的预设分支卡片，直接点击选项即可推进主线并触发对应技能骰子检定，适合新手快速通关体验。
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold">
                        <span className="text-slate-500 font-medium">经典选项 · 道具条件 · 线性推进</span>
                        <span className={selectedPlayMode === 'classic' ? 'text-indigo-700' : 'text-slate-400'}>
                          {selectedPlayMode === 'classic' ? '✓ 当前已选中' : '点击选择'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 第 4 步：AI 大模型守秘人大脑（智能双核开关） */}
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Sparkles size={17} className="text-purple-600" />
                      第 4 步：选择守秘人大脑引擎（智能双核开关）
                    </h3>
                    <span className="text-[11px] text-slate-500 font-medium">
                      跑团中可随时在顶部开关无缝自由切换
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {/* 引擎 1：接入 AI 大模型守秘人 */}
                    <div
                      onClick={() => setAiEnabled(true)}
                      className={`group relative flex flex-col justify-between rounded-xl border p-4 transition-all cursor-pointer ${
                        aiEnabled
                          ? 'border-2 border-purple-500 bg-purple-50/40 shadow-sm ring-2 ring-purple-200'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">🤖</span>
                            <h4 className="text-sm font-black text-slate-900">
                              接入 AI 大模型守秘人
                            </h4>
                          </div>
                          <span className="rounded-md bg-purple-100 px-2 py-0.5 text-[10px] font-black text-purple-800 border border-purple-200">
                            深度共创 · 推荐
                          </span>
                        </div>
                        <div className="mt-1.5 text-[11px] font-bold text-purple-700">
                          真实 LLM 大模型推理 · 拟真克苏鲁/奇幻文风 · 角色动态互动
                        </div>
                        <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                          接入真实大语言模型作为守秘人与队友。针对你的任意自由行动现场生成文学级剧情叙事，璐璐与可可实时个性吐槽与援护。内置 9 秒超时与本地沙盘兜底保护。
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold">
                        <span className="text-slate-500 font-medium">实时文学流 · 角色鲜活对话 · 沙盘兜底</span>
                        <span className={aiEnabled ? 'text-purple-700' : 'text-slate-400'}>
                          {aiEnabled ? '✓ 当前已选中' : '点击选择'}
                        </span>
                      </div>
                    </div>

                    {/* 引擎 2：本地极速规则沙盘 */}
                    <div
                      onClick={() => setAiEnabled(false)}
                      className={`group relative flex flex-col justify-between rounded-xl border p-4 transition-all cursor-pointer ${
                        !aiEnabled
                          ? 'border-2 border-amber-500 bg-amber-50/40 shadow-sm ring-2 ring-amber-200'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">⚡</span>
                            <h4 className="text-sm font-black text-slate-900">
                              本地极速规则沙盘
                            </h4>
                          </div>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-800 border border-slate-300">
                            零延迟 · 零 Token
                          </span>
                        </div>
                        <div className="mt-1.5 text-[11px] font-bold text-slate-700">
                          纯本地沙盘推演 · 0ms 即时响应 · 100% 离线可用
                        </div>
                        <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                          采用纯本地确定性规则沙盘引擎，无需请求大模型 API，不消耗任何 Token。根据房间物理环境、实体线索与骰子检定即时推演，适合快速体验与无网络环境。
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold">
                        <span className="text-slate-500 font-medium">即时反馈 · 离线畅玩 · 0 Token 消耗</span>
                        <span className={!aiEnabled ? 'text-amber-700' : 'text-slate-400'}>
                          {!aiEnabled ? '✓ 当前已选中' : '点击选择'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 吸底常驻的大型醒目开始冒险按钮条 */}
              <div className="shrink-0 border-t border-slate-200 bg-white px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-md">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="text-slate-500 font-medium">当前准备：</span>
                  <span className="font-black text-slate-900">《{activeScenario.title}》</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-bold text-amber-700">
                    {customHeroName || activePreset?.name} ({activePreset?.className})
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                    selectedPlayMode === 'free'
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : 'bg-indigo-100 text-indigo-900 border-indigo-300'
                  }`}>
                    {selectedPlayMode === 'free' ? '🎲 沉浸自由共创' : '📜 经典剧情抉择'}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                    aiEnabled
                      ? 'bg-purple-100 text-purple-900 border-purple-300'
                      : 'bg-slate-100 text-slate-800 border-slate-300'
                  }`}>
                    {aiEnabled ? '🤖 AI 守秘人: 开启' : '⚡ 本地沙盘: 极速'}
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

                  {/* AI 守秘人实时构思与文学演绎动效 */}
                  {isAiThinking && (
                    <div className="rounded-2xl border border-purple-200/90 bg-gradient-to-r from-purple-50/90 via-indigo-50/60 to-amber-50/50 p-4 shadow-sm animate-pulse space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-purple-600 text-white shadow-sm shrink-0">
                          <Sparkles size={16} className="animate-spin" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-purple-950">
                              🤖 AI 守秘人大脑正在构思命运叙事...
                            </span>
                            <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                              深度文学流演绎
                            </span>
                          </div>
                          <p className="text-[11px] text-purple-800/80 mt-0.5 truncate">
                            正在结合当前场景、道具与掷骰判定，为可可与璐璐编织鲜活故事...
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

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

                {/* 底部常驻：自由行动宣言与剧情共创中枢 */}
                {game.status === 'playing' && currentNode && !currentNode.isEnding && (
                  <div className="shrink-0 border-t border-amber-200/90 bg-white p-3.5 space-y-2.5 shadow-sm">
                    {/* 1. 守秘人场景灵感与可交互实体栏 */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-amber-950 flex items-center gap-1">
                          <Lightbulb size={13} className="text-amber-600" />
                          {game.playMode === 'free' ? (
                            <span>💡 自由共创中枢 · 守秘人灵感行动建议 (点击填入或快速推演)</span>
                          ) : (
                            <span>💡 自由行动探索 (亦可直接在右侧点击【预设分支】)</span>
                          )}
                        </span>
                        {sandboxRoom && (
                          <span className="text-[10px] text-slate-500 font-semibold">
                            当前沙盘：{sandboxRoom.name}
                          </span>
                        )}
                      </div>

                      {/* 场景可交互实体 Chips */}
                      {sandboxRoom && sandboxRoom.interactables.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] text-slate-400 font-semibold">环境实体:</span>
                          {sandboxRoom.interactables.map((obj, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => {
                                setFreeActionInput(`仔细勘验【${obj.name}】`);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-amber-200 bg-amber-50/70 hover:bg-amber-100/90 text-amber-950 text-[10px] font-bold transition cursor-pointer"
                              title={obj.description}
                            >
                              <span>🔍</span>
                              <span>{obj.name}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* 2~3 个动态灵感行动建议 Chips */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(sandboxRoom?.defaultSuggestions || [
                          '利用随身道具仔细探查周围环境',
                          '放轻脚步，潜行摸索前路',
                          '握紧武器，戒备未知的动静',
                        ]).map((sug, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setFreeActionInput(sug);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] rounded-lg border border-slate-200 bg-slate-50 hover:border-amber-400 hover:bg-amber-50/70 px-2.5 py-1 text-slate-700 hover:text-amber-950 font-medium transition cursor-pointer text-left"
                          >
                            <span className="text-amber-600 font-bold">💡</span>
                            <span className="line-clamp-1">{sug}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 2. 自由行动文本输入与执行按钮 */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
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
                          placeholder={
                            game.playMode === 'free'
                              ? '自由描述你想做的一切（如：拿火钳撬锁、用放大镜查血迹、贴墙潜行突袭、施展封印秘仪...）'
                              : '自由输入行动（或直接在右侧【预设分支】点击选项推进主线）...'
                          }
                          className="w-full rounded-xl border border-amber-300 bg-amber-50/20 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:bg-white focus:outline-hidden shadow-2xs font-medium"
                        />
                        {freeActionInput && (
                          <button
                            type="button"
                            onClick={() => setFreeActionInput('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleFreeActionSubmit()}
                        disabled={!freeActionInput.trim() || isRollingAnimation || isAiThinking}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 text-xs font-black text-white hover:brightness-105 active:scale-98 disabled:opacity-40 transition cursor-pointer shadow-md shadow-amber-500/20 shrink-0"
                      >
                        {isAiThinking ? (
                          <Loader2 size={14} className="animate-spin text-white" />
                        ) : (
                          <Sparkles size={14} className="fill-white" />
                        )}
                        <span>{isAiThinking ? 'AI 构思中...' : game.playMode === 'free' ? '执行行动 · 守秘人裁决' : '执行自由行动'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 检定等待提示 */}
                {game.status === 'rolling' && (
                  <div className="shrink-0 border-t border-amber-200 bg-amber-50/90 px-4 py-3 flex items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <Sparkles size={18} className="text-amber-600 animate-pulse shrink-0" />
                      <div>
                        <span className="text-xs font-black text-amber-950 block">
                          🎲 守秘人已判定！请在右侧点击掷出命运之骰
                        </span>
                        <span className="text-[11px] text-slate-600 font-medium">
                          检定项目：【{game.pendingCheck?.skillName}】· 成功率 {game.pendingCheck?.targetValue}%
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRollDice}
                      disabled={isRollingAnimation || isAiThinking}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-4 py-2 text-xs font-black text-white hover:brightness-105 shadow-md shadow-amber-500/20 active:scale-98 disabled:opacity-50 cursor-pointer"
                    >
                      {isAiThinking ? (
                        <Loader2 size={15} className="animate-spin text-white" />
                      ) : (
                        <Dices size={15} />
                      )}
                      <span>{isAiThinking ? 'AI 演绎中...' : isRollingAnimation ? '翻滚中...' : '掷出骰子'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 右侧：命运罗盘、线索手账、随身背包与战术支援 */}
              <div className="shrink-0 w-full lg:w-[380px] flex flex-col min-h-0 bg-white overflow-hidden">
                
                {/* 骰子动态摇号核心区（吸顶固定） */}
                <div className="shrink-0 border-b border-slate-200 p-3 bg-slate-50 text-center space-y-2">
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
                      className={`relative flex h-18 w-18 items-center justify-center rounded-2xl border-2 transition-all duration-300 ${
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
                    <div className="space-y-1.5">
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
                        disabled={isRollingAnimation || isAiThinking}
                        className="w-full inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-xs font-black text-white shadow-md shadow-amber-500/20 hover:brightness-105 active:scale-98 transition disabled:opacity-50 cursor-pointer"
                      >
                        {isAiThinking ? (
                          <Loader2 size={15} className="animate-spin text-white" />
                        ) : (
                          <Dices size={15} />
                        )}
                        <span>{isAiThinking ? 'AI 演绎中...' : isRollingAnimation ? '命运翻滚中...' : '🎲 掷出命运之骰！'}</span>
                      </button>
                    </div>
                  ) : (
                    <div>
                      {/* 若上次检定未成功且有剩余幸运点，支持重掷 */}
                      {game.lastCheckResult && !game.lastCheckResult.isSuccess && game.character.luck > 0 && game.status === 'playing' ? (
                        <button
                          type="button"
                          onClick={handleRerollLuck}
                          className="w-full inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-900 hover:bg-amber-100 transition cursor-pointer shadow-2xs"
                        >
                          <Sparkles size={13} className="text-amber-600" />
                          <span>消耗 1 点命运点逆转乾坤 (余 {game.character.luck})</span>
                        </button>
                      ) : (
                        <p className="text-[11px] text-slate-500 font-medium">
                          {game.status === 'playing' ? '在左侧自由行动或查看下方手账' : '冒险已抵达终局'}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* 右侧功能 Tab 导航栏 */}
                <div className="shrink-0 flex items-center border-b border-slate-200 bg-slate-100/80 p-1 gap-1 text-xs font-bold">
                  {game.playMode === 'classic' && (
                    <button
                      type="button"
                      onClick={() => setRightPanelTab('choices')}
                      className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer flex items-center justify-center gap-1 ${
                        effectiveRightTab === 'choices'
                          ? 'bg-white text-indigo-950 font-black shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Swords size={12} className="text-indigo-600" />
                      <span>预设分支</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setRightPanelTab('clues')}
                    className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer flex items-center justify-center gap-1 ${
                      effectiveRightTab === 'clues'
                        ? 'bg-white text-amber-950 font-black shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Search size={12} className="text-amber-600" />
                    <span>线索手账</span>
                    <span className="text-[10px] px-1 py-0.2 rounded-full bg-amber-100 text-amber-800">
                      {discoveredClues.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRightPanelTab('inventory')}
                    className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer flex items-center justify-center gap-1 ${
                      effectiveRightTab === 'inventory'
                        ? 'bg-white text-amber-950 font-black shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Package size={12} className="text-amber-700" />
                    <span>行囊</span>
                    <span className="text-[10px] px-1 py-0.2 rounded-full bg-slate-200 text-slate-700">
                      {game.character.inventory.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRightPanelTab('companions')}
                    className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer flex items-center justify-center gap-1 ${
                      effectiveRightTab === 'companions'
                        ? 'bg-white text-amber-950 font-black shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <ShieldCheck size={12} className="text-emerald-600" />
                    <span>援护</span>
                  </button>
                </div>

                {/* Tab 内容区 */}
                <div className="min-h-0 flex-1 overflow-y-auto p-3.5 space-y-3 font-sans text-xs">
                  
                  {/* Tab 1: 🔍 调查员线索手账 (Clue Notebook) */}
                  {effectiveRightTab === 'clues' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                        <span className="font-black text-slate-900 flex items-center gap-1.5">
                          <Search size={14} className="text-amber-600" /> 调查员线索手账
                        </span>
                        <span className="text-[10px] text-amber-800 font-bold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                          已探明 {discoveredClues.length} 条线索
                        </span>
                      </div>

                      {discoveredClues.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center space-y-2">
                          <Search size={24} className="mx-auto text-slate-400 opacity-60" />
                          <h5 className="text-xs font-bold text-slate-700">暂未探明核心线索</h5>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            在左侧自由输入行动（如搜查座钟、勘验地毯泥迹、破译手稿）即可解锁古宅深层线索与破局之道！
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {discoveredClues.map((clue) => {
                            const isSelected = selectedClueId === clue.id;
                            return (
                              <div
                                key={clue.id}
                                onClick={() => setSelectedClueId(isSelected ? null : clue.id)}
                                className={`rounded-xl border p-3 transition cursor-pointer ${
                                  isSelected
                                    ? 'border-amber-400 bg-amber-50/60 shadow-xs ring-1 ring-amber-300'
                                    : 'border-slate-200 bg-white hover:border-amber-300 hover:shadow-2xs'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base">{clue.icon}</span>
                                    <span className="font-black text-slate-900 text-xs">
                                      {clue.title}
                                    </span>
                                  </div>
                                  {clue.sourceRoom && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold shrink-0">
                                      {clue.sourceRoom}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1.5 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">
                                  {clue.text}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab 2: 🎒 随身行囊 (Inventory) */}
                  {effectiveRightTab === 'inventory' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                        <span className="font-black text-slate-900 flex items-center gap-1.5">
                          <Package size={14} className="text-amber-700" /> 随身行囊道具
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono font-bold">
                          容量：{game.character.inventory.length} / 12
                        </span>
                      </div>

                      {game.character.inventory.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-[11px] text-slate-400">
                          行囊空空如也，探索场景寻找宝藏吧
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {game.character.inventory.map((item, idx) => {
                            const itemDef = getItemDefinition(item);
                            const isConsumable = itemDef.category === 'consumable' || Boolean(itemDef.hpDelta || itemDef.sanDelta);

                            return (
                              <div
                                key={`${item}_${idx}`}
                                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xs hover:border-slate-300 transition"
                              >
                                <div className="flex items-center gap-2 min-w-0 pr-2">
                                  <span className="text-xl shrink-0">{itemDef.icon}</span>
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
                  )}

                  {/* Tab 3: 📜 预设分支抉择 (Preset Choices) */}
                  {effectiveRightTab === 'choices' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                        <span className="font-black text-slate-900 flex items-center gap-1.5">
                          <Swords size={14} className="text-amber-600" /> 常规预设分支
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold">
                          {game.status === 'rolling' ? '等待掷骰' : '可选分支'}
                        </span>
                      </div>

                      {game.status === 'playing' && currentNode && !currentNode.isEnding && (
                        <div className="space-y-2">
                          {currentNode.choices.map((choice) => {
                            const hasReq = isChoiceAvailable(game, choice);

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
                                {!hasReq && choice.requiredItem && !game.character.inventory.some((it) => it.includes(choice.requiredItem!)) && (
                                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-rose-600 font-bold">
                                    <Lock size={12} />
                                    <span>需要道具：【{choice.requiredItem}】</span>
                                  </div>
                                )}
                                {!hasReq && choice.requires?.flags?.some((flag) => !game.flags[flag]) && (
                                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-rose-600 font-bold">
                                    <Lock size={12} />
                                    <span>尚未满足剧情线索条件</span>
                                  </div>
                                )}
                                {!hasReq && choice.requires?.evidence?.some((item) => !game.evidence.includes(item)) && (
                                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-rose-600 font-bold">
                                    <Lock size={12} />
                                    <span>尚未掌握必要证据</span>
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
                  )}

                  {/* Tab 4: 🤝 队友战术援护 (Companion Assist) */}
                  {effectiveRightTab === 'companions' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                        <span className="flex items-center gap-1.5 font-black text-slate-900">
                          <ShieldCheck size={14} className="text-indigo-600" /> 队友战术援护 (每局限 1 次)
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {/* 璐璐 */}
                        <div
                          className={`p-3 rounded-xl border transition ${
                            game.companionSkills.lulu.activeForNextCheck
                              ? 'border-amber-400 bg-amber-100/70 shadow-xs ring-1 ring-amber-300'
                              : game.companionSkills.lulu.used
                              ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60'
                              : 'border-amber-200 bg-amber-50/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">🐱</span>
                              <div>
                                <h5 className="text-xs font-black text-slate-900">璐璐 · 傲娇暴击加持</h5>
                                <span className="text-[10px] text-amber-800 font-bold">技能：🌟 致命一击</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCallCompanion('gaming-lulu')}
                              disabled={game.companionSkills.lulu.used || game.status !== 'playing'}
                              className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                                game.companionSkills.lulu.activeForNextCheck
                                  ? 'bg-amber-500 text-slate-950 font-bold'
                                  : game.companionSkills.lulu.used
                                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-2xs'
                              }`}
                            >
                              {game.companionSkills.lulu.activeForNextCheck
                                ? '加护中'
                                : game.companionSkills.lulu.used
                                ? '已支援'
                                : '申请支援'}
                            </button>
                          </div>
                          <p className="mt-2 text-[11px] text-slate-600 leading-relaxed">
                            璐璐为你鼓劲！下一次技能检定只要通过，自动升级为【🌟 绝世大成功】！
                          </p>
                        </div>

                        {/* 可可 */}
                        <div
                          className={`p-3 rounded-xl border transition ${
                            game.companionSkills.koko.used
                              ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60'
                              : 'border-emerald-200 bg-emerald-50/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">🦊</span>
                              <div>
                                <h5 className="text-xs font-black text-slate-900">可可 · 元气战术急救</h5>
                                <span className="text-[10px] text-emerald-800 font-bold">技能：❤️ 生命与理智疗愈</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCallCompanion('gaming-koko')}
                              disabled={game.companionSkills.koko.used || game.status !== 'playing'}
                              className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                                game.companionSkills.koko.used
                                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-2xs'
                              }`}
                            >
                              {game.companionSkills.koko.used ? '已急救' : '申请急救'}
                            </button>
                          </div>
                          <p className="mt-2 text-[11px] text-slate-600 leading-relaxed">
                            可可提着应急箱冲刺而来！立即为你恢复 8 点生命值 (HP) 与 10 点理智值 (SAN)！
                          </p>
                        </div>

                        {/* 诺克斯 */}
                        <div
                          className={`p-3 rounded-xl border transition ${
                            game.companionSkills.nox.activeForNextCheck
                              ? 'border-indigo-400 bg-indigo-100/70 shadow-xs ring-1 ring-indigo-300'
                              : game.companionSkills.nox.used
                              ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60'
                              : 'border-indigo-200 bg-indigo-50/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">♟️</span>
                              <div>
                                <h5 className="text-xs font-black text-slate-900">诺克斯 · 概率全息推演</h5>
                                <span className="text-[10px] text-indigo-800 font-bold">技能：♟️ 胜率提升 +25%</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCallCompanion('gaming-nox')}
                              disabled={game.companionSkills.nox.used || game.status !== 'playing'}
                              className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                                game.companionSkills.nox.activeForNextCheck
                                  ? 'bg-indigo-600 text-white font-bold'
                                  : game.companionSkills.nox.used
                                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-2xs'
                              }`}
                            >
                              {game.companionSkills.nox.activeForNextCheck
                                ? '推演中'
                                : game.companionSkills.nox.used
                                ? '已推演'
                                : '申请推演'}
                            </button>
                          </div>
                          <p className="mt-2 text-[11px] text-slate-600 leading-relaxed">
                            诺克斯开启战术目镜！锁定场景薄弱点，使你的下一次判定基准值提升 25%（或 DC 降低 4 点）！
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}

