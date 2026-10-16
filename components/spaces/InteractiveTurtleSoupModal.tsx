'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Image from 'next/image';
import {
  X,
  Volume2,
  VolumeX,
  Send,
  Loader2,
  Sparkles,
  HelpCircle,
  RotateCcw,
  BookOpen,
  Search,
  CheckCircle2,
  AlertCircle,
  HelpCircle as QuestionIcon,
  Award,
  Share2,
  Eye,
  Dice5,
  Lightbulb,
  UserCheck,
  ChevronDown,
  Trophy,
  Copy,
  Check,
  FileText,
  Flame,
  Skull,
  Brain,
  Coffee,
  Bookmark,
} from 'lucide-react';
import { useTTS } from '@/hooks/useTTS';
import { soupAudio } from '@/lib/turtle-soup/sound';
import { calculateDetectiveScore, getDetectiveTitle } from '@/lib/turtle-soup/scoring';
import luluImage from '@/src/lib/imgs/gaming-lulu.png';
import kekeImage from '@/src/lib/imgs/gaming-koko.png';
import mandyImage from '@/src/lib/imgs/gaming-mandy.png';
import suisuiImage from '@/src/lib/imgs/gaming-suisui.png';
import vivianImage from '@/src/lib/imgs/gaming-vivian.png';
import zeroImage from '@/src/lib/imgs/gaming-zero.png';
import type { Agent } from '@/types';
import type {
  TurtleSoupItem,
  TurtleSoupSummary,
  TurtleSoupJudgeResult,
  TurtleSoupMessage,
  TurtleSoupCategory,
  DetectiveScore,
} from '@/lib/turtle-soup/types';

const HOST_PORTRAITS: Record<string, any> = {
  'gaming-lulu': luluImage,
  'gaming-koko': kekeImage,
  'gaming-mandy': mandyImage,
  'gaming-suisui': suisuiImage,
  'gaming-vivian': vivianImage,
  'gaming-zero': zeroImage,
};

type CompanionAgent = Pick<Agent, 'id' | 'name'> & Partial<Agent>;

const DEFAULT_GAMING_AGENTS: CompanionAgent[] = [
  { id: 'gaming-lulu', name: '璐璐', tone: '二次元傲娇毒舌猫系少女，嘴硬心软', avatar: '🐱', category: '生活', voice: 'zh-CN-XiaoxiaoNeural' },
  { id: 'gaming-koko', name: '可可', tone: '元气满满、活力四射的小太阳', avatar: '☀️', category: '生活', voice: 'zh-CN-YunxiNeural' },
  { id: 'gaming-mandy', name: '曼迪', tone: '成熟优雅、温柔知性调酒师', avatar: '🍸', category: '生活', voice: 'zh-CN-XiaoxiaoNeural' },
  { id: 'gaming-suisui', name: '岁岁', tone: '软萌天然呆、慢节奏睡神', avatar: '☁️', category: '陪伴', voice: 'zh-CN-XiaoyiNeural' },
  { id: 'gaming-vivian', name: '薇薇安', tone: '暗黑神秘占星术士，中二宿命感', avatar: '🔮', category: '二次元', voice: 'zh-CN-XiaoxiaoNeural' },
  { id: 'gaming-zero', name: '零号机', tone: '冷静机械、高精度数据分析员', avatar: '🤖', category: '专业', voice: 'zh-CN-YunjianNeural' },
  { id: 'gaming-nox', name: '诺克斯', tone: '冷静理智军师，战术推演', avatar: '♟️', category: '专业', voice: 'zh-CN-YunjianNeural' },
];

interface InteractiveTurtleSoupModalProps {
  isOpen: boolean;
  onClose: () => void;
  spaceId: string;
  spaceAgents?: Agent[];
  onShareToSpace?: (content: string) => void;
}

