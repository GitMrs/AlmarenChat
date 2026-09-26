'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Gamepad2, Lightbulb, Play, Pause, RotateCcw, Share2, SkipForward, Sparkles, User, Users, Volume2, VolumeX, X } from 'lucide-react';
import Avatar from '@/components/shared/Avatar';
import GomokuBoard from '@/components/spaces/GomokuBoard';
import {
  checkWin,
  findBestMove,
  getAdvisorHint,
  getCharacterLine,
  getKokoCheer,
  getUndoLine,
  playStoneSound,
} from '@/lib/relay/gomoku-ai';
import { useTTS } from '@/hooks/useTTS';
import type { Agent } from '@/types';

export interface InteractiveGomokuModalProps {
  isOpen: boolean;
  onClose: () => void;
  spaceAgents?: Agent[];
  onShareToSpace?: (content: string) => void;
  initialMode?: 'pve' | 'eve';
  initialBlackId?: string;
  initialWhiteId?: string;
  initialView?: 'center' | 'gomoku';
}

const DEFAULT_OPPONENTS: Array<{ id: string; name: string; avatar: string; voice: string; role: string }> = [
  { id: 'gaming-lulu', name: '璐璐', avatar: '🐱', voice: 'zh-CN-XiaoyiNeural', role: '傲娇毒舌陪玩' },
  { id: 'gaming-nox', name: '诺克斯', avatar: '♟️', voice: 'zh-CN-YunxiNeural', role: '战术大局军师' },
  { id: 'gaming-koko', name: '可可', avatar: '🦊', voice: 'zh-CN-XiaoyiNeural', role: '元气开黑僚机' },
];

