'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Award,
  ChevronRight,
  Eye,
  EyeOff,
  Flame,
  Gamepad2,
  HelpCircle,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Share2,
  ShieldAlert,
  Sparkles,
  User,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import {
  createUndercoverGame,
  getAgentClueStatement,
  getAgentDebateLine,
  determineAgentVote,
  tallyVotes,
  checkUndercoverGameOver,
  getShortName,
  UndercoverGameState,
  UndercoverPlayer,
  DiscussionMessage,
} from '@/lib/undercover/engine';
import { useTTS } from '@/hooks/useTTS';
import type { Agent } from '@/types';

export interface InteractiveUndercoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  spaceAgents?: Agent[];
  onShareToSpace?: (content: string) => void;
}

export default function InteractiveUndercoverModal({
  isOpen,
  onClose,
  spaceAgents = [],
  onShareToSpace,
}: InteractiveUndercoverModalProps) {
  const [mounted, setMounted] = useState(false);
  const [game, setGame] = useState<UndercoverGameState>(() => createUndercoverGame());
  const [isCardRevealed, setIsCardRevealed] = useState(false);
  const [userInputStatement, setUserInputStatement] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [selectedVoteTarget, setSelectedVoteTarget] = useState<string | null>(null);
  const [autoVoice, setAutoVoice] = useState(true);
  const [undercoverGuessWord, setUndercoverGuessWord] = useState('');

  const { play: playTTS, stop: stopTTS, isPlaying: isSpeaking } = useTTS();
  const autoTurnTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 弹窗开启时锁定外部网页滚动，避免任何滚轮穿透或页面跳动
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // 仅在对话流容器内部滚动到底部，彻底杜绝 scrollIntoView 导致整个浏览器窗口或父页面被拉扯飞移
  const scrollToBottom = useCallback((smooth = true) => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [game.messages, scrollToBottom]);

  // 重置开局
  const handleStartNewGame = useCallback(() => {
    stopTTS();
    if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current);
    const newGame = createUndercoverGame('玩家（你）');
    setGame(newGame);
    setIsCardRevealed(false);
    setUserInputStatement('');
    setSelectedVoteTarget(null);
    setUndercoverGuessWord('');
    setIsAiProcessing(false);
  }, [stopTTS]);

  // 弹窗开启时初始化
  useEffect(() => {
    if (isOpen) {
      handleStartNewGame();
    } else {
      stopTTS();
      if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current);
    }
  }, [isOpen, handleStartNewGame, stopTTS]);

  // 组件卸载清理
  useEffect(() => {
    return () => {
      if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current);
    };
  }, []);

  // 播放台词语音
  const speakMessage = (text: string, voice: string, rate?: string) => {
    if (!autoVoice || !voice) return;
    playTTS(text, { voice, rate });
  };

  // 当前轮到的发言玩家（越界时严格返回 null，杜绝错误回退到 aliveSpeakers[0]）
  const aliveSpeakers = game.speakerOrder
    .map((id) => game.players.find((p) => p.id === id)!)
    .filter((p) => p && p.isAlive);
  const currentSpeaker =
    game.phase === 'statement' && game.currentSpeakerIndex < aliveSpeakers.length
      ? aliveSpeakers[game.currentSpeakerIndex]
      : null;

  // 触发 AI 的陈述发言
  const triggerAiTurn = (currentState: UndercoverGameState, aiPlayer: UndercoverPlayer) => {
    setIsAiProcessing(true);
    if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current);
    const delay = 1000 + Math.random() * 400;

    autoTurnTimerRef.current = setTimeout(() => {
      const statement = getAgentClueStatement(aiPlayer, currentState.wordPair, currentState.round);
      const newMsg: DiscussionMessage = {
        id: `stmt-${Date.now()}-${aiPlayer.id}`,
        senderId: aiPlayer.id,
        senderName: aiPlayer.name,
        senderAvatar: aiPlayer.avatar,
        senderVoice: aiPlayer.voice,
        senderRate: aiPlayer.rate,
        text: statement,
        timestamp: Date.now(),
        type: 'statement',
      };

      const updatedPlayers = currentState.players.map((p) =>
        p.id === aiPlayer.id
          ? {
              ...p,
              statement,
              statementHistory: [...p.statementHistory, statement],
            }
          : p
      );

      const nextState: UndercoverGameState = {
        ...currentState,
        players: updatedPlayers,
        messages: [...currentState.messages, newMsg],
      };

      setGame(nextState);
      setIsAiProcessing(false);
      speakMessage(statement, aiPlayer.voice, aiPlayer.rate);
      advanceToNextSpeaker(nextState);
    }, delay);
  };

  // 进入自由辩论阶段
  const triggerDiscussionPhase = (state: UndercoverGameState) => {
    setIsAiProcessing(true);

    const aliveAi = state.players.filter((p) => p.isAlive && p.id !== 'user');
    const systemNotice: DiscussionMessage = {
      id: `sys-debate-${Date.now()}`,
      senderId: 'system',
      senderName: '裁判',
      senderAvatar: '⚖️',
      senderVoice: '',
      text: `【第 ${state.round} 轮陈述完毕】进入自由质疑辩论！听听大家对彼此发言的推理怀疑。`,
      timestamp: Date.now(),
      type: 'system',
    };

    // 立即更新展示陈述完毕公告，阶段明确切换为 discussion，索引移出保证不占位
    const stateWithNotice: UndercoverGameState = {
      ...state,
      phase: 'discussion',
      currentSpeakerIndex: state.speakerOrder.length,
      messages: [...state.messages, systemNotice],
    };
    setGame(stateWithNotice);

    // 随机让 2 位 AI 发表质疑互怼看法
    const debatingAiList = [...aliveAi].sort(() => Math.random() - 0.5).slice(0, 2);
    const debateMessages: DiscussionMessage[] = [];

    debatingAiList.forEach((speaker, idx) => {
      const otherAlive = state.players.filter((p) => p.isAlive && p.id !== speaker.id);
      const suspect = otherAlive[Math.floor(Math.random() * otherAlive.length)] || otherAlive[0];
      const debateText = getAgentDebateLine(speaker, suspect, state);
      debateMessages.push({
        id: `debate-${Date.now()}-${idx}`,
        senderId: speaker.id,
        senderName: speaker.name,
        senderAvatar: speaker.avatar,
        senderVoice: speaker.voice,
        senderRate: speaker.rate,
        text: debateText,
        timestamp: Date.now() + (idx + 1) * 800,
        type: 'discussion',
      });
    });

    if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current);
    autoTurnTimerRef.current = setTimeout(() => {
      setIsAiProcessing(false);
      setGame({
        ...stateWithNotice,
        phase: 'voting',
        messages: [...stateWithNotice.messages, ...debateMessages],
      });
      // 播报第一个辩论者的语音
      if (debateMessages[0]) {
        speakMessage(debateMessages[0].text, debateMessages[0].senderVoice, debateMessages[0].senderRate);
      }
    }, 1200);
  };

  // 推进到下一个发言人或进入讨论阶段
  const advanceToNextSpeaker = (updatedGame: UndercoverGameState) => {
    const aliveList = updatedGame.speakerOrder
      .map((id) => updatedGame.players.find((p) => p.id === id)!)
      .filter((p) => p && p.isAlive);

    const nextIndex = updatedGame.currentSpeakerIndex + 1;

    if (nextIndex < aliveList.length) {
      // 继续下一位玩家陈述
      const nextSpeaker = aliveList[nextIndex];
      const nextState: UndercoverGameState = {
        ...updatedGame,
        currentSpeakerIndex: nextIndex,
      };
      setGame(nextState);

      // 如果下一个是 AI，自动发起陈述；如果下一个是玩家，确保接触 AI 状态占用
      if (nextSpeaker && nextSpeaker.id !== 'user') {
        triggerAiTurn(nextState, nextSpeaker);
      } else {
        setIsAiProcessing(false);
      }
    } else {
      // 全员陈述完毕，进入自由辩论/质询阶段
      triggerDiscussionPhase(updatedGame);
    }
  };

  // 【核心交互】：玩家在发牌阶段点击「开始本轮发言」正式启动对局
  const handleStartGame = () => {
    setIsCardRevealed(true); // 自动翻开手牌
    const aliveList = game.speakerOrder
      .map((id) => game.players.find((p) => p.id === id)!)
      .filter((p) => p && p.isAlive);
    const firstSpeaker = aliveList[0];

    const nextState: UndercoverGameState = {
      ...game,
      phase: 'statement',
      currentSpeakerIndex: 0,
      messages: [
        ...game.messages,
        {
          id: `sys-start-${Date.now()}`,
          senderId: 'system',
          senderName: '裁判',
          senderAvatar: '⚖️',
          senderVoice: '',
          text: `【第 ${game.round} 轮发言开始】本轮首位发言人是【${firstSpeaker.name}】，请依次陈述！`,
          timestamp: Date.now(),
          type: 'system',
        },
      ],
    };

    setGame(nextState);

    // 如果首位是 AI，触发 AI 发言
    if (firstSpeaker.id !== 'user') {
      triggerAiTurn(nextState, firstSpeaker);
    }
  };

  // 用户提交发言
  const handleUserSubmitStatement = () => {
    const userText = userInputStatement.trim();
    if (!userText) return;

    const userPlayer = game.players.find((p) => p.id === 'user');
    if (!userPlayer || !userPlayer.isAlive) return;

    const newMsg: DiscussionMessage = {
      id: `stmt-${Date.now()}-user`,
      senderId: 'user',
      senderName: userPlayer.name,
      senderAvatar: userPlayer.avatar,
      senderVoice: userPlayer.voice,
      text: userText,
      timestamp: Date.now(),
      type: 'statement',
    };

    const updatedPlayers = game.players.map((p) =>
      p.id === 'user'
        ? {
            ...p,
            statement: userText,
            statementHistory: [...p.statementHistory, userText],
          }
        : p
    );

    const nextState: UndercoverGameState = {
      ...game,
      players: updatedPlayers,
      messages: [...game.messages, newMsg],
    };

    // 同步清空输入框并即时更新全局对局，确保用户发言立即呈现在消息流中
    setUserInputStatement('');
    setGame(nextState);
    setIsAiProcessing(false);

    // 推进发言人轮次
    advanceToNextSpeaker(nextState);
  };

  // 用户点击投票确认
  const handleConfirmVote = (targetPlayerId: string) => {
    if (game.phase !== 'voting' || isAiProcessing) return;
    setSelectedVoteTarget(targetPlayerId);
    setIsAiProcessing(true);

    const alivePlayers = game.players.filter((p) => p.isAlive);
    const votes: Record<string, string> = {
      user: targetPlayerId,
    };

    // 所有活着的 AI 进行投票决策
    alivePlayers
      .filter((p) => p.id !== 'user')
      .forEach((ai) => {
        votes[ai.id] = determineAgentVote(ai, alivePlayers, game);
      });

    // 统计选票
    const tallyResult = tallyVotes(votes, alivePlayers);

    setTimeout(() => {
      setIsAiProcessing(false);

      // 如果平票
      if (tallyResult.isTie || !tallyResult.eliminatedId) {
        const tieNotice: DiscussionMessage = {
          id: `tie-${Date.now()}`,
          senderId: 'system',
          senderName: '裁判',
          senderAvatar: '⚖️',
          senderVoice: '',
          text: '【平票安全】本轮投票出现平票，无人被放逐！全员进入下一轮发言！',
          timestamp: Date.now(),
          type: 'system',
        };

        const nextState: UndercoverGameState = {
          ...game,
          round: game.round + 1,
          phase: 'statement',
          currentSpeakerIndex: 0,
          votes,
          messages: [...game.messages, tieNotice],
        };
        setGame(nextState);

        const aliveList = nextState.speakerOrder
          .map((id) => nextState.players.find((p) => p.id === id)!)
          .filter((p) => p && p.isAlive);
        const firstSpeaker = aliveList[0];
        if (firstSpeaker && firstSpeaker.id !== 'user') {
          triggerAiTurn(nextState, firstSpeaker);
        } else {
          setIsAiProcessing(false);
        }
        return;
      }

      // 产生被淘汰者
      const eliminated = game.players.find((p) => p.id === tallyResult.eliminatedId)!;
      const updatedPlayers = game.players.map((p) =>
        p.id === eliminated.id ? { ...p, isAlive: false, votesReceived: tallyResult.voteCounts[p.id] || 0 } : p
      );

      const elimNotice: DiscussionMessage = {
        id: `elim-${Date.now()}`,
        senderId: 'system',
        senderName: '裁判',
        senderAvatar: '⚖️',
        senderVoice: '',
        text: `【投票出局】${eliminated.name} 得票最多被放逐淘汰！真实的词语是：【${eliminated.word}】！`,
        timestamp: Date.now(),
        type: 'system',
      };

      // 检查胜负
      const winCheck = checkUndercoverGameOver(updatedPlayers);

      // 如果被淘汰的是卧底，触发绝地反杀（Undercover Guess）环节！
      if (eliminated.role === 'undercover' && !winCheck.isOver) {
        setGame({
          ...game,
          phase: 'undercover_guess',
          players: updatedPlayers,
          eliminatedPlayer: eliminated,
          votes,
          messages: [...game.messages, elimNotice],
        });
        return;
      }

      if (winCheck.isOver) {
        setGame({
          ...game,
          phase: 'game_over',
          players: updatedPlayers,
          eliminatedPlayer: eliminated,
          winner: winCheck.winner,
          winReason: winCheck.reason,
          votes,
          messages: [...game.messages, elimNotice],
        });
      } else {
        // 游戏继续下一轮
        const nextRoundNotice: DiscussionMessage = {
          id: `next-round-${Date.now()}`,
          senderId: 'system',
          senderName: '裁判',
          senderAvatar: '⚖️',
          senderVoice: '',
          text: `战局尚未结束！剩余存活：${updatedPlayers.filter((p) => p.isAlive).map((p) => p.name).join('、')}，进入第 ${game.round + 1} 轮陈述！`,
          timestamp: Date.now(),
          type: 'system',
        };

        const nextState: UndercoverGameState = {
          ...game,
          round: game.round + 1,
          phase: 'statement',
          currentSpeakerIndex: 0,
          players: updatedPlayers,
          eliminatedPlayer: eliminated,
          votes,
          messages: [...game.messages, elimNotice, nextRoundNotice],
        };

        setGame(nextState);

        const aliveList = nextState.speakerOrder
          .map((id) => nextState.players.find((p) => p.id === id)!)
          .filter((p) => p && p.isAlive);
        const firstSpeaker = aliveList[0];
        if (firstSpeaker && firstSpeaker.id !== 'user') {
          triggerAiTurn(nextState, firstSpeaker);
        } else {
          setIsAiProcessing(false);
        }
      }
    }, 1000);
  };

  // 卧底猜测平民词（绝地反杀）
  const handleUndercoverGuess = (guessText: string) => {
    const isCorrect = guessText.trim().toLowerCase() === game.civilianWord.trim().toLowerCase();

    if (isCorrect) {
      setGame({
        ...game,
        phase: 'game_over',
        winner: 'undercover',
        winReason: `🔥 绝地反杀！卧底成功猜中平民词【${game.civilianWord}】，卧底逆风获胜！`,
      });
    } else {
      setGame({
        ...game,
        phase: 'game_over',
        winner: 'civilian',
        winReason: `🎉 卧底猜测错误（猜的是【${guessText}】，平民词为【${game.civilianWord}】），平民阵营锁定胜局！`,
      });
    }
  };

  // 分享对局战报到空间
  const handleShareReport = () => {
    if (!onShareToSpace) return;
    const winnerText = game.winner === 'civilian' ? '🏆 平民阵营' : '💀 卧底阵营';
    const undercoverPlayer = game.players.find((p) => p.role === 'undercover');
    const content = `【谁是卧底 · 对局战报】\n获胜阵营：${winnerText}\n平民词：【${game.civilianWord}】\n卧底词：【${game.undercoverWord}】（卧底是：${undercoverPlayer?.name || '未知'}）\n交锋轮次：共大战 ${game.round} 轮！大家快来开黑游戏中心一起抓卧底吧！`;
    onShareToSpace(content);
    onClose();
  };

  const userPlayer = game.players.find((p) => p.id === 'user')!;
  const alivePlayers = game.players.filter((p) => p.isAlive);
  const isUserTurnToSpeak = game.phase === 'statement' && currentSpeaker?.id === 'user';

  // 轮到用户发言时，使用 preventScroll: true 平滑聚焦输入框，彻底杜绝浏览器原生行为强制将整个页面向上拖拽
  useEffect(() => {
    if (isUserTurnToSpeak) {
      const timer = setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isUserTurnToSpeak]);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-sm overflow-hidden overscroll-none">
      <div className="flex h-[88vh] max-h-[720px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
        {/* 顶部标题与设置栏 */}
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6 bg-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-xl text-indigo-600 shadow-inner">
              🎲
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-slate-900">谁是卧底 · 语言推理</h2>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                  第 {game.round} 轮
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                  {game.phase === 'dealing' ? '🎴 准备发牌' : game.phase === 'statement' ? '🎙️ 轮流陈述' : game.phase === 'voting' ? '🗳️ 投票指认' : '🏆 终局揭晓'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                4人暗牌局（3平民 vs 1卧底）· 全角色独立性格语音
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
              title={autoVoice ? '自动语音已开启' : '自动语音已关闭'}
            >
              {autoVoice ? <Volume2 size={14} /> : <VolumeX size={14} />}
              <span className="hidden sm:inline">{autoVoice ? '语音开启' : '静音'}</span>
            </button>

            {/* 重开对局 */}
            <button
              type="button"
              onClick={handleStartNewGame}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
              title="重新随机发牌开局"
            >
              <RotateCcw size={13} />
              <span className="hidden sm:inline">新一局</span>
            </button>

            {/* 关闭弹窗 */}
            <button
              type="button"
              onClick={() => {
                stopTTS();
                onClose();
              }}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* 主体游戏区：分为左侧坐席手牌 + 右侧对话操作 */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
          {/* 左侧：圆桌坐席与手牌查看区 */}
          <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50 p-3 sm:p-3.5 lg:w-[350px] shrink-0 overflow-y-auto">
            {/* 阶段状态提示 */}
            <div className="mb-2 flex items-center justify-between rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs">
              <span className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-amber-500" />
                {game.phase === 'dealing'
                  ? '点击下方查看手牌，准备开局'
                  : game.phase === 'statement'
                  ? `正在发言：${currentSpeaker?.name}`
                  : game.phase === 'voting'
                  ? '请点击投出你怀疑的卧底'
                  : '对局完成'}
              </span>
              <span className="text-[10px] font-semibold text-slate-400">
                存活 {alivePlayers.length}/4
              </span>
            </div>

            {/* 4 人坐席卡片 */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              {game.players.map((player) => {
                const isCurrentTurn = game.phase === 'statement' && currentSpeaker?.id === player.id;
                const isUser = player.id === 'user';
                const votesCount = game.votes ? Object.values(game.votes).filter((v) => v === player.id).length : 0;

                return (
                  <div
                    key={player.id}
                    className={`relative flex flex-col rounded-xl p-2.5 border transition ${
                      !player.isAlive
                        ? 'bg-slate-100 border-slate-200 opacity-50'
                        : isCurrentTurn
                        ? 'bg-amber-50 border-amber-400 shadow-sm ring-2 ring-amber-300'
                        : 'bg-white border-slate-200 shadow-2xs hover:border-slate-300'
                    }`}
                  >
                    {/* 当前轮次麦克风指示 */}
                    {isCurrentTurn && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-amber-500 text-[9px] text-white shadow-xs animate-bounce">
                        🎙️
                      </span>
                    )}

                    {/* 淘汰出局标签 */}
                    {!player.isAlive && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-900/10">
                        <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-black text-white shadow-xs">
                          已出局 💀
                        </span>
                      </span>
                    )}

                    <div className="flex items-center gap-1.5 mb-1">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm shadow-inner">
                        {player.avatar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-black text-slate-900 truncate">
                            {player.name}
                          </span>
                          {isUser && (
                            <span className="rounded bg-indigo-50 px-1 py-0.2 text-[8px] font-bold text-indigo-600">
                              你
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] font-semibold text-slate-400 block truncate">
                          {isUser ? '机智探员' : '开黑成员'}
                        </span>
                      </div>
                    </div>

                    {/* 最新发言小字展示 */}
                    <div className="min-h-[28px] rounded-lg bg-slate-50 p-1.5 text-[10.5px] leading-snug text-slate-600 line-clamp-2">
                      {player.statement ? `“${player.statement}”` : <span className="text-slate-300">等待陈述...</span>}
                    </div>

                    {/* 投票环节指认按钮 */}
                    {game.phase === 'voting' && player.isAlive && !isUser && (
                      <button
                        type="button"
                        onClick={() => handleConfirmVote(player.id)}
                        disabled={isAiProcessing}
                        className={`mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1 text-xs font-black transition cursor-pointer ${
                          selectedVoteTarget === player.id
                            ? 'bg-rose-500 text-white shadow-xs'
                            : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                        }`}
                      >
                        <span>🗳️ 投 TA 出局</span>
                      </button>
                    )}

                    {/* 投票计票标签 */}
                    {game.votes && Object.keys(game.votes).length > 0 && votesCount > 0 && (
                      <div className="mt-1 flex justify-end">
                        <span className="rounded bg-rose-100 px-1.5 py-0.2 text-[10px] font-black text-rose-700">
                          {votesCount} 票
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 玩家专属秘密手牌卡 */}
            <div className="mt-auto rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 text-xs font-black text-slate-900">
                  <ShieldAlert size={13} className="text-indigo-600" />
                  <span>你的秘密手牌</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCardRevealed(!isCardRevealed)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition cursor-pointer"
                >
                  {isCardRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                  <span>{isCardRevealed ? '合上防窥' : '翻开手牌'}</span>
                </button>
              </div>

              <div
                onClick={() => setIsCardRevealed(!isCardRevealed)}
                className={`relative flex items-center justify-center rounded-xl py-2.5 transition cursor-pointer ${
                  isCardRevealed
                    ? 'bg-indigo-50 border border-indigo-200 shadow-inner'
                    : 'bg-slate-900 border border-slate-800 text-white shadow-sm'
                }`}
              >
                {isCardRevealed ? (
                  <div className="text-center">
                    <span className="text-[10px] font-bold text-indigo-500 block mb-0.5">你的词语是</span>
                    <span className="text-lg font-black text-indigo-950 tracking-wider">
                      {userPlayer.word}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs font-black text-slate-200">
                    <span>🎴 点击翻开查看你的手牌词</span>
                  </div>
                )}
              </div>

              {/* 发牌阶段开始按钮 */}
              {game.phase === 'dealing' && (
                <button
                  type="button"
                  onClick={handleStartGame}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2 text-xs font-black text-white shadow-md hover:bg-indigo-700 transition cursor-pointer"
                >
                  <Play size={13} />
                  <span>我看好词了，开始第一轮发言！</span>
                </button>
              )}
            </div>
          </div>

          {/* 右侧：对话历史流与输入操作区 */}
          <div className="flex min-h-0 flex-1 flex-col min-w-0 bg-white">
            {/* 消息滚动流 */}
            <div
              ref={chatContainerRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-3 bg-slate-50/40"
            >
              {game.messages.map((msg) => {
                const isSystem = msg.type === 'system';
                const isUser = msg.senderId === 'user';

                if (isSystem) {
                  return (
                    <div key={msg.id} className="flex justify-center my-1">
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
                        <span>{msg.text}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm shadow-2xs">
                      {msg.senderAvatar}
                    </div>

                    <div className={`max-w-[80%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-1.5 mb-0.5 px-1">
                        <span className="text-xs font-bold text-slate-700">{msg.senderName}</span>
                        {msg.type === 'discussion' && (
                          <span className="rounded bg-rose-50 px-1 py-0.2 text-[9px] font-bold text-rose-600">
                            质疑
                          </span>
                        )}
                        {msg.type === 'statement' && (
                          <span className="rounded bg-amber-50 px-1 py-0.2 text-[9px] font-bold text-amber-700">
                            陈述
                          </span>
                        )}
                      </div>

                      <div
                        className={`group relative rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed transition ${
                          isUser
                            ? 'bg-slate-900 text-white rounded-tr-none shadow-xs'
                            : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-2xs'
                        }`}
                      >
                        <span>{msg.text}</span>

                        {/* 语音播报小喇叭 */}
                        {msg.senderVoice && (
                          <button
                            type="button"
                            onClick={() => playTTS(msg.text, { voice: msg.senderVoice, rate: msg.senderRate })}
                            className="ml-2 inline-flex items-center text-slate-400 hover:text-indigo-600 transition cursor-pointer"
                            title="点击重新朗读"
                          >
                            <Volume2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部操作控制台 */}
            <div className="border-t border-slate-200 bg-white p-3 sm:p-3.5 shrink-0">
              {/* 1. 发牌阶段提示 */}
              {game.phase === 'dealing' && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2 rounded-xl bg-indigo-50/70 border border-indigo-200/80 p-2.5 sm:p-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-900">
                    <Sparkles size={14} className="text-indigo-600 shrink-0" />
                    <span>手牌已秘密分发完毕！翻开左侧手牌卡确认你的词语后，点击按钮开局。</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleStartGame}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-black text-white hover:bg-indigo-700 transition cursor-pointer shadow-sm"
                  >
                    <Play size={13} />
                    <span>开始第 1 轮发言</span>
                  </button>
                </div>
              )}

              {/* 2. 陈述环节：轮到用户发言 */}
              {isUserTurnToSpeak && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-black text-amber-800 flex items-center gap-1">
                      <Sparkles size={13} className="text-amber-500 animate-spin" />
                      轮到你了！请用一句话隐晦描述【{userPlayer.word}】：
                    </span>
                    <span className="text-[10px] text-slate-400">回车或点击发言</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={userInputStatement}
                      onChange={(e) => setUserInputStatement(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                          e.preventDefault();
                          handleUserSubmitStatement();
                        }
                      }}
                      placeholder={`一句话描述【${userPlayer.word}】，切勿直接带出字哦...`}
                      maxLength={60}
                      className="flex-1 rounded-xl border border-slate-300 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-800 shadow-2xs focus:border-indigo-500 focus:bg-white focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleUserSubmitStatement();
                      }}
                      disabled={!userInputStatement.trim()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-black text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <Send size={13} />
                      <span>发言</span>
                    </button>
                  </div>

                  {/* 快捷灵感标签 */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-500">快速填入灵感：</span>
                    <button
                      type="button"
                      onClick={() => {
                        setUserInputStatement('日常生活中非常常见，很多人每天都会接触到。');
                        inputRef.current?.focus({ preventScroll: true });
                      }}
                      className="rounded bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-slate-600 transition cursor-pointer"
                    >
                      + 日常高频
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUserInputStatement('具有很强的辨识度，大家一般在特定时间或场合使用。');
                        inputRef.current?.focus({ preventScroll: true });
                      }}
                      className="rounded bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-slate-600 transition cursor-pointer"
                    >
                      + 特定场合
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUserInputStatement('这个东西给我带来了很多快乐回忆，特别实用。');
                        inputRef.current?.focus({ preventScroll: true });
                      }}
                      className="rounded bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-slate-600 transition cursor-pointer"
                    >
                      + 带来快乐
                    </button>
                  </div>
                </div>
              )}

              {/* 3. 陈述环节：AI 正在发言思考中 */}
              {game.phase === 'statement' && !isUserTurnToSpeak && (
                <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <Loader2 size={15} className="animate-spin text-amber-500" />
                    <span className="text-xs font-bold text-slate-700">
                      【{currentSpeaker?.name || '队友'}】正在推敲特征与表述中...
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">请仔细听取其表述与破绽</span>
                </div>
              )}

              {/* 4. 自由辩论/质询环节 */}
              {game.phase === 'discussion' && (
                <div className="flex items-center justify-between rounded-xl bg-purple-50 border border-purple-200 p-3 text-xs">
                  <div className="flex items-center gap-2 font-bold text-purple-900">
                    <Loader2 size={15} className="animate-spin text-purple-600" />
                    <span>【全员陈述完毕】探员们正在梳理疑点、发起互怼质疑与交锋...</span>
                  </div>
                  <span className="text-[11px] text-purple-500">即将进入投票放逐环节</span>
                </div>
              )}

              {/* 5. 投票环节提示 */}
              {game.phase === 'voting' && (
                <div className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs">
                  <div className="flex items-center gap-2 font-black text-rose-800">
                    <Flame size={15} className="text-rose-500" />
                    <span>投票放逐时间！请在左侧点击你怀疑的候选人卡片上的【🗳️ 投 TA 出局】！</span>
                  </div>
                  {isAiProcessing && <Loader2 size={14} className="animate-spin text-rose-500" />}
                </div>
              )}

              {/* 5. 卧底绝地反杀（被投出时猜测平民词） */}
              {game.phase === 'undercover_guess' && (
                <div className="rounded-xl border-2 border-rose-200 bg-rose-50/60 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-black text-rose-900">
                    <span className="flex items-center gap-1.5">
                      <Zap size={14} className="text-amber-500" />
                      卧底已被指认！进入绝地反杀阶段：若能猜出平民的真正词汇即可翻盘获胜！
                    </span>
                  </div>

                  {game.eliminatedPlayer?.id === 'user' ? (
                    // 玩家是卧底：自己输入猜测
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={undercoverGuessWord}
                        onChange={(e) => setUndercoverGuessWord(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing && undercoverGuessWord.trim()) {
                            e.preventDefault();
                            handleUndercoverGuess(undercoverGuessWord);
                          }
                        }}
                        placeholder="输入你猜测的平民词（如：麦当劳、西瓜）..."
                        className="flex-1 rounded-xl border border-rose-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 focus:border-rose-500 focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() => handleUndercoverGuess(undercoverGuessWord)}
                        disabled={!undercoverGuessWord.trim()}
                        className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white hover:bg-rose-700 disabled:opacity-40 transition cursor-pointer"
                      >
                        确认猜词反杀
                      </button>
                    </div>
                  ) : (
                    // AI 是卧底：AI 自动猜测
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700">
                        卧底【{game.eliminatedPlayer?.name}】正在进行猜词推测...
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const willWin = Math.random() < 0.35;
                          handleUndercoverGuess(willWin ? game.civilianWord : '错误答案');
                        }}
                        className="rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-black text-white hover:bg-rose-700 transition cursor-pointer"
                      >
                        揭晓反杀结果
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 6. 游戏结束胜负揭晓卡片 */}
              {game.phase === 'game_over' && (
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">
                        {game.winner === 'civilian' ? '🏆' : '💀'}
                      </span>
                      <div>
                        <h4 className="text-sm font-black text-slate-900">
                          {game.winReason || (game.winner === 'civilian' ? '平民阵营大获全胜！' : '卧底阵营逆袭获胜！')}
                        </h4>
                        <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                          平民词：【{game.civilianWord}】 ｜ 卧底词：【{game.undercoverWord}】
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {onShareToSpace && (
                        <button
                          type="button"
                          onClick={handleShareReport}
                          className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-black text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                        >
                          <Share2 size={13} />
                          <span>分享战报</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleStartNewGame}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-black text-white hover:bg-slate-800 transition cursor-pointer shadow-sm"
                      >
                        <RotateCcw size={13} />
                        <span>再来一把</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