export default function InteractiveTurtleSoupModal({
  isOpen,
  onClose,
  spaceId,
  spaceAgents = [],
  onShareToSpace,
}: InteractiveTurtleSoupModalProps) {
  // 可供选配的搭子池（空间现有成员 + 默认精选游戏伴侣）
  const availableAgents = useMemo(() => {
    const map = new Map<string, CompanionAgent>();
    DEFAULT_GAMING_AGENTS.forEach((a) => map.set(a.id, a));
    spaceAgents.forEach((a) => map.set(a.id, a));
    return Array.from(map.values());
  }, [spaceAgents]);

  // 默认优先匹配：左位璐璐、右位可可
  const defaultHostIds = useMemo(() => {
    const find = (keywords: string[]) => availableAgents.find((agent) => keywords.some((keyword) => agent.name.includes(keyword)));
    const first = find(['璐璐']) || availableAgents[0];
    const second = find(['可可']) || availableAgents.find((agent) => agent.id !== first?.id) || availableAgents[1] || availableAgents[0];
    return [first?.id || 'gaming-lulu', second?.id || 'gaming-koko'] as [string, string];
  }, [availableAgents]);

  const [selectedHostIds, setSelectedHostIds] = useState<[string, string]>(defaultHostIds);

  // 解析当前左右两位伴播搭子
  const hostLeft = useMemo(() => {
    return availableAgents.find((a) => a.id === selectedHostIds[0]) || availableAgents[0] || DEFAULT_GAMING_AGENTS[0];
  }, [availableAgents, selectedHostIds]);

  const hostRight = useMemo(() => {
    return availableAgents.find((a) => a.id === selectedHostIds[1]) || availableAgents[1] || DEFAULT_GAMING_AGENTS[1];
  }, [availableAgents, selectedHostIds]);

  // 1. 游戏主体状态
  const [currentPuzzle, setCurrentPuzzle] = useState<TurtleSoupItem | null>(null);
  const [puzzleIndex, setPuzzleIndex] = useState<number>(1);
  const [loadingPuzzle, setLoadingPuzzle] = useState<boolean>(false);
  const [messages, setMessages] = useState<TurtleSoupMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  // 2. 状态机：锦囊线索、破案状态、汤底揭晓
  const [unlockedHintsCount, setUnlockedHintsCount] = useState<number>(0);
  const [revealedAnswer, setRevealedAnswer] = useState<string | null>(null);
  const [isGameEnded, setIsGameEnded] = useState<boolean>(false);
  const [gameResult, setGameResult] = useState<'solved' | 'surrendered' | null>(null);
  const [isDossierOpen, setIsDossierOpen] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  // 3. 统计与成就状态 (350 题攻破进度)
  const [stats, setStats] = useState<{ solvedIds: string[]; surrenderedIds: string[] }>({
    solvedIds: [],
    surrenderedIds: [],
  });

  // 4. 题库书架抽屉状态
  const [isBookShelfOpen, setIsBookShelfOpen] = useState(false);
  const [puzzlesCatalog, setPuzzlesCatalog] = useState<TurtleSoupSummary[]>([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  // 5. 搭子发言状态气泡
  const [bubbleLeft, setBubbleLeft] = useState<string>('哼，今天的汤面看起来有点意思，指挥官你先问还是本小姐先问？');
  const [bubbleRight, setBubbleRight] = useState<string>('哇！探案包厢开启啦！指挥官加油，我们一定能把真相查个水落石出！✨');
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

  const { play: playTTS, stop: stopTTS } = useTTS();
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const activePuzzleIdRef = useRef<string>('');
  const activeRoundIdRef = useRef<string>(`round-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const pendingAbortRef = useRef<AbortController | null>(null);

  // 取消所有当前在途的网络请求
  const cancelAllPendingRequests = () => {
    if (pendingAbortRef.current) {
      pendingAbortRef.current.abort();
      pendingAbortRef.current = null;
    }
  };

  const storageKey = `almaren-turtlesoup-session:${spaceId}`;
  const statsStorageKey = 'almaren-turtlesoup-stats';

  // 统一鉴权请求头辅助函数
  const getAuthHeaders = (): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // 自动滚动到最新消息
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, bubbleLeft, bubbleRight]);

  // 弹窗关闭或离开时：主动停止语音伴播，并中止任何在途的网络请求
  useEffect(() => {
    if (!isOpen) {
      stopTTS();
      setActiveSpeakerId(null);
      cancelAllPendingRequests();
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // 初始化加载：从 localStorage 读取成就数据与对局
  useEffect(() => {
    if (!isOpen) return;

    // 读取全局成就历史
    try {
      const savedStats = localStorage.getItem(statsStorageKey);
      if (savedStats) {
        const parsedStats = JSON.parse(savedStats);
        setStats({
          solvedIds: Array.isArray(parsedStats.solvedIds) ? parsedStats.solvedIds : [],
          surrenderedIds: Array.isArray(parsedStats.surrenderedIds) ? parsedStats.surrenderedIds : [],
        });
      }
    } catch {
      // ignore
    }

    // 恢复对局
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.puzzle) {
          activePuzzleIdRef.current = parsed.puzzle.id;
          setCurrentPuzzle(parsed.puzzle);
          setPuzzleIndex(parsed.puzzleIndex || 1);
          setMessages(parsed.messages || []);
          setUnlockedHintsCount(parsed.unlockedHintsCount || 0);
          setRevealedAnswer(parsed.revealedAnswer || null);
          setIsGameEnded(Boolean(parsed.isGameEnded));
          setGameResult(parsed.gameResult || null);
          if (parsed.isGameEnded) {
            setIsDossierOpen(false); // 恢复时默认先显示聊天记录，允许点击卷宗唤起
          }
          if (Array.isArray(parsed.hostIds) && parsed.hostIds.length >= 2) {
            setSelectedHostIds([parsed.hostIds[0], parsed.hostIds[1]]);
          }
          if (parsed.bubbleLeft) setBubbleLeft(parsed.bubbleLeft);
          if (parsed.bubbleRight) setBubbleRight(parsed.bubbleRight);
          loadCatalog();
          return;
        }
      }
    } catch {
      // 容错降级
    }

    if (!currentPuzzle) {
      loadRandomPuzzle();
      loadCatalog();
    }
  }, [isOpen]);

  // 状态自动落盘 localStorage
  useEffect(() => {
    if (!currentPuzzle || !isOpen) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          puzzle: currentPuzzle,
          puzzleIndex,
          messages: messages.slice(-50),
          unlockedHintsCount,
          revealedAnswer,
          isGameEnded,
          gameResult,
          hostIds: selectedHostIds,
          bubbleLeft,
          bubbleRight,
        })
      );
    } catch {
      // ignore
    }
  }, [currentPuzzle, puzzleIndex, messages, unlockedHintsCount, revealedAnswer, isGameEnded, gameResult, selectedHostIds, bubbleLeft, bubbleRight, isOpen]);

  // 当书架目录加载完成时，二次核对当前题号，确保题号与实际书架编号完全一致
  useEffect(() => {
    if (puzzlesCatalog.length > 0 && currentPuzzle) {
      const foundIdx = puzzlesCatalog.findIndex((p) => p.id === currentPuzzle.id);
      if (foundIdx >= 0 && puzzleIndex !== foundIdx + 1) {
        setPuzzleIndex(foundIdx + 1);
      }
    }
  }, [puzzlesCatalog, currentPuzzle?.id]);

  // 语音播报函数封装
  const speakLine = (text: string, speakerId: string) => {
    if (!voiceEnabled) return;
    setActiveSpeakerId(speakerId);
    let voice = 'zh-CN-YunjianNeural';
    let rate = '1.0';

    const targetAgent = availableAgents.find((a) => a.id === speakerId);
    if (targetAgent?.voice) {
      voice = targetAgent.voice;
    } else if (speakerId === hostLeft.id) {
      voice = 'zh-CN-XiaoxiaoNeural';
      rate = '1.05';
    } else if (speakerId === hostRight.id) {
      voice = 'zh-CN-YunxiNeural';
      rate = '1.1';
    }

    playTTS(text, {
      voice,
      rate,
      onEnded: () => setActiveSpeakerId(null),
      onError: () => setActiveSpeakerId(null),
    });
  };

  // 加载随机一题
  const loadRandomPuzzle = async (excludeId?: string) => {
    cancelAllPendingRequests();
    const abortCtrl = new AbortController();
    pendingAbortRef.current = abortCtrl;
    const requestRoundId = `round-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    activeRoundIdRef.current = requestRoundId;

    setIsSubmitting(false);
    setLoadingPuzzle(true);
    try {
      const res = await fetch(
        `/api/turtle-soup/puzzles?action=random${excludeId ? `&exclude=${excludeId}` : ''}`,
        { headers: getAuthHeaders(), signal: abortCtrl.signal }
      );
      const json = await res.json();
      if (activeRoundIdRef.current !== requestRoundId) return;
      if (json.success && json.puzzle) {
        initNewGame(json.puzzle, json.index ?? json.puzzle?.index, requestRoundId);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Failed to load random puzzle:', e);
      }
    } finally {
      if (activeRoundIdRef.current === requestRoundId) {
        setLoadingPuzzle(false);
      }
    }
  };

  // 根据选定 ID 加载
  const loadSpecificPuzzle = async (id: string, index?: number) => {
    cancelAllPendingRequests();
    const abortCtrl = new AbortController();
    pendingAbortRef.current = abortCtrl;
    const requestRoundId = `round-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    activeRoundIdRef.current = requestRoundId;

    setIsSubmitting(false);
    setLoadingPuzzle(true);
    try {
      const res = await fetch(`/api/turtle-soup/puzzles?action=detail&id=${id}`, {
        headers: getAuthHeaders(),
        signal: abortCtrl.signal,
      });
      const json = await res.json();
      if (activeRoundIdRef.current !== requestRoundId) return;
      if (json.success && json.puzzle) {
        initNewGame(json.puzzle, index ?? json.index ?? json.puzzle?.index, requestRoundId);
        setIsBookShelfOpen(false);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Failed to load specific puzzle:', e);
      }
    } finally {
      if (activeRoundIdRef.current === requestRoundId) {
        setLoadingPuzzle(false);
      }
    }
  };

  // 加载 350 题库目录
  const loadCatalog = async () => {
    if (puzzlesCatalog.length > 0) return;
    setLoadingCatalog(true);
    try {
      const res = await fetch('/api/turtle-soup/puzzles', {
        headers: getAuthHeaders(),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.puzzles)) {
        setPuzzlesCatalog(json.puzzles);
      }
    } catch (e) {
      console.error('Failed to load catalog:', e);
    } finally {
      setLoadingCatalog(false);
    }
  };

  // 初始化新一局
  const initNewGame = (puzzle: TurtleSoupItem, explicitIndex?: number, roundId?: string) => {
    // 换题时彻底中止上一个对局的未决请求并重置状态，防止旧回复混入新题
    cancelAllPendingRequests();
    const currentRound = roundId || `round-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    activeRoundIdRef.current = currentRound;
    activePuzzleIdRef.current = puzzle.id;
    setIsSubmitting(false);
    stopTTS();
    setCurrentPuzzle(puzzle);

    // 严谨计算真实题号，杜绝随机伪造乱码题号
    let targetIndex = explicitIndex ?? puzzle.index;
    if (!targetIndex && puzzlesCatalog.length > 0) {
      const foundIdx = puzzlesCatalog.findIndex((p) => p.id === puzzle.id);
      if (foundIdx >= 0) targetIndex = foundIdx + 1;
    }
    setPuzzleIndex(targetIndex || 1);
    setUnlockedHintsCount(0);
    setRevealedAnswer(null);
    setIsGameEnded(false);
    setIsDossierOpen(false);
    setGameResult(null);
    setInputValue('');
    setMessages([
      {
        id: `init-${Date.now()}`,
        sender: 'dm',
        senderName: '主持人 DM',
        content: `【汤面】：${puzzle.story}\n\n请指挥官与${hostLeft.name}、${hostRight.name}开始推演！我只会回答“是”、“否”、“无关”或指出关键突破口。`,
        timestamp: Date.now(),
      },
    ]);
    const initLeft = `哼，这题听着就不简单！指挥官，你先发问，本${hostLeft.name === '璐璐' ? '小姐' : '探员'}在旁边给你盯梢！`;
    const initRight = `哇！抽到新题目啦！这故事好有悬念，指挥官我们快开始吧！✨`;
    setBubbleLeft(initLeft);
    setBubbleRight(initRight);
    speakLine(`海龟汤探案开局，题名：${puzzle.title}。请侦探队长开始提问。`, 'dm');
  };

  // 提交问题给裁判
  const handleAskQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = inputValue.trim();
    if (!q || !currentPuzzle || isSubmitting || isGameEnded) return;

    // 中止任何之前未决的网络请求
    cancelAllPendingRequests();
    const abortCtrl = new AbortController();
    pendingAbortRef.current = abortCtrl;
    const requestRoundId = activeRoundIdRef.current;
    const requestPuzzleId = currentPuzzle.id;

    setInputValue('');
    setIsSubmitting(true);

    const userMsgId = `usr-${Date.now()}`;
    const userMsg: TurtleSoupMessage = {
      id: userMsgId,
      sender: 'user',
      senderName: '你 (侦探队长)',
      content: q,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/turtle-soup/judge', {
        method: 'POST',
        headers: getAuthHeaders(),
        signal: abortCtrl.signal,
        body: JSON.stringify({
          puzzleId: currentPuzzle.id,
          question: q,
          type: 'question',
          history: messages.slice(-6),
          unlockedHintCount: unlockedHintsCount,
          companions: [
            { id: hostLeft.id, name: hostLeft.name, tone: hostLeft.tone, description: hostLeft.description },
            { id: hostRight.id, name: hostRight.name, tone: hostRight.tone, description: hostRight.description },
          ],
        }),
      });

      // 核心校验：如果用户在请求在途期间换题或重开对局，坚决丢弃旧对局的回复！
      if (activeRoundIdRef.current !== requestRoundId || activePuzzleIdRef.current !== requestPuzzleId) {
        return;
      }

      if (res.status === 401) {
        setInputValue(q); // 保留用户问题
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== userMsgId),
          {
            id: `err-${Date.now()}`,
            sender: 'dm',
            senderName: '主持人 DM',
            content: '⚠️ 请先登录账号后再开启海龟汤对局（本次提问未计入对局，已保留在输入框中）。',
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      const data = await res.json();

      if (!data.success || !data.result) {
        // 裁判服务异常或模型超时时，明确提示，从历史中回滚该条用户消息，绝不把失败计入提问统计
        const errMsg = data.error || '守秘人 DM 陷入迷雾，暂时未能判定该问题，请稍后重新提问。';
        setInputValue(q); // 保留问题方便一键重发
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== userMsgId),
          {
            id: `err-${Date.now()}`,
            sender: 'dm',
            senderName: '主持人 DM',
            content: `⚠️ ${errMsg}（本次提问未计入对局，已为您保留在输入框中）`,
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      const resObj: TurtleSoupJudgeResult = data.result;

      // 1. DM 裁判回复
      const dmMsg: TurtleSoupMessage = {
        id: `dm-${Date.now()}`,
        sender: 'dm',
        senderName: '主持人 DM',
        content: `${resObj.verdictLabel}。${resObj.dmExplanation}`,
        verdict: resObj.verdict,
        verdictLabel: resObj.verdictLabel,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, dmMsg]);

      // 2. 依次更新动态搭子气泡与台词
      const leftReaction = data.reactions?.[hostLeft.id] || resObj.luluReaction;
      const rightReaction = data.reactions?.[hostRight.id] || resObj.kokoReaction;

      if (leftReaction) setBubbleLeft(leftReaction);
      if (rightReaction) setBubbleRight(rightReaction);

      // 播报裁判语音与敲钟音效
      speakLine(`${resObj.verdictLabel}。${resObj.dmExplanation}`, 'dm');
      if (voiceEnabled) {
        soupAudio.playVerdict(resObj.verdict);
      }

      // 3. 判断是否破案
      if (resObj.isSolved || resObj.verdict === 'SOLVED') {
        setIsGameEnded(true);
        setGameResult('solved');
        revealTrueAnswer(requestPuzzleId, requestRoundId);
        recordGameStat(requestPuzzleId, 'solved');
        setIsDossierOpen(true);
        if (voiceEnabled) {
          setTimeout(() => soupAudio.playStampThud(), 400);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // 请求被主动中止，无需处理
        return;
      }
      console.error('Judge error:', err);
      if (activeRoundIdRef.current === requestRoundId && activePuzzleIdRef.current === requestPuzzleId) {
        setInputValue(q); // 恢复输入框内容
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== userMsgId),
          {
            id: `err-${Date.now()}`,
            sender: 'dm',
            senderName: '主持人 DM',
            content: '⚠️ 守秘人 DM 陷入迷雾（网络连接异常），本次提问未计入对局，已为您保留在输入框中。',
            timestamp: Date.now(),
          },
        ]);
      }
    } finally {
      if (activeRoundIdRef.current === requestRoundId && activePuzzleIdRef.current === requestPuzzleId) {
        setIsSubmitting(false);
      }
    }
  };

  // 找搭子支招
  const handleAskAdvice = async (targetAgent: CompanionAgent) => {
    if (!currentPuzzle || isSubmitting || isGameEnded) return;

    cancelAllPendingRequests();
    const abortCtrl = new AbortController();
    pendingAbortRef.current = abortCtrl;
    const requestRoundId = activeRoundIdRef.current;
    const requestPuzzleId = currentPuzzle.id;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/turtle-soup/judge', {
        method: 'POST',
        headers: getAuthHeaders(),
        signal: abortCtrl.signal,
        body: JSON.stringify({
          puzzleId: currentPuzzle.id,
          type: 'advice',
          targetAgentId: targetAgent.id,
          history: messages.slice(-6),
          unlockedHintCount: unlockedHintsCount,
          companions: [
            { id: hostLeft.id, name: hostLeft.name, tone: hostLeft.tone, description: hostLeft.description },
            { id: hostRight.id, name: hostRight.name, tone: hostRight.tone, description: hostRight.description },
          ],
        }),
      });

      if (activeRoundIdRef.current !== requestRoundId || activePuzzleIdRef.current !== requestPuzzleId) return;

      const data = await res.json();
      if (data.success && data.advice) {
        const adv = data.advice;
        const msg: TurtleSoupMessage = {
          id: `adv-${Date.now()}`,
          sender: targetAgent.id as any,
          senderName: adv.agentName,
          content: `💡 【给队长的支招】：${adv.content}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
        if (targetAgent.id === hostLeft.id) setBubbleLeft(adv.content);
        if (targetAgent.id === hostRight.id) setBubbleRight(adv.content);
        speakLine(adv.content, targetAgent.id);
      } else if (data.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: `adv-err-${Date.now()}`,
            sender: targetAgent.id as any,
            senderName: targetAgent.name,
            content: `💡 正在深度思考中，暂时未能想到新点子，队长稍后再叫我哦！`,
            timestamp: Date.now(),
          },
        ]);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Advice error:', err);
    } finally {
      if (activeRoundIdRef.current === requestRoundId && activePuzzleIdRef.current === requestPuzzleId) {
        setIsSubmitting(false);
      }
    }
  };

  // 解锁下一条锦囊提示
  const handleUnlockNextHint = () => {
    if (!currentPuzzle || unlockedHintsCount >= currentPuzzle.hints.length) return;
    const nextIdx = unlockedHintsCount;
    const hintText = currentPuzzle.hints[nextIdx];
    setUnlockedHintsCount((prev) => prev + 1);

    if (voiceEnabled) {
      soupAudio.playClueUnlock();
    }

    const hintMsg: TurtleSoupMessage = {
      id: `hint-${Date.now()}`,
      sender: 'dm',
      senderName: '主持人 DM (线索锦囊)',
      content: `💡 【第 ${nextIdx + 1} 重锦囊线索】：${hintText}`,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, hintMsg]);
    setBubbleRight(`哇！开启了新的线索锦囊：“${hintText}”！指挥官快顺着这个推！`);
    speakLine(`解锁第${nextIdx + 1}条线索提示：${hintText}`, 'dm');
  };

  // 记录通关与成就状态落盘
  const recordGameStat = (puzzleId: string, result: 'solved' | 'surrendered') => {
    setStats((prev) => {
      const solved = new Set(prev.solvedIds);
      const surrendered = new Set(prev.surrenderedIds);
      if (result === 'solved') {
        solved.add(puzzleId);
        surrendered.delete(puzzleId);
      } else {
        if (!solved.has(puzzleId)) {
          surrendered.add(puzzleId);
        }
      }
      const next = {
        solvedIds: Array.from(solved),
        surrenderedIds: Array.from(surrendered),
      };
      try {
        localStorage.setItem(statsStorageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // 清除重来 / 重置本局对局
  const handleRestartGame = () => {
    if (!currentPuzzle) return;
    // 若当前正在推演且已有提问，弹出防误触二次确认
    if (!isGameEnded && userQuestionsCount > 0) {
      if (typeof window !== 'undefined' && !window.confirm('确定要清空当前的提问记录与线索，重新挑战本题吗？')) {
        return;
      }
    }
    initNewGame(currentPuzzle, puzzleIndex);
  };

  // 认输 / 揭晓完整汤底
  const handleSurrender = async () => {
    if (!currentPuzzle || isGameEnded) return;
    // 认输时立即强制中止正在请求的任何未决裁判或支招任务，防止旧在途请求返回后覆盖认输状态甚至误判破案！
    cancelAllPendingRequests();
    setIsSubmitting(false);
    setIsGameEnded(true);
    setGameResult('surrendered');
    const targetRound = activeRoundIdRef.current;
    const targetPuzzleId = currentPuzzle.id;
    await revealTrueAnswer(targetPuzzleId, targetRound);
    // 异步安全校验：若揭底网络请求期间用户已切换题目或开启新对局，坚决丢弃旧局状态，防止旧卷宗弹出与串台播报
    if (activeRoundIdRef.current !== targetRound || activePuzzleIdRef.current !== targetPuzzleId) {
      return;
    }
    recordGameStat(targetPuzzleId, 'surrendered');
    setIsDossierOpen(true);
    if (voiceEnabled) {
      setTimeout(() => soupAudio.playStampThud(), 400);
    }
    setBubbleLeft(`哼，这就认输了吗？不过这道题确实太刁钻了，赶紧看看真相到底有多离谱！`);
    speakLine('本局结束，正在揭开真相汤底。', 'dm');
  };

  // 获取完整答案揭示（严格对齐题目 ID 与对局编号，杜绝异步串台）
  const revealTrueAnswer = async (puzzleId?: string, roundId?: string) => {
    const targetPuzzleId = puzzleId || currentPuzzle?.id;
    const targetRound = roundId || activeRoundIdRef.current;
    if (!targetPuzzleId) return;

    const abortCtrl = new AbortController();
    pendingAbortRef.current = abortCtrl;

    try {
      const res = await fetch(`/api/turtle-soup/puzzles?action=detail&id=${targetPuzzleId}&revealAnswer=true`, {
        headers: getAuthHeaders(),
        signal: abortCtrl.signal,
      });
      const data = await res.json();
      // 核心校验：若用户在等待期间换了题或重开了对局，坚决不写入新对局！
      if (activeRoundIdRef.current !== targetRound || activePuzzleIdRef.current !== targetPuzzleId) {
        return;
      }
      if (data.success && data.puzzle?.answer) {
        setRevealedAnswer(data.puzzle.answer);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Failed to reveal answer:', e);
      }
    }
  };

  // 侦探称号与段位
  const solvedCount = stats.solvedIds.length;
  const detectiveTitle = useMemo(() => getDetectiveTitle(solvedCount), [solvedCount]);

  // 结案战绩评级与评分：只严格统计得到了主持人有效裁决（是/否/无关/关键线索/破案）的成功提问轮数
  const userQuestionsCount = useMemo(() => {
    return messages.filter((m) => m.sender === 'dm' && Boolean(m.verdict)).length;
  }, [messages]);

  const dossierScore = useMemo<DetectiveScore>(() => {
    return calculateDetectiveScore(
      gameResult === 'solved',
      userQuestionsCount,
      unlockedHintsCount
    );
  }, [gameResult, userQuestionsCount, unlockedHintsCount]);

  // 搭子结案专属语录
  const companionLeftClosingComment = useMemo(() => {
    if (gameResult === 'solved') {
      if (hostLeft.name === '璐璐') {
        return '哼，虽然提问有点笨拙，但最后这几步推理还算有点样子，本小姐就勉为其难夸你一次吧！';
      }
      return `精彩的推理，队长！与你搭档破案是我的荣幸，真相大白的感觉真不错。`;
    }
    return hostLeft.name === '璐璐'
      ? '本小姐早就觉得这题不按常理出牌了！没事，下次本小姐亲自帮你把关！'
      : '这道汤底确实出人意料，胜败乃兵家常事，整理卷宗再战下一盘吧！';
  }, [gameResult, hostLeft.name]);

  const companionRightClosingComment = useMemo(() => {
    if (gameResult === 'solved') {
      if (hostRight.name === '可可') {
        return '哇啊啊啊！队长破案啦！太帅太厉害啦！✨ 今晚必须请大家喝奶茶庆祝！🧋';
      }
      return `太棒了队长！完美还原了案件全貌，今天我们绝对是最佳拍档！🎉`;
    }
    return hostRight.name === '可可'
      ? '呜呜虽然这题好虐/好烧脑，但和队长一起头脑风暴的过程超开心！我们抽下一碗吧！'
      : '真相往往藏在最意想不到的地方，已经很棒了，随时准备开启下一案！';
  }, [gameResult, hostRight.name]);

  // 复制精美卷宗文本
  const handleCopyReport = () => {
    if (!currentPuzzle) return;
    const lines = [
      `📜 【海龟汤 · 迷雾探案绝密卷宗】`,
      `🏆 案件状态：${gameResult === 'solved' ? '破案结案' : '悬案揭秘'} | 评级：[${dossierScore.rank}] ${dossierScore.rankTitle}`,
      `🔍 案件题号：#${puzzleIndex} 《${currentPuzzle.title}》`,
      `📜 汤面谜题：${currentPuzzle.story}`,
      `🔑 核心真相：${revealedAnswer || currentPuzzle.answer}`,
      `📊 探案数据：提问 ${userQuestionsCount} 轮 | 消耗线索 ${unlockedHintsCount}/${currentPuzzle.hints.length} 重`,
      `👥 侦探搭子：${hostLeft.name} & ${hostRight.name}`,
      `💬 结案评语：${dossierScore.comment}`,
    ];
    void navigator.clipboard.writeText(lines.join('\n'));
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  // 关闭弹窗清理：停止语音伴播，并中止任何在途网络请求
  const handleModalClose = () => {
    stopTTS();
    setActiveSpeakerId(null);
    if (pendingAbortRef.current) {
      pendingAbortRef.current.abort();
      pendingAbortRef.current = null;
    }
    setIsSubmitting(false);
    onClose();
  };

  // 分享推演战报到空间群聊
  const handleShareToSpace = () => {
    if (!onShareToSpace || !currentPuzzle) return;
    const outcomeText = gameResult === 'solved'
      ? `🏆 破案结案！评级【${dossierScore.rank} · ${dossierScore.rankTitle}】`
      : `📖 悬案归档 · 真相揭晓`;
    const lines = [
      `🐢 **【海龟汤 · 探案绝密卷宗】** ${outcomeText}`,
      `**题目**：#${puzzleIndex} 《${currentPuzzle.title}》`,
      `**汤面**：${currentPuzzle.story}`,
      `**真相汤底**：${revealedAnswer || currentPuzzle.answer}`,
      `**战绩数据**：${userQuestionsCount} 轮敲钟提问 | 消耗线索 ${unlockedHintsCount}/${currentPuzzle.hints.length} 重`,
      `**同行探案搭子**：${hostLeft.name} & ${hostRight.name}`,
      `**DM 守秘人评语**：“${dossierScore.comment}”`,
    ];
    onShareToSpace(lines.join('\n\n'));
    handleModalClose();
  };

  // 渲染头像组件 (支持立绘 / 头像 / Emoji)
  const renderAgentAvatar = (agent: CompanionAgent, isSpeakerActive: boolean) => {
    const portrait = HOST_PORTRAITS[agent.id];
    if (portrait) {
      return (
        <Image
          src={portrait}
          alt={agent.name}
          fill
          className="object-cover object-top"
          priority
        />
      );
    }
    // 非六大预设立绘时，使用 avatar 或 emoji
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-100 to-amber-200/80 text-3xl font-black text-amber-800">
        {agent.avatar || '🕵️'}
      </div>
    );
  };

  // 过滤后的 350 题库书架
  const filteredCatalog = useMemo(() => {
    let list = puzzlesCatalog;
    if (selectedCategory === '🏆 已破案') {
      list = list.filter((p) => stats.solvedIds.includes(p.id));
    } else if (selectedCategory !== '全部') {
      list = list.filter((p) => p.category === selectedCategory);
    }
    if (!catalogSearch.trim()) return list;
    const s = catalogSearch.toLowerCase();
    return list.filter((p) =>
      p.title.toLowerCase().includes(s) ||
      String(p.index).includes(s) ||
      p.storySnippet.toLowerCase().includes(s)
    );
  }, [puzzlesCatalog, selectedCategory, catalogSearch, stats.solvedIds]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col w-screen h-screen bg-[#f7f5f0] text-slate-900 select-none overflow-hidden animate-in fade-in duration-200">
      {/* 主探案包厢容器 (100% 全屏铺满沉浸式视口 · 温暖亮色羊皮探案包厢) */}
      <div className="relative flex flex-col h-full w-full bg-[#fbfaf7] overflow-hidden">
        
        {/* 顶部标题栏 (响应式精简适配：手机端轻量不折行) */}
        <div className="flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-slate-200/90 bg-white/95 backdrop-blur-sm shrink-0 shadow-2xs">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-amber-500/15 text-lg sm:text-xl ring-1 ring-amber-400/30 text-amber-600 shadow-inner shrink-0">
              🐢
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h3 className="text-sm sm:text-base font-black text-slate-900 tracking-wide font-serif truncate">
                  <span className="hidden sm:inline">海龟汤 · 迷雾探案包厢</span>
                  <span className="sm:hidden">海龟汤</span>
                </h3>
                <span className="rounded-full bg-emerald-50 border border-emerald-300 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-emerald-800 shadow-2xs shrink-0">
                  <span className="hidden sm:inline">{detectiveTitle.badge} {detectiveTitle.title} ({solvedCount}/350)</span>
                  <span className="sm:hidden">{detectiveTitle.badge} {solvedCount}/350</span>
                </span>
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-500 font-medium mt-0.5 truncate max-w-[130px] sm:max-w-md">
                当前对局：#{puzzleIndex} 《{currentPuzzle?.title || '加载中...'}》
              </p>
            </div>
          </div>

          {/* 右侧动作条 (手机端只保留精巧图标，桌面端显示完整文字) */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {isGameEnded && (
              <button
                type="button"
                onClick={() => {
                  setIsDossierOpen(true);
                  if (voiceEnabled) soupAudio.playStampThud();
                }}
                className="inline-flex items-center gap-1.5 p-2 sm:px-3 sm:py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-black border border-rose-300 shadow-2xs animate-pulse transition cursor-pointer"
                title={`查看结案卷宗 [${dossierScore.rank}]`}
              >
                <FileText size={15} className="text-rose-600" />
                <span className="hidden sm:inline">结案卷宗 [{dossierScore.rank}]</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => loadRandomPuzzle(currentPuzzle?.id)}
              disabled={loadingPuzzle}
              className="inline-flex items-center gap-1.5 p-2 sm:px-3 sm:py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200 shadow-2xs transition cursor-pointer"
              title="换一碗（随机抽取新汤）"
            >
              <Dice5 size={15} className={loadingPuzzle ? 'animate-spin text-amber-600' : 'text-amber-600'} />
              <span className="hidden sm:inline">换一碗</span>
            </button>

            <button
              type="button"
              onClick={() => {
                loadCatalog();
                setIsBookShelfOpen(true);
              }}
              className="inline-flex items-center gap-1.5 p-2 sm:px-3 sm:py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold border border-amber-300 shadow-2xs transition cursor-pointer"
              title="350 题库宝藏书架"
            >
              <BookOpen size={15} className="text-amber-700" />
              <span className="hidden sm:inline">350题库</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setVoiceEnabled(!voiceEnabled);
                if (voiceEnabled) stopTTS();
              }}
              className={`p-2 rounded-xl border transition cursor-pointer shadow-2xs ${
                voiceEnabled
                  ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200/80'
                  : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
              }`}
              title={voiceEnabled ? '关闭语音伴播与敲钟音效' : '开启语音伴播与敲钟音效'}
            >
              {voiceEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>

            <button
              type="button"
              onClick={handleModalClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
              title="退出海龟汤探案包厢"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 主体交互视口 */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* 下半部分：侦探推演公屏记录流 */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 bg-[#fbfaf7]">
            <div className="max-w-4xl mx-auto space-y-3.5">
              {messages.map((msg) => {
                const isUser = msg.sender === 'user';
                const isDM = msg.sender === 'dm';
                const isLeft = msg.sender === hostLeft.id;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-3xl ${
                      isUser ? 'ml-auto' : 'mr-auto'
                    }`}
                  >
                    {/* 发送人标签 */}
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <span className="text-[11px] font-bold text-slate-500">
                        {msg.senderName}
                      </span>
                      {msg.verdictLabel && (
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border shadow-2xs ${
                          msg.verdict === 'YES'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : msg.verdict === 'NO'
                            ? 'bg-rose-50 text-rose-800 border-rose-300'
                            : msg.verdict === 'KEY_POINT'
                            ? 'bg-amber-100 text-amber-950 border-amber-400 ring-1 ring-amber-300 animate-pulse'
                            : msg.verdict === 'SOLVED'
                            ? 'bg-purple-100 text-purple-950 border-purple-400 ring-1 ring-purple-300 animate-bounce'
                            : 'bg-slate-100 text-slate-700 border-slate-300'
                        }`}>
                          {msg.verdictLabel}
                        </span>
                      )}
                    </div>

                    {/* 消息正文气泡 */}
                    <div
                      className={`rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap shadow-2xs ${
                        isUser
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-tr-sm'
                          : isDM
                          ? 'bg-white border border-slate-200/90 text-slate-800 rounded-tl-sm'
                          : isLeft
                          ? 'bg-amber-50/80 border border-amber-200 text-amber-950 rounded-tl-sm'
                          : 'bg-orange-50/80 border border-orange-200 text-slate-800 rounded-tl-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              })}

              {/* 破案完成 / 揭秘卡片 */}
              {isGameEnded && revealedAnswer && (
                <div className="my-6 rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-[#fffef9] via-[#fefaf0] to-[#f8f3e8] p-5 shadow-lg text-center max-w-2xl mx-auto">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span className="text-3xl">{gameResult === 'solved' ? '🏆' : '📖'}</span>
                    <h4 className="text-lg font-black text-amber-950 font-serif">
                      {gameResult === 'solved' ? '恭喜破案！核心真相完全还原！' : '本局结束 · 揭晓真实汤底'}
                    </h4>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-800 leading-relaxed text-left font-serif p-3.5 bg-white/90 rounded-xl border border-amber-200/90 mb-4 whitespace-pre-wrap shadow-2xs">
                    {revealedAnswer}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={handleShareToSpace}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-black shadow-2xs transition cursor-pointer"
                    >
                      <Share2 size={14} />
                      <span>同步战报到空间群聊</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleRestartGame}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-black border border-amber-300 shadow-2xs transition cursor-pointer"
                    >
                      <RotateCcw size={14} className="text-amber-700" />
                      <span>重新挑战本局</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => loadRandomPuzzle(currentPuzzle?.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 text-xs font-black border border-slate-200 shadow-2xs transition cursor-pointer"
                    >
                      <Dice5 size={14} className="text-amber-600" />
                      <span>换一碗新汤</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 底部输入与操作条 */}
          <div className="border-t border-slate-200/90 bg-white/95 backdrop-blur-sm px-4 sm:px-6 py-3 shrink-0 shadow-xs">
            <div className="max-w-4xl mx-auto">
              {/* 快捷支招气泡条 · 伙伴支招、锦囊、清除重来与认输 */}
              {!isGameEnded ? (
                <div className="flex items-center gap-2 mb-2.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                  <span className="text-[11px] font-bold text-slate-500 shrink-0">
                    队内伙伴：
                  </span>

                  {/* 伙伴 1 (支招 + 换人) */}
                  <div className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200/90 text-slate-700 text-xs shadow-2xs shrink-0 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleAskAdvice(hostLeft)}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1 px-2.5 py-1 hover:bg-slate-200/80 font-semibold transition cursor-pointer disabled:opacity-50"
                      title={`找 ${hostLeft.name} 支招分析`}
                    >
                      <span>💬 找 {hostLeft.name} 支招</span>
                    </button>
                    <div className="relative border-l border-slate-300/80 px-1.5 py-1 hover:bg-slate-200/80 cursor-pointer flex items-center" title={`更换伙伴（当前：${hostLeft.name}）`}>
                      <ChevronDown size={11} className="text-slate-500" />
                      <select
                        value={selectedHostIds[0]}
                        onChange={(e) => setSelectedHostIds(([_, r]) => [e.target.value, r])}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        title="更换左席伙伴"
                      >
                        {availableAgents.map((a) => (
                          <option key={a.id} value={a.id} disabled={a.id === selectedHostIds[1]}>
                            换为: {a.name} ({a.tone})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* 伙伴 2 (灵感 + 换人) */}
                  <div className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs shadow-2xs shrink-0 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleAskAdvice(hostRight)}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1 px-2.5 py-1 hover:bg-amber-100 font-semibold transition cursor-pointer disabled:opacity-50"
                      title={`听听 ${hostRight.name} 的灵感猜想`}
                    >
                      <span>💡 听 {hostRight.name} 灵感</span>
                    </button>
                    <div className="relative border-l border-amber-300/80 px-1.5 py-1 hover:bg-amber-100 cursor-pointer flex items-center" title={`更换伙伴（当前：${hostRight.name}）`}>
                      <ChevronDown size={11} className="text-amber-700" />
                      <select
                        value={selectedHostIds[1]}
                        onChange={(e) => setSelectedHostIds(([l, _]) => [l, e.target.value])}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        title="更换右席伙伴"
                      >
                        {availableAgents.map((a) => (
                          <option key={a.id} value={a.id} disabled={a.id === selectedHostIds[0]}>
                            换为: {a.name} ({a.tone})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {unlockedHintsCount < (currentPuzzle?.hints.length || 3) && (
                    <button
                      type="button"
                      onClick={handleUnlockNextHint}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100/70 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold transition cursor-pointer shrink-0 shadow-2xs"
                    >
                      <Lightbulb size={12} />
                      <span>揭开锦囊 ({unlockedHintsCount + 1}/3)</span>
                    </button>
                  )}

                  <div className="flex items-center gap-1.5 ml-auto shrink-0">
                    <button
                      type="button"
                      onClick={handleRestartGame}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 border border-slate-200 text-slate-600 text-xs font-semibold transition cursor-pointer shrink-0 shadow-2xs"
                      title="清空记录重新挑战当前谜题"
                    >
                      <RotateCcw size={11} className="text-slate-500" />
                      <span>清除重来</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSurrender}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 border border-slate-200 text-slate-500 text-xs font-semibold transition cursor-pointer shrink-0 shadow-2xs"
                      title="认输并揭晓真实汤底"
                    >
                      <span>🏳️ 认输揭底</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-2.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                  <span className="text-[11px] font-bold text-slate-400 shrink-0">
                    本局已结案：
                  </span>
                  <button
                    type="button"
                    onClick={handleRestartGame}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold transition cursor-pointer shrink-0 shadow-2xs"
                    title="清空记录重新挑战本题"
                  >
                    <RotateCcw size={12} className="text-amber-700" />
                    <span>重新挑战本局</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => loadRandomPuzzle(currentPuzzle?.id)}
                    disabled={loadingPuzzle}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer shrink-0 shadow-2xs"
                    title="随机抽取新汤"
                  >
                    <Dice5 size={12} className={loadingPuzzle ? 'animate-spin text-amber-600' : 'text-amber-600'} />
                    <span>换一碗新汤</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsDossierOpen(true);
                      if (voiceEnabled) soupAudio.playStampThud();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-700 text-xs font-bold transition cursor-pointer shrink-0 shadow-2xs"
                    title="查看绝密结案卷宗"
                  >
                    <FileText size={12} className="text-rose-600" />
                    <span>绝密卷宗</span>
                  </button>
                </div>
              )}

              {/* 单主输入框 */}
              <form onSubmit={handleAskQuestion} className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  disabled={isSubmitting || isGameEnded}
                  placeholder={
                    isGameEnded
                      ? '本局推演已结案，可点击上方按钮重新挑战或抽取新题。'
                      : `🛎️ 向主持人 DM 敲钟提问（如：死者是否在室内？... 按回车发送）`
                  }
                  className="flex-1 rounded-xl bg-[#fbfaf7] border border-slate-300 px-4 py-2.5 text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20 transition"
                />
                <button
                  type="submit"
                  disabled={!inputValue.trim() || isSubmitting || isGameEnded}
                  className="inline-flex items-center justify-center gap-1.5 h-10 px-5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-black shadow-2xs transition cursor-pointer shrink-0"
                >
                  {isSubmitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <>
                      <Send size={15} />
                      <span>提问</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

        </div>

        {/* 📚 350 题库书架抽屉 (Slide Drawer) */}
        {isBookShelfOpen && (
          <div className="absolute inset-0 z-20 flex justify-end bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="flex flex-col h-full w-full max-w-md bg-white border-l border-slate-200 p-5 shadow-2xl">
              
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📚</span>
                  <h4 className="text-base font-black text-slate-900 font-serif">
                    350 海龟汤宝藏书架
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setIsBookShelfOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 侦探成就进度横幅 */}
              <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-[#fefaf0] to-amber-50/50 p-3 my-2.5 shrink-0 shadow-2xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{detectiveTitle.badge}</span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black text-amber-950 font-serif">{detectiveTitle.title}</span>
                        <span className="text-[10px] text-amber-700 font-bold">Lv.{detectiveTitle.level}</span>
                      </div>
                      <p className="text-[10px] text-slate-500">已攻破 {solvedCount} / {puzzlesCatalog.length || 350} 题</p>
                    </div>
                  </div>
                  <span className="text-sm font-black text-amber-800 font-mono">
                    {Math.min(100, Math.round((solvedCount / (puzzlesCatalog.length || 350)) * 100))}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-500 rounded-full"
                    style={{ width: `${Math.min(100, Math.round((solvedCount / (puzzlesCatalog.length || 350)) * 100))}%` }}
                  />
                </div>
              </div>

              {/* 分类快捷标签 */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-2 text-[11px] shrink-0 no-scrollbar">
                {(['全部', '🏆 已破案', '🔥 经典必玩', '🩸 悬疑惊悚', '🧠 脑洞逻辑', '☕ 趣味温情'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg shrink-0 font-bold transition cursor-pointer shadow-2xs ${
                      selectedCategory === cat
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800 border border-slate-200'
                    }`}
                  >
                    {cat === '🏆 已破案' ? `${cat} (${solvedCount})` : cat}
                  </button>
                ))}
              </div>

              {/* 搜索框 */}
              <div className="relative mb-3 shrink-0">
                <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="搜索题目、编号或关键词..."
                  className="w-full rounded-xl bg-[#fbfaf7] border border-slate-300 pl-9 pr-4 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20"
                />
              </div>

              {/* 列表流 */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {loadingCatalog ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-slate-400 text-xs">
                    <Loader2 size={16} className="animate-spin text-amber-600" />
                    <span>加载题库目录中...</span>
                  </div>
                ) : filteredCatalog.length === 0 ? (
                  <p className="text-center py-8 text-xs text-slate-400">
                    没有找到匹配的海龟汤
                  </p>
                ) : (
                  filteredCatalog.map((p) => {
                    const isSelected = p.id === currentPuzzle?.id;
                    const isSolved = stats.solvedIds.includes(p.id);
                    const isSurrendered = stats.surrenderedIds.includes(p.id);

                    return (
                      <div
                        key={p.id}
                        onClick={() => loadSpecificPuzzle(p.id, p.index)}
                        className={`p-3 rounded-xl border transition cursor-pointer ${
                          isSelected
                            ? 'bg-amber-50 border-amber-400 text-amber-950 shadow-2xs ring-1 ring-amber-300'
                            : isSolved
                            ? 'bg-emerald-50/70 border-emerald-300 hover:bg-emerald-100/50 text-slate-800'
                            : 'bg-[#fbfaf7] border-slate-200 hover:bg-white hover:border-slate-300 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-bold text-xs text-amber-950 font-serif">
                              #{p.index} 《{p.title}》
                            </span>
                            <span className="rounded bg-slate-100 border border-slate-200/80 px-1.5 py-0.5 text-[9px] text-slate-600">
                              {p.category}
                            </span>
                          </div>

                          {isSelected ? (
                            <span className="rounded bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 text-[10px] font-black shrink-0">
                              ⚡ 进行中
                            </span>
                          ) : isSolved ? (
                            <span className="rounded bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 text-[10px] font-black shrink-0">
                              🏆 已破案
                            </span>
                          ) : isSurrendered ? (
                            <span className="rounded bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold shrink-0">
                              📖 已揭秘
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-600 shrink-0 font-mono">
                              {'⭐'.repeat(p.difficulty || 1)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">
                          {p.storySnippet}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>

            </div>
          </div>
        )}

        {/* 📜 绝密探案结案卷宗 (Case File Dossier Modal - 方向四) */}
        {isDossierOpen && isGameEnded && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            <div className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-3xl border-2 border-amber-300 bg-gradient-to-b from-[#fffef9] via-[#fbfaf7] to-[#f8f4eb] p-5 sm:p-7 text-slate-900 shadow-2xl overflow-y-auto">
              
              {/* 复古火漆橡胶印章印章盖戳效果 */}
              <div className="absolute right-6 top-6 sm:right-10 sm:top-8 pointer-events-none select-none z-10 rotate-[-12deg] opacity-90 animate-in zoom-in-50 duration-300">
                <div className={`px-4 py-1.5 border-4 rounded-xl text-center font-black tracking-widest text-sm sm:text-base shadow-md uppercase ${
                  gameResult === 'solved'
                    ? 'border-rose-600 text-rose-600 bg-rose-50/90 ring-2 ring-rose-300'
                    : 'border-slate-500 text-slate-600 bg-slate-100/90 ring-2 ring-slate-300'
                }`}>
                  {gameResult === 'solved' ? '★ CASE CLOSED · 已结案 ★' : '● CLASSIFIED · 悬案存档 ●'}
                </div>
              </div>

              {/* 卷宗顶部 Header */}
              <div className="flex items-center justify-between pb-3 border-b border-amber-900/15 shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="text-amber-700" size={18} />
                  <span className="text-xs font-black tracking-widest text-amber-900 font-mono">
                    DOSSIER NO. #{puzzleIndex} · 绝密侦探卷宗
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDossierOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                  title="关闭并查看推演历史记录"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 核心战绩评级卡片 */}
              <div className="my-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/80 to-orange-50/50 p-4 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    {/* 评级徽章 */}
                    <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-black shadow-md font-serif ${
                      dossierScore.rank === 'SSS'
                        ? 'bg-gradient-to-br from-amber-400 via-yellow-300 to-amber-500 text-slate-950 ring-4 ring-amber-300'
                        : dossierScore.rank === 'SS'
                        ? 'bg-gradient-to-br from-rose-500 to-amber-500 text-white ring-4 ring-rose-300'
                        : dossierScore.rank === 'S'
                        ? 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white ring-4 ring-purple-300'
                        : dossierScore.rank === 'A'
                        ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white ring-4 ring-emerald-300'
                        : 'bg-slate-200 text-slate-700 ring-2 ring-slate-300'
                    }`}>
                      {dossierScore.rank}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-lg font-black text-amber-950 font-serif">
                          《{currentPuzzle?.title}》
                        </h4>
                        <span className="rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                          {dossierScore.rankBadge}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-amber-800 font-serif">
                        {dossierScore.rankTitle}
                      </p>
                    </div>
                  </div>

                  {/* 统计数据条 */}
                  <div className="flex items-center gap-4 text-xs sm:text-right border-t sm:border-t-0 sm:border-l border-amber-900/15 pt-2 sm:pt-0 sm:pl-4">
                    <div>
                      <div className="text-slate-500 text-[10px]">敲钟提问</div>
                      <div className="text-sm font-black text-slate-900 font-mono">{userQuestionsCount} 轮</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">锦囊消耗</div>
                      <div className="text-sm font-black text-amber-700 font-mono">{unlockedHintsCount} / 3 重</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">结案状态</div>
                      <div className={`text-sm font-black ${gameResult === 'solved' ? 'text-emerald-700' : 'text-slate-600'}`}>
                        {gameResult === 'solved' ? '完全破案' : '卷宗揭秘'}
                      </div>
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-xs italic text-amber-950/80 border-t border-amber-900/15 pt-2.5 font-serif">
                  DM 守秘人评定：“{dossierScore.comment}”
                </p>
              </div>

              {/* 羊皮纸：汤面与汤底真相揭示 */}
              <div className="space-y-3 rounded-2xl border border-amber-200/90 bg-white p-4 text-slate-700 text-xs leading-relaxed font-serif shadow-2xs">
                <div>
                  <span className="font-bold text-amber-950">【汤面谜面】：</span>
                  <span className="text-slate-700">{currentPuzzle?.story}</span>
                </div>
                <div className="border-t border-amber-900/10 pt-2.5">
                  <span className="font-bold text-emerald-800">【揭秘汤底 · 完整真相】：</span>
                  <span className="text-slate-900 leading-relaxed font-sans">{revealedAnswer || currentPuzzle?.answer}</span>
                </div>
              </div>

              {/* 左右搭子署名与亲笔寄语 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">
                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs">
                  <div className="relative h-9 w-9 shrink-0 rounded-full overflow-hidden border border-amber-200 bg-slate-100">
                    {renderAgentAvatar(hostLeft, false)}
                  </div>
                  <div>
                    <div className="text-[11px] font-black text-amber-950">{hostLeft.name}</div>
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-snug font-serif">
                      “{companionLeftClosingComment}”
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/90 bg-white p-3 shadow-2xs">
                  <div className="relative h-9 w-9 shrink-0 rounded-full overflow-hidden border border-amber-200 bg-slate-100">
                    {renderAgentAvatar(hostRight, false)}
                  </div>
                  <div>
                    <div className="text-[11px] font-black text-amber-950">{hostRight.name}</div>
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-snug font-serif">
                      “{companionRightClosingComment}”
                    </p>
                  </div>
                </div>
              </div>

              {/* 底部快捷操作条 */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-amber-900/15 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsDossierOpen(false)}
                  className="px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition cursor-pointer"
                >
                  👀 重温推演过程
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyReport}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition cursor-pointer"
                  >
                    {copiedReport ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    <span>{copiedReport ? '已复制战报' : '复制战报'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShareToSpace}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-black shadow-2xs transition cursor-pointer"
                  >
                    <Share2 size={14} />
                    <span>同步至空间群聊</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsDossierOpen(false);
                      loadRandomPuzzle(currentPuzzle?.id);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold border border-amber-300 shadow-2xs transition cursor-pointer"
                  >
                    <Dice5 size={14} />
                    <span>抽下一汤</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}
