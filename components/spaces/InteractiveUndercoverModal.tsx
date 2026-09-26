'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Award,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Flame,
  Gamepad2,
  HelpCircle,
  Loader2,
  MessagesSquare,
  Play,
  RotateCcw,
  Send,
  Share2,
  ShieldAlert,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import Avatar from '@/components/shared/Avatar';
import {
  createUndercoverGame,
  getAgentClueStatement,
  getAgentDebateLine,
  determineAgentVote,
  tallyVotes,
  checkUndercoverGameOver,
  getShortName,
  DEFAULT_TABLE_AGENTS,
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
  const [game, setGame] = useState<UndercoverGameState>(() => createUndercoverGame());
  const [isCardRevealed, setIsCardRevealed] = useState(false);
  const [userInputStatement, setUserInputStatement] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [selectedVoteTarget, setSelectedVoteTarget] = useState<string | null>(null);
  const [autoVoice, setAutoVoice] = useState(true);
  const [undercoverGuessWord, setUndercoverGuessWord] = useState('');

  const { play: playTTS, stop: stopTTS, isPlaying: isSpeaking, isLoading: isAudioLoading } = useTTS();
  const autoTurnTimerRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 滚动到最新消息
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [game.messages]);

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

  // 当前轮到的发言玩家
  const aliveSpeakers = game.speakerOrder
    .map((id) => game.players.find((p) => p.id === id)!)
    .filter((p) => p && p.isAlive);
  const currentSpeaker = aliveSpeakers[game.currentSpeakerIndex] || aliveSpeakers[0];

  // 推进到下一个发言人或进入讨论阶段
  const advanceToNextSpeaker = useCallback(
    (updatedGame: UndercoverGameState) => {
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

        // 如果下一个是 AI，稍作停顿后自动陈述
        if (nextSpeaker && nextSpeaker.id !== 'user') {
          triggerAiTurn(nextState, nextSpeaker);
        }
      } else {
        // 全员陈述完毕，进入自由辩论/质询阶段
        triggerDiscussionPhase(updatedGame);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoVoice]
  );

  // 触发 AI 的陈述发言
  const triggerAiTurn = (currentState: UndercoverGameState, aiPlayer: UndercoverPlayer) => {
    setIsAiProcessing(true);
    const delay = 1200 + Math.random() * 600;

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

      setIsAiProcessing(false);
      speakMessage(statement, aiPlayer.voice, aiPlayer.rate);
      advanceToNextSpeaker(nextState);
    }, delay);
  };

  // 用户提交发言
  const handleUserSubmitStatement = () => {
    if (!userInputStatement.trim() || isAiProcessing) return;

    const userText = userInputStatement.trim();
    const userPlayer = game.players.find((p) => p.id === 'user')!;

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

    setUserInputStatement('');
    advanceToNextSpeaker(nextState);
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

    setTimeout(() => {
      setIsAiProcessing(false);
      setGame({
        ...state,
        phase: 'voting',
        messages: [...state.messages, systemNotice, ...debateMessages],
      });
      // 播报第一个辩论者的语音
      if (debateMessages[0]) {
        speakMessage(debateMessages[0].text, debateMessages[0].senderVoice, debateMessages[0].senderRate);
      }
    }, 1200);
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

        setGame({
          ...game,
          round: game.round + 1,
          phase: 'statement',
          currentSpeakerIndex: 0,
          votes,
          messages: [...game.messages, tieNotice],
        });
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
          text: `战局尚未结束！剩余存活玩家：${updatedPlayers.filter((p) => p.isAlive).map((p) => p.name).join('、')}，进入第 ${game.round + 1} 轮陈述！`,
          timestamp: Date.now(),
          type: 'system',
        };

        setGame({
          ...game,
          round: game.round + 1,
          phase: 'statement',
          currentSpeakerIndex: 0,
          players: updatedPlayers,
          eliminatedPlayer: eliminated,
          votes,
          messages: [...game.messages, elimNotice, nextRoundNotice],
        });
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
  };

  if (!isOpen) return null;

  const userPlayer = game.players.find((p) => p.id === 'user')!;
  const alivePlayers = game.players.filter((p) => p.isAlive);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4">
      <div className="relative flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-[#fdfbf7] shadow-2xl border border-amber-200/80">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-black/[0.08] bg-white px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500 text-xl text-white shadow-sm ring-2 ring-amber-200">
              🎲
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900">谁是卧底 · 沉浸式语言推理</h3>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-black text-amber-800">
                  4人暗牌局
                </span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                  第 {game.round} 轮
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                3 位平民 vs 1 位卧底 · 结合专属个性语音 · 语言博弈见分晓
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
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition cursor-pointer shadow-2xs ${
                autoVoice
                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300 hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
              title={autoVoice ? '自动语音已开启' : '自动语音已关闭'}
            >
              {autoVoice ? <Volume2 size={14} /> : <VolumeX size={14} />}
              <span>{autoVoice ? '语音朗读中' : '语音已静音'}</span>
            </button>

            {/* 重开对局 */}
            <button
              type="button"
              onClick={handleStartNewGame}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs transition"
              title="重新随机发牌开局"
            >
              <RotateCcw size={14} />
              <span>新一局</span>
            </button>

            {/* 关闭弹窗 */}
            <button
              type="button"
              onClick={() => {
                stopTTS();
                onClose();
              }}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* 主体游戏区：分为上下两部分（上方圆桌坐席 + 下方公屏消息流与操作面板） */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
          {/* 左侧：圆桌坐席与手牌查看区 */}
          <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-black/[0.08] bg-[#fbf9f4] p-4 lg:w-[420px] shrink-0 overflow-y-auto">
            {/* 阶段状态提示条 */}
            <div className="mb-3.5 flex items-center justify-between rounded-xl bg-amber-500/10 border border-amber-200/80 px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-xs font-black text-amber-900">
                <Sparkles size={14} className="text-amber-600 animate-spin" />
                <span>
                  {game.phase === 'dealing'
                    ? '准备阶段：翻开你的手牌'
                    : game.phase === 'statement'
                    ? `陈述环节：轮到【${currentSpeaker?.name}】发言`
                    : game.phase === 'voting'
                    ? '投票环节：请指出你怀疑的卧底'
                    : game.phase === 'undercover_guess'
                    ? '绝地反杀：卧底猜测平民词'
                    : '本局结束：点击查看完整复盘'}
                </span>
              </div>
              <span className="text-[11px] font-bold text-amber-700">
                存活：{alivePlayers.length}/4
              </span>
            </div>

            {/* 4 人圆桌坐席卡片 */}
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              {game.players.map((player) => {
                const isCurrentTurn = game.phase === 'statement' && currentSpeaker?.id === player.id;
                const isUser = player.id === 'user';
                const votesCount = game.votes ? Object.values(game.votes).filter((v) => v === player.id).length : 0;

                return (
                  <div
                    key={player.id}
                    className={`relative flex flex-col rounded-2xl p-3 border transition ${
                      !player.isAlive
                        ? 'bg-slate-100/80 border-slate-200 opacity-60'
                        : isCurrentTurn
                        ? 'bg-amber-50 border-amber-400 shadow-md ring-2 ring-amber-300'
                        : 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300'
                    }`}
                  >
                    {/* 当前轮次麦克风光环 */}
                    {isCurrentTurn && (
                      <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] text-white shadow-xs animate-bounce">
                        🎙️
                      </span>
                    )}

                    {/* 淘汰出局印章 */}
                    {!player.isAlive && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-900/10 backdrop-blur-[1px]">
                        <span className="rotate-[-12deg] rounded-lg border-2 border-rose-500 bg-rose-50/90 px-2 py-0.5 text-xs font-black text-rose-600 shadow-xs">
                          已出局 💀
                        </span>
                      </span>
                    )}

                    <div className="flex items-center gap-2 mb-2">
                      <div className="relative">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg">
                          {player.avatar}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-black text-slate-900 truncate">
                            {player.name}
                          </span>
                          {isUser && (
                            <span className="rounded bg-indigo-50 px-1 py-0.2 text-[9px] font-bold text-indigo-600">
                              你
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-semibold text-slate-400">
                          {isUser ? '机智探员' : '开黑搭子'}
                        </span>
                      </div>
                    </div>

                    {/* 最新发言小字展示 */}
                    <div className="min-h-[38px] rounded-lg bg-slate-50 p-1.5 text-[11px] leading-relaxed text-slate-600 line-clamp-2">
                      {player.statement ? `“${player.statement}”` : <span className="text-slate-300">暂未发言...</span>}
                    </div>

                    {/* 投票环节指认按钮 */}
                    {game.phase === 'voting' && player.isAlive && !isUser && (
                      <button
                        type="button"
                        onClick={() => handleConfirmVote(player.id)}
                        disabled={isAiProcessing}
                        className={`mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-1 text-xs font-black transition cursor-pointer ${
                          selectedVoteTarget === player.id
                            ? 'bg-rose-500 text-white shadow-xs'
                            : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200/80'
                        }`}
                      >
                        <span>🗳️ 投 TA 出局</span>
                      </button>
                    )}

                    {/* 投票计票标签 */}
                    {game.votes && Object.keys(game.votes).length > 0 && votesCount > 0 && (
                      <div className="mt-1.5 flex justify-end">
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700">
                          {votesCount} 票
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 玩家专属手牌卡（支持点击翻开/隐藏秘密） */}
            <div className="mt-auto rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-purple-50/80 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-black text-indigo-950">
                  <ShieldAlert size={14} className="text-indigo-600" />
                  <span>你的秘密手牌</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCardRevealed(!isCardRevealed)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition cursor-pointer"
                >
                  {isCardRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                  <span>{isCardRevealed ? '合上手牌 (防窥)' : '点击翻开手牌'}</span>
                </button>
              </div>

              <div
                onClick={() => setIsCardRevealed(!isCardRevealed)}
                className={`relative flex items-center justify-center rounded-xl py-4 transition cursor-pointer ${
                  isCardRevealed
                    ? 'bg-white border-2 border-indigo-400 shadow-sm'
                    : 'bg-indigo-950 border-2 border-indigo-900 text-white/90 shadow-inner'
                }`}
              >
                {isCardRevealed ? (
                  <div className="text-center">
                    <span className="text-xs font-semibold text-slate-400 block mb-0.5">本局你的词语</span>
                    <span className="text-2xl font-black text-indigo-600 tracking-wider">
                      {userPlayer.word}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs font-black text-indigo-200">
                    <span>🎴 点击翻开查看你的秘密手牌</span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[10px] text-slate-400 leading-tight text-center">
                牢记你的词语！描述时不能带词里的字，也别暴露太多让卧底察觉哦~
              </p>
            </div>
          </div>

          {/* 右侧：对话历史流与输入操作区 */}
          <div className="flex flex-1 flex-col min-w-0 bg-white">
            {/* 消息滚动流 */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3.5">
              {game.messages.map((msg) => {
                const isSystem = msg.type === 'system';
                const isUser = msg.senderId === 'user';

                if (isSystem) {
                  return (
                    <div key={msg.id} className="flex justify-center my-1.5">
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200/80 px-3.5 py-1 text-xs font-semibold text-slate-600 shadow-2xs">
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
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-base shadow-xs">
                      {msg.senderAvatar}
                    </div>

                    <div className={`max-w-[78%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-1.5 mb-1 px-1">
                        <span className="text-xs font-bold text-slate-800">{msg.senderName}</span>
                        {msg.type === 'discussion' && (
                          <span className="rounded bg-rose-50 px-1.5 py-0.2 text-[9px] font-bold text-rose-600">
                            质疑辩论
                          </span>
                        )}
                        {msg.type === 'statement' && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.2 text-[9px] font-bold text-amber-700">
                            陈述
                          </span>
                        )}
                      </div>

                      <div
                        className={`group relative rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-xs transition ${
                          isUser
                            ? 'bg-slate-900 text-white rounded-tr-none'
                            : 'bg-slate-50 border border-slate-200/90 text-slate-800 rounded-tl-none'
                        }`}
                      >
                        <span>{msg.text}</span>

                        {/* 语音播报小喇叭按钮 */}
                        {msg.senderVoice && (
                          <button
                            type="button"
                            onClick={() => playTTS(msg.text, { voice: msg.senderVoice, rate: msg.senderRate })}
                            className="ml-2 inline-flex items-center text-slate-400 hover:text-indigo-600 transition"
                            title="播放此句语音"
                          >
                            <Volume2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* 底部操作控制台 */}
            <div className="border-t border-black/[0.08] bg-[#fdfbf7] p-3.5 sm:p-4 shrink-0">
              {/* 1. 陈述环节：轮到用户发言 */}
              {game.phase === 'statement' && currentSpeaker?.id === 'user' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-black text-amber-800 flex items-center gap-1">
                      <Sparkles size={13} />
                      轮到你了！请用一句话描述你的词语：
                    </span>
                    <span className="text-slate-400 font-medium">切勿直接说出词里的字</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={userInputStatement}
                      onChange={(e) => setUserInputStatement(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUserSubmitStatement();
                      }}
                      placeholder={`用一句话隐晦描述【${userPlayer.word}】...`}
                      maxLength={60}
                      className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 shadow-2xs focus:border-amber-500 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={handleUserSubmitStatement}
                      disabled={!userInputStatement.trim()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-950 px-4 text-xs font-black text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                    >
                      <Send size={13} />
                      <span>发言</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 2. 陈述环节：AI 正在发言思考中 */}
              {game.phase === 'statement' && currentSpeaker?.id !== 'user' && (
                <div className="flex items-center justify-between rounded-xl bg-white border border-slate-200/80 p-3 shadow-2xs">
                  <div className="flex items-center gap-2.5">
                    <Loader2 size={16} className="animate-spin text-amber-500" />
                    <span className="text-xs font-bold text-slate-700">
                      【{currentSpeaker?.name}】正在构思发言与词语特征...
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">请稍候并仔细听取破绽</span>
                </div>
              )}

              {/* 3. 投票环节提示 */}
              {game.phase === 'voting' && (
                <div className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200/80 p-3 text-xs">
                  <div className="flex items-center gap-2 font-black text-rose-800">
                    <Flame size={15} className="text-rose-500" />
                    <span>投票时间：请在左侧点击你认为最可疑的角色头像上的【投 TA 出局】！</span>
                  </div>
                  {isAiProcessing && <Loader2 size={14} className="animate-spin text-rose-500" />}
                </div>
              )}

              {/* 4. 卧底绝地反杀（被投出时猜测平民词） */}
              {game.phase === 'undercover_guess' && (
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50/80 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-black text-rose-900 flex items-center gap-1.5">
                      <Zap size={15} className="text-amber-500" />
                      【绝地反杀环节】卧底已被指认！如果能猜出平民的真正词汇，仍可直接翻盘反杀！
                    </span>
                  </div>

                  {game.eliminatedPlayer?.id === 'user' ? (
                    // 玩家是卧底：自己输入猜测
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={undercoverGuessWord}
                        onChange={(e) => setUndercoverGuessWord(e.target.value)}
                        placeholder="输入你猜测的平民词（如：麦当劳、西瓜）..."
                        className="flex-1 rounded-xl border border-rose-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 shadow-2xs focus:border-rose-500 focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={() => handleUndercoverGuess(undercoverGuessWord)}
                        disabled={!undercoverGuessWord.trim()}
                        className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-rose-700 disabled:opacity-40 transition cursor-pointer"
                      >
                        确认猜词反杀
                      </button>
                    </div>
                  ) : (
                    // AI 是卧底：AI 自动随机/启发式猜测
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700">
                        卧底【{game.eliminatedPlayer?.name}】正在进行绝地猜词反杀...
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          // 模拟 AI 猜测（有 30% 几率猜中，70% 猜错）
                          const willWin = Math.random() < 0.35;
                          handleUndercoverGuess(willWin ? game.civilianWord : '错误词');
                        }}
                        className="rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-black text-white shadow-sm hover:bg-rose-700 transition cursor-pointer"
                      >
                        揭晓反杀结果
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 5. 游戏结束胜负揭晓卡片 */}
              {game.phase === 'game_over' && (
                <div className="rounded-2xl border-2 border-amber-300 bg-white p-4 shadow-md space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">
                        {game.winner === 'civilian' ? '🏆' : '💀'}
                      </span>
                      <div>
                        <h4 className="text-sm font-black text-slate-950">
                          {game.winReason || (game.winner === 'civilian' ? '平民阵营大获全胜！' : '卧底阵营逆袭获胜！')}
                        </h4>
                        <p className="text-[11px] text-slate-500 font-semibold">
                          平民词：【{game.civilianWord}】 ｜ 卧底词：【{game.undercoverWord}】
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {onShareToSpace && (
                        <button
                          type="button"
                          onClick={handleShareReport}
                          className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-black text-indigo-700 hover:bg-indigo-100 shadow-2xs transition cursor-pointer"
                        >
                          <Share2 size={13} />
                          <span>分享战报</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleStartNewGame}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-1.5 text-xs font-black text-white hover:bg-slate-800 shadow-sm transition cursor-pointer"
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
}