// 提取紧凑名字（去除“· 傲娇陪玩搭子”等后缀）
const getShortName = (name: string) => {
  if (!name) return '';
  return name.split(/[·•\-_(（]/)[0].trim() || name;
};

// 移除台词中可能冗余附带的角色名与引号前缀（如“可可：“...””）
const cleanDialogueLine = (text: string) => {
  if (!text) return '';
  return text.replace(/^[^：“”\n]{1,8}[：:]\s*[“"']?/, '').replace(/[”"']$/, '').trim();
};

export default function InteractiveGomokuModal({
  isOpen,
  onClose,
  spaceAgents = [],
  onShareToSpace,
  initialMode = 'pve',
  initialBlackId = 'gaming-lulu',
  initialWhiteId = 'gaming-nox',
}: InteractiveGomokuModalProps) {
  // 对弈模式：'pve' (人机切磋) | 'eve' (AI巅峰内战/观战)
  const [gameMode, setGameMode] = useState<'pve' | 'eve'>(initialMode);

  // 棋盘数据 (15x15 = 225)
  const [board, setBoard] = useState<number[]>(() => Array(225).fill(0));
  const [moveHistory, setMoveHistory] = useState<Array<{ row: number; col: number; player: number }>>([]);
  const [selectedOpponentId, setSelectedOpponentId] = useState<string>('gaming-lulu');

  // 成员内战 (EVE) 配置
  const [eveBlackId, setEveBlackId] = useState<string>(initialBlackId);
  const [eveWhiteId, setEveWhiteId] = useState<string>(initialWhiteId);
  const [isAutoPlaying, setIsAutoPlaying] = useState<boolean>(false);

  const [isAiThinking, setIsAiThinking] = useState(false);
  const [lastMove, setLastMove] = useState<{ row: number; col: number } | null>(null);
  const [winningLine, setWinningLine] = useState<Array<{ row: number; col: number }> | null>(null);
  const [hintCell, setHintCell] = useState<{ row: number; col: number } | null>(null);
  const [winner, setWinner] = useState<'player' | 'ai' | 'draw' | null>(null);

  // 谁在发言
  const [activeSpeakerId, setActiveSpeakerId] = useState<string>('gaming-lulu');
  const [speechText, setSpeechText] = useState<string>('哼，快进房间！今天本小姐就大发慈悲，陪你下一盘五子棋~ 你执黑先行！');
  const [autoVoice, setAutoVoice] = useState(false);

  const { play: playTTS, stop: stopTTS, isPlaying: isSpeaking, isBusy } = useTTS();
  const hintTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpokenMoveRef = useRef<number>(0);

  // 观战调度与最新状态引用，杜绝闭包陈旧与语音未播完即进入下一步
  const eveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isAutoPlayingRef = useRef<boolean>(isAutoPlaying);
  const winnerRef = useRef<'player' | 'ai' | 'draw' | null>(winner);
  const gameModeRef = useRef<'pve' | 'eve'>(gameMode);
  const boardRef = useRef<number[]>(board);
  const moveHistoryRef = useRef<Array<{ row: number; col: number; player: number }>>(moveHistory);
  const stepEveTurnRef = useRef<() => void>(() => {});

  isAutoPlayingRef.current = isAutoPlaying;
  winnerRef.current = winner;
  gameModeRef.current = gameMode;
  boardRef.current = board;
  moveHistoryRef.current = moveHistory;

  // 清除观战对弈定时器
  const clearEveTimer = useCallback(() => {
    if (eveTimerRef.current) {
      clearTimeout(eveTimerRef.current);
      eveTimerRef.current = null;
    }
  }, []);

  // 调度下一步 EVE 落子（语音感知型：严格等语音播报完成或静音间隔）
  const scheduleNextEveTurn = useCallback((delayMs = 1200) => {
    clearEveTimer();
    if (!isOpen || gameModeRef.current !== 'eve' || !isAutoPlayingRef.current || winnerRef.current !== null) {
      return;
    }

    eveTimerRef.current = setTimeout(() => {
      eveTimerRef.current = null;
      if (!isOpen || gameModeRef.current !== 'eve' || !isAutoPlayingRef.current || winnerRef.current !== null) {
        return;
      }
      stepEveTurnRef.current();
    }, delayMs);
  }, [isOpen, clearEveTimer]);

  // 查找 Agent 配置
  const getAgent = (id: string) => {
    return (
      spaceAgents.find((a) => a.id === id) ||
      DEFAULT_OPPONENTS.find((o) => o.id === id) ||
      DEFAULT_OPPONENTS[0]
    );
  };

  const opponent = getAgent(selectedOpponentId);
  const blackAgent = getAgent(eveBlackId);
  const whiteAgent = getAgent(eveWhiteId);

  // 当前说话者
  const currentSpeaker = getAgent(activeSpeakerId || (gameMode === 'eve' ? (moveHistory.length % 2 === 0 ? eveBlackId : eveWhiteId) : selectedOpponentId));

  // 重置对局
  const handleReset = (
    mode = gameMode,
    nextOpponentId = selectedOpponentId,
    nextBlack = eveBlackId,
    nextWhite = eveWhiteId
  ) => {
    stopTTS();
    clearEveTimer();
    const emptyBoard = Array(225).fill(0);
    setBoard(emptyBoard);
    boardRef.current = emptyBoard;
    setMoveHistory([]);
    moveHistoryRef.current = [];
    setLastMove(null);
    setWinningLine(null);
    setHintCell(null);
    setWinner(null);
    winnerRef.current = null;
    setIsAiThinking(false);
    lastSpokenMoveRef.current = 0;

    if (mode === 'pve') {
      const greeting =
        nextOpponentId === 'gaming-nox'
          ? '五子棋核心在于前 10 手的辐射控制与眼位抢占。黑方先行，请落子。'
          : nextOpponentId === 'gaming-koko'
          ? '好耶！五子棋大战启动！小狐狸可可执白，队长你先请冲冲冲！✨'
          : '哼，本小姐这次绝对要让你见识一下什么叫真正的高手！快下快下~';

      setSpeechText(greeting);
      setActiveSpeakerId(nextOpponentId);
      if (autoVoice) {
        const targetAgent = getAgent(nextOpponentId);
        playTTS(greeting, { voice: targetAgent.voice });
      }
    } else {
      const bAgent = getAgent(nextBlack);
      const wAgent = getAgent(nextWhite);
      const wName = getShortName(wAgent.name);
      const greeting = `这局我执黑先走，${wName}，可别一开局就被我拿下哦！`;
      setSpeechText(greeting);
      setActiveSpeakerId(nextBlack);
      setIsAutoPlaying(false);
      isAutoPlayingRef.current = false;

      if (autoVoice) {
        playTTS(greeting, {
          voice: bAgent.voice,
        });
      }
    }
  };

  // 响应外部传入的初始模式与弹窗开启
  useEffect(() => {
    if (isOpen) {
      const mode = initialMode || 'pve';
      const bId = initialBlackId || 'gaming-lulu';
      const wId = initialWhiteId || 'gaming-nox';
      setGameMode(mode);
      gameModeRef.current = mode;
      setEveBlackId(bId);
      setEveWhiteId(wId);
      handleReset(mode, selectedOpponentId, bId, wId);
    } else {
      stopTTS();
      clearEveTimer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialMode, initialBlackId, initialWhiteId]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      clearEveTimer();
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    };
  }, [clearEveTimer]);

  // 模式切换
  const handleSwitchMode = (targetMode: 'pve' | 'eve') => {
    if (targetMode === gameMode) return;
    setGameMode(targetMode);
    gameModeRef.current = targetMode;
    handleReset(targetMode, selectedOpponentId, eveBlackId, eveWhiteId);
  };

  // 观战对局快速选择
  const handleSelectMatchup = (bId: string, wId: string) => {
    setEveBlackId(bId);
    setEveWhiteId(wId);
    handleReset('eve', selectedOpponentId, bId, wId);
  };

  // PVE: 玩家落子 (黑子: 1)
  const handlePlayerMove = (row: number, col: number) => {
    if (gameMode !== 'pve' || isAiThinking || winner !== null) return;
    const idx = (row - 1) * 15 + (col - 1);
    if (board[idx] !== 0) return;

    setHintCell(null);
    playStoneSound(true);

    const nextBoard = [...board];
    nextBoard[idx] = 1;
    const nextHistory = [...moveHistory, { row, col, player: 1 }];

    boardRef.current = nextBoard;
    moveHistoryRef.current = nextHistory;
    setBoard(nextBoard);
    setLastMove({ row, col });
    setMoveHistory(nextHistory);

    // 检查玩家是否获胜
    const winCheck = checkWin(nextBoard, row, col, 1);
    if (winCheck.won) {
      setWinner('player');
      winnerRef.current = 'player';
      setWinningLine(winCheck.line || null);
      const winSpeech = getCharacterLine(opponent.id, 'player_won', { moveCount: nextHistory.length });
      setSpeechText(winSpeech);
      setActiveSpeakerId(opponent.id);
      lastSpokenMoveRef.current = nextHistory.length;
      if (autoVoice) playTTS(winSpeech, { voice: opponent.voice });
      return;
    }

    if (nextHistory.length >= 225) {
      setWinner('draw');
      winnerRef.current = 'draw';
      setSpeechText('棋盘下满啦，这把算和棋！');
      return;
    }

    // 触发 AI 白子思考落子
    setIsAiThinking(true);
    setTimeout(() => {
      triggerPveAiMove(nextBoard, nextHistory);
    }, 450);
  };

  // PVE: AI 落子 (白子: 2)
  const triggerPveAiMove = (currentBoard: number[], currentHistory: Array<{ row: number; col: number; player: number }>) => {
    const aiResult = findBestMove(currentBoard, 2, 1);
    const aiIdx = (aiResult.row - 1) * 15 + (aiResult.col - 1);

    playStoneSound(false);

    const nextBoard = [...currentBoard];
    nextBoard[aiIdx] = 2;
    const nextHistory = [...currentHistory, { row: aiResult.row, col: aiResult.col, player: 2 }];

    boardRef.current = nextBoard;
    moveHistoryRef.current = nextHistory;
    setBoard(nextBoard);
    setLastMove({ row: aiResult.row, col: aiResult.col });
    setMoveHistory(nextHistory);
    setIsAiThinking(false);

    // 检查 AI 获胜
    const aiWinCheck = checkWin(nextBoard, aiResult.row, aiResult.col, 2);
    if (aiWinCheck.won) {
      setWinner('ai');
      winnerRef.current = 'ai';
      setWinningLine(aiWinCheck.line || null);
      const aiWinSpeech = getCharacterLine(opponent.id, 'ai_won', { moveCount: nextHistory.length });
      setSpeechText(aiWinSpeech);
      setActiveSpeakerId(opponent.id);
      lastSpokenMoveRef.current = nextHistory.length;
      if (autoVoice) playTTS(aiWinSpeech, { voice: opponent.voice });
      return;
    }

    const comment = getCharacterLine(opponent.id, aiResult.situation, {
      moveCount: nextHistory.length,
      opponentId: 'user',
    });
    setSpeechText(comment);
    setActiveSpeakerId(opponent.id);

    if (autoVoice) {
      const isDramatic = ['ai_formed_four', 'ai_blocked_three'].includes(aiResult.situation);
      const movesCount = nextHistory.length;
      const movesSinceLastSpeech = movesCount - lastSpokenMoveRef.current;
      const shouldSpeakRoutine = movesSinceLastSpeech >= 4 && Math.random() < 0.35 && !isBusy;

      if (isDramatic || shouldSpeakRoutine) {
        lastSpokenMoveRef.current = movesCount;
        playTTS(comment, { voice: opponent.voice });
      }
    }
  };

  // EVE: 单步推进一次 AI 落子
  const stepEveTurn = () => {
    if (winnerRef.current !== null || moveHistoryRef.current.length >= 225) return;

    const currentHistory = moveHistoryRef.current;
    const currentBoard = boardRef.current;
    const currentTurn = currentHistory.length % 2 === 0 ? 1 : 2; // 1: 黑, 2: 白
    const currentAgentId = currentTurn === 1 ? eveBlackId : eveWhiteId;
    const currentAgent = getAgent(currentAgentId);
    const shortCurrentName = getShortName(currentAgent.name);
    const otherTurn = currentTurn === 1 ? 2 : 1;

    const moveResult = findBestMove(currentBoard, currentTurn, otherTurn);
    const idx = (moveResult.row - 1) * 15 + (moveResult.col - 1);

    playStoneSound(currentTurn === 1);

    const nextBoard = [...currentBoard];
    nextBoard[idx] = currentTurn;
    const nextHistory = [...currentHistory, { row: moveResult.row, col: moveResult.col, player: currentTurn }];

    boardRef.current = nextBoard;
    moveHistoryRef.current = nextHistory;
    setBoard(nextBoard);
    setLastMove({ row: moveResult.row, col: moveResult.col });
    setMoveHistory(nextHistory);

    // 检查获胜
    const winCheck = checkWin(nextBoard, moveResult.row, moveResult.col, currentTurn);
    if (winCheck.won) {
      setWinner(currentTurn === 1 ? 'player' : 'ai'); // player: 黑方赢, ai: 白方赢
      winnerRef.current = currentTurn === 1 ? 'player' : 'ai';
      setWinningLine(winCheck.line || null);
      setIsAutoPlaying(false);
      isAutoPlayingRef.current = false;
      clearEveTimer();

      const winLine = '五子连珠！这一局是我拿下了！🎉';
      setSpeechText(winLine);
      setActiveSpeakerId(currentAgentId);
      lastSpokenMoveRef.current = nextHistory.length;
      if (autoVoice) playTTS(winLine, { voice: currentAgent.voice });
      return;
    }

    if (nextHistory.length >= 225) {
      setWinner('draw');
      winnerRef.current = 'draw';
      setIsAutoPlaying(false);
      isAutoPlayingRef.current = false;
      clearEveTimer();
      setSpeechText('棋盘已满，两位战平！和棋！🤝');
      return;
    }

    // 伴随吐槽台词（带阶段感与专属羁绊互怼）
    const otherAgentId = currentTurn === 1 ? eveWhiteId : eveBlackId;
    const line = getCharacterLine(currentAgentId, moveResult.situation, {
      moveCount: nextHistory.length,
      opponentId: otherAgentId,
    });
    setSpeechText(line);
    setActiveSpeakerId(currentAgentId);

    const isDramatic = ['ai_formed_four', 'ai_blocked_three'].includes(moveResult.situation);
    const movesCount = nextHistory.length;
    const movesSinceLastSpeech = movesCount - lastSpokenMoveRef.current;
    const shouldSpeakRoutine = movesSinceLastSpeech >= 4 && Math.random() < 0.45;
    const willSpeak = autoVoice && (isDramatic || shouldSpeakRoutine);

    if (willSpeak) {
      lastSpokenMoveRef.current = movesCount;

      let timerFired = false;
      const safetyTimer = setTimeout(() => {
        if (!timerFired) {
          timerFired = true;
          scheduleNextEveTurn(600);
        }
      }, 7000);

      playTTS(line, {
        voice: currentAgent.voice,
        onEnded: () => {
          if (!timerFired) {
            timerFired = true;
            clearTimeout(safetyTimer);
            // 语音播报完整结束后，停顿 800ms 轮到下一个角色思考落子，决不打断台词
            scheduleNextEveTurn(800);
          }
        },
        onError: () => {
          if (!timerFired) {
            timerFired = true;
            clearTimeout(safetyTimer);
            scheduleNextEveTurn(1200);
          }
        },
      });
    } else {
      // 本步静音落子：平稳思考 1400ms 后轮到下一步
      scheduleNextEveTurn(1400);
    }
  };

  // 绑定最新 stepEveTurn 实现给引用
  stepEveTurnRef.current = stepEveTurn;

  // 接管观战对局 (Takeover)
  const handleTakeover = (takeoverPlayer: 1 | 2) => {
    clearEveTimer();
    setIsAutoPlaying(false);
    isAutoPlayingRef.current = false;
    setGameMode('pve');
    gameModeRef.current = 'pve';
    if (takeoverPlayer === 1) {
      // 玩家接管黑方，对手变成白方
      setSelectedOpponentId(eveWhiteId);
      const msg = `你已接管黑方！轮到你落子进攻！`;
      setSpeechText(msg);
      setActiveSpeakerId(eveWhiteId);
    } else {
      // 玩家接管白方，对手变成黑方
      setSelectedOpponentId(eveBlackId);
      const msg = `你已接管白方！随时做好防守反击准备！`;
      setSpeechText(msg);
      setActiveSpeakerId(eveBlackId);
    }
  };

  // 军师诺克斯战术支招
  const handleAdvisorHint = () => {
    if (winner !== null || isAiThinking) return;
    const hint = getAdvisorHint(board);
    setHintCell({ row: hint.row, col: hint.col });

    const hintSpeech =
      opponent.id === 'gaming-nox'
        ? `虽然我是你的对手，但从纯粹棋理而言，落子在第 ${hint.row} 行、第 ${hint.col} 列才是正着。${hint.reason}`
        : `【战术指路】建议落子在第 ${hint.row} 行、第 ${hint.col} 列。${hint.reason}`;
    setSpeechText(hintSpeech);
    setActiveSpeakerId('gaming-nox');
    playTTS(hintSpeech, { voice: 'zh-CN-YunxiNeural' });

    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => {
      setHintCell(null);
    }, 6000);
  };

  // 僚机可可元气应援
  const handleKokoCheer = () => {
    if (isAiThinking) return;
    const cheerSpeech = cleanDialogueLine(getKokoCheer(gameMode === 'eve' ? eveWhiteId : opponent.id, winner));
    setSpeechText(cheerSpeech);
    setActiveSpeakerId('gaming-koko');
    playTTS(cheerSpeech, { voice: 'zh-CN-XiaoyiNeural', pitch: '+10Hz' });
  };

  // 悔棋一手 (PVE)
  const handleUndo = () => {
    if (moveHistory.length < 2 || isAiThinking || winner !== null) return;
    stopTTS();
    const nextHistory = moveHistory.slice(0, -2);
    const nextBoard = Array(225).fill(0);
    for (const move of nextHistory) {
      nextBoard[(move.row - 1) * 15 + (move.col - 1)] = move.player;
    }
    const previousMove = nextHistory.at(-1) || null;
    setBoard(nextBoard);
    setMoveHistory(nextHistory);
    setLastMove(previousMove);
    setWinningLine(null);
    setHintCell(null);

    const undoComment = getUndoLine(opponent.id);
    setSpeechText(undoComment);
    setActiveSpeakerId(opponent.id);
    if (autoVoice) playTTS(undoComment, { voice: opponent.voice });
  };

  // 分享对局战报到空间
  const handleShare = () => {
    if (!onShareToSpace) return;
    const movesCount = moveHistory.length;
    let shareContent = '';

    if (gameMode === 'pve') {
      const oppName = getShortName(opponent.name);
      const resultText =
        winner === 'player'
          ? `🎉 玩家以五子连珠绝杀对手，共大战 ${movesCount} 手！`
          : winner === 'ai'
          ? `💀 ${oppName} 五子连珠获胜，共大战 ${movesCount} 手！`
          : `⚔️ 当前正在与 ${oppName} 对局，已交手 ${movesCount} 手！`;
      shareContent = `【五子棋开黑战报】\n对战双方：玩家（黑方 ●） vs ${oppName}（白方 ○）\n当前战况：${resultText}\n最后一手落子：${lastMove ? `(${lastMove.row}, ${lastMove.col})` : '天元'}\n大家来看看这场对局复盘吧！`;
    } else {
      const bName = getShortName(blackAgent.name);
      const wName = getShortName(whiteAgent.name);
      const resultText =
        winner === 'player'
          ? `🏆 【${bName}】（黑方）五子连珠击败【${wName}】！`
          : winner === 'ai'
          ? `🏆 【${wName}】（白方）五子连珠击败【${bName}】！`
          : `⚔️ 【${bName}】与【${wName}】胶着缠斗中，已交手 ${movesCount} 手！`;
      shareContent = `【开黑作战室内战战报】\n巅峰对决：${bName}（黑方 ●） vs ${wName}（白方 ○）\n对决结果：${resultText}\n总计对弈手数：${movesCount} 手\n战报已同步至开黑作战台，大家速来点评！`;
    }

    onShareToSpace(shareContent);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-sm">
      <div className="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
            {/* 顶部标题与模式切换栏 */}
            <header className="flex shrink-0 items-center justify-between border-b border-black/[0.08] px-3.5 py-2.5 sm:px-6 sm:py-3.5 bg-white">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-base sm:text-lg text-amber-600 shadow-inner">
                  ♟️
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm sm:text-base font-black text-slate-900 leading-tight">
                    五子棋对弈
                  </h2>
                  <div className="truncate text-[11px] font-semibold text-slate-400 leading-tight mt-0.5">
                    {gameMode === 'pve' ? (
                      <>
                        <span>你 (黑) vs {getShortName(opponent.name)} (白)</span>
                        <span className="mx-1">·</span>
                        <span>{moveHistory.length} 手</span>
                      </>
                    ) : (
                      <>
                        <span>{getShortName(blackAgent.name)} vs {getShortName(whiteAgent.name)}</span>
                        <span className="mx-1">·</span>
                        <span>{moveHistory.length} 手</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-black">
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('pve')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] sm:text-xs font-black transition ${
                      gameMode === 'pve' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <User size={12} />
                    <span className="hidden sm:inline">人机切磋</span>
                    <span className="sm:hidden">人机</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('eve')}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] sm:text-xs font-black transition ${
                      gameMode === 'eve' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Users size={12} />
                    <span className="hidden sm:inline">全员观战</span>
                    <span className="sm:hidden">观战</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const next = !autoVoice;
                    setAutoVoice(next);
                    if (!next) {
                      stopTTS();
                      if (gameMode === 'eve' && isAutoPlaying && !eveTimerRef.current) {
                        scheduleNextEveTurn(800);
                      }
                    } else if (speechText && currentSpeaker?.voice) {
                      playTTS(speechText, { voice: currentSpeaker.voice });
                    }
                  }}
                  title={autoVoice ? '点击关闭语音' : '点击开启语音'}
                  className={`flex h-8 sm:h-9 items-center gap-1.5 rounded-lg px-2 sm:px-2.5 text-xs font-bold transition ${
                    autoVoice
                      ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 ring-1 ring-amber-300/50'
                      : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                  }`}
                >
                  {autoVoice ? <Volume2 size={15} /> : <VolumeX size={15} />}
                  <span className="hidden md:inline">{autoVoice ? '语音开启' : '语音关闭'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    stopTTS();
                    clearEveTimer();
                    onClose();
                  }}
                  className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                  title="关闭"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            {/* 顶部选手配置选择栏 */}
            <div className="flex items-center justify-between border-b border-black/[0.06] bg-slate-50/80 px-3.5 py-1.5 sm:px-6 sm:py-2 overflow-x-auto no-scrollbar">
              {gameMode === 'pve' ? (
                <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
                  <span className="text-[11px] sm:text-xs font-black text-slate-400 shrink-0">选择对手：</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {DEFAULT_OPPONENTS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelectedOpponentId(item.id);
                          handleReset('pve', item.id);
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black transition ${
                          selectedOpponentId === item.id
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'bg-white text-slate-600 ring-1 ring-black/[0.08] hover:bg-slate-100'
                        }`}
                      >
                        <span>{item.avatar}</span>
                        <span>{item.name}</span>
                        <span className="hidden sm:inline text-[10px] opacity-75 font-normal">({item.role})</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
                  <span className="text-[11px] sm:text-xs font-black text-slate-400 shrink-0">内战阵容：</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {[
                      { b: 'gaming-lulu', w: 'gaming-nox', label: '🐱 璐璐 vs ♟️ 诺克斯', fullLabel: '🐱 璐璐 (黑) vs ♟️ 诺克斯 (白)' },
                      { b: 'gaming-koko', w: 'gaming-lulu', label: '🦊 可可 vs 🐱 璐璐', fullLabel: '🦊 可可 (黑) vs 🐱 璐璐 (白)' },
                      { b: 'gaming-koko', w: 'gaming-nox', label: '🦊 可可 vs ♟️ 诺克斯', fullLabel: '🦊 可可 (黑) vs ♟️ 诺克斯 (白)' },
                    ].map((matchup, idx) => {
                      const isActive = eveBlackId === matchup.b && eveWhiteId === matchup.w;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSelectMatchup(matchup.b, matchup.w)}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black whitespace-nowrap transition ${
                            isActive
                              ? 'bg-slate-900 text-white shadow-sm'
                              : 'bg-white text-slate-600 ring-1 ring-black/[0.08] hover:bg-slate-100'
                          }`}
                        >
                          <span className="sm:hidden">{matchup.label}</span>
                          <span className="hidden sm:inline">{matchup.fullLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

        {/* 核心对战区域 (棋盘 + 实时陪玩台词) */}
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-4 sm:p-6 lg:flex-row lg:items-start lg:gap-8">
          {/* 左侧实木棋盘 */}
          <div className="flex w-full max-w-[430px] flex-col items-center">
            <GomokuBoard
              board={board}
              interactive={gameMode === 'pve' && winner === null && !isAiThinking}
              disabled={gameMode === 'eve' || isAiThinking || winner !== null}
              lastMove={lastMove}
              winningLine={winningLine}
              hintCell={hintCell}
              onCellClick={handlePlayerMove}
              className="w-full"
            />

            {/* 棋盘下方状态条：三列对称布局，严格单行不换行 */}
            <div className="mt-3 grid w-full grid-cols-3 items-center text-xs font-black text-slate-500">
              <div className="flex items-center gap-1.5 justify-start min-w-0">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-slate-900 shadow-sm" />
                <span className="truncate whitespace-nowrap">
                  {gameMode === 'pve' ? '你 (执黑)' : `${getShortName(blackAgent.name)} (执黑)`}
                </span>
              </div>
              <div className="flex items-center justify-center gap-1.5 whitespace-nowrap text-center">
                {isAiThinking ? (
                  <span className="flex items-center gap-1 text-amber-600">
                    <span className="inline-block h-2 w-2 animate-ping rounded-full bg-amber-500" />
                    思考中...
                  </span>
                ) : winner ? (
                  <span className="font-black text-emerald-600">对局结束</span>
                ) : gameMode === 'eve' ? (
                  <span className="text-amber-700 font-bold truncate">
                    {!isAutoPlaying ? (
                      moveHistory.length === 0 ? '等待开局 (点击开始)' : '已暂停对弈'
                    ) : (
                      moveHistory.length % 2 === 0
                        ? `${getShortName(blackAgent.name)} 行棋`
                        : `${getShortName(whiteAgent.name)} 行棋`
                    )}
                  </span>
                ) : (
                  <span className="text-slate-400">轮到黑方落子</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 justify-end min-w-0">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300 bg-white shadow-sm" />
                <span className="truncate whitespace-nowrap">
                  {gameMode === 'pve' ? `${getShortName(opponent.name)} (执白)` : `${getShortName(whiteAgent.name)} (执白)`}
                </span>
              </div>
            </div>
          </div>

          {/* 右侧互动与台词面板 */}
          <div className="mt-4 flex w-full max-w-sm flex-col lg:mt-0">
            {/* 当前发言人卡片 */}
            <div className="relative rounded-2xl border border-black/[0.08] bg-gradient-to-b from-white to-slate-50/50 p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <Avatar src={currentSpeaker.avatar} alt={currentSpeaker.name} size="md" />
                  {isSpeaking && (
                    <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                      <Volume2 size={10} className="animate-pulse" />
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-slate-900">{currentSpeaker.name}</span>
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                      <Sparkles size={10} />
                      {'role' in currentSpeaker ? currentSpeaker.role : currentSpeaker.category || '陪玩成员'}
                    </span>
                  </div>

                  <div className="mt-2 text-xs font-semibold leading-relaxed text-slate-700">
                    {speechText}
                  </div>
                </div>
              </div>

              {/* 胜负状态提示 */}
              {winner && (
                <div
                  className={`mt-4 flex items-center justify-center gap-2 rounded-xl p-3 text-sm font-black shadow-sm ${
                    winner === 'player'
                      ? 'bg-emerald-500 text-white'
                      : winner === 'ai'
                      ? 'bg-rose-500 text-white'
                      : 'bg-slate-700 text-white'
                  }`}
                >
                  {gameMode === 'pve' ? (
                    winner === 'player'
                      ? '🎉 恭喜绝杀！五子连珠，你赢了！'
                      : winner === 'ai'
                      ? `💀 ${getShortName(opponent.name)} 五子连珠获胜！`
                      : '🤝 势均力敌，本局和棋！'
                  ) : (
                    winner === 'player'
                      ? `🎉 【${getShortName(blackAgent.name)}】（黑方）五子连珠胜出！`
                      : winner === 'ai'
                      ? `🎉 【${getShortName(whiteAgent.name)}】（白方）五子连珠胜出！`
                      : '🤝 势均力敌，双方握手言和！'
                  )}
                </div>
              )}
            </div>

            {/* 操作控制台 */}
            <div className="mt-4 flex flex-col gap-2">
              {gameMode === 'pve' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleAdvisorHint}
                      disabled={winner !== null || isAiThinking}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-black text-emerald-800 shadow-sm transition hover:bg-emerald-100 disabled:opacity-50"
                      title="军师严谨算路，给出当前最优落子点位建议"
                    >
                      <Lightbulb size={14} className="text-emerald-600" />
                      ♟️ 诺克斯支招
                    </button>

                    <button
                      type="button"
                      onClick={handleKokoCheer}
                      disabled={isAiThinking}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 text-xs font-black text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:opacity-50"
                      title="可可为你元气应援，并搞怪扰乱对手心态"
                    >
                      <Sparkles size={14} className="text-amber-500" />
                      🦊 可可元气应援
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={moveHistory.length < 2 || isAiThinking || winner !== null}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                    >
                      <RotateCcw size={13} />
                      悔棋一手
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReset('pve')}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                      <RotateCcw size={13} />
                      重新开局
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* 观战模式专属控制 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const nextAuto = !isAutoPlaying;
                        setIsAutoPlaying(nextAuto);
                        isAutoPlayingRef.current = nextAuto;
                        if (!nextAuto) {
                          clearEveTimer();
                        } else {
                          scheduleNextEveTurn(300);
                        }
                      }}
                      disabled={winner !== null}
                      className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-black shadow-sm transition disabled:opacity-50 ${
                        isAutoPlaying
                          ? 'bg-amber-500 text-white hover:bg-amber-600'
                          : 'border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 ring-1 ring-emerald-400/30'
                      }`}
                    >
                      {isAutoPlaying ? <Pause size={14} /> : <Play size={14} />}
                      {isAutoPlaying
                        ? '暂停自动落子'
                        : moveHistory.length === 0
                        ? '开始自动对弈'
                        : '继续自动落子'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (winner !== null || isAutoPlaying) return;
                        stepEveTurn();
                      }}
                      disabled={winner !== null || isAutoPlaying}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                    >
                      <SkipForward size={14} />
                      单步推进一步
                    </button>
                  </div>

                  {/* 接盘按键 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleTakeover(1)}
                      disabled={winner !== null}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-100 text-xs font-bold text-slate-800 transition hover:bg-slate-200 disabled:opacity-40"
                      title="看黑方快顶不住了？亲自接管黑方！"
                    >
                      <User size={13} />
                      我来接管黑方
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTakeover(2)}
                      disabled={winner !== null}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-slate-100 text-xs font-bold text-slate-800 transition hover:bg-slate-200 disabled:opacity-40"
                      title="看不惯黑方？亲自接管白方打反击！"
                    >
                      <User size={13} />
                      我来接管白方
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleReset('eve')}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    <RotateCcw size={13} />
                    重新对决
                  </button>
                </>
              )}

              {onShareToSpace && (
                <button
                  type="button"
                  onClick={handleShare}
                  className="mt-1 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-xs font-black text-white shadow-sm transition hover:bg-slate-800"
                >
                  <Share2 size={13} />
                  {gameMode === 'pve' ? '分享战报到开黑群' : '分享内战战报到空间'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
