'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Eye, LayoutGrid, Loader2, MessageCircle, Pause, Play, RotateCcw, SendHorizonal, Settings, Sliders, Smile, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import CompanionStage, { type FramingMode, type StageHandle, type StageSnapshot } from './CompanionStage';
import { companionCharacters, type CompanionCharacter } from '@/lib/companion/catalog';
import { getRandomTapLine, getRapidTapLine, getRandomStartupLine, getRandomDragLine, type VoiceLine } from '@/lib/companion/voice';
import '@/app/companion/companion.css';

import { getCompanionBehavior, type QuickPromptItem } from '@/lib/companion/behaviors';
import { getCompanionReplyReaction, type CompanionReply } from '@/lib/companion/reply';
import { primeChatAudio } from '@/lib/companion/chat-audio';
import { tts } from '@/lib/client/api';
import { cleanMarkdownForTTS } from '@/lib/tts/markdown-cleaner';

interface CompanionDisplayMessage {
  id: string;
  sender: 'user' | 'companion';
  text: string;
  isSticker?: boolean;
}

function getInitialMotion(charId: string): string {
  return getCompanionBehavior(charId).initialMotion;
}

function getRandomIdleMotion(charId: string, currentMotionId: string): string {
  const pool = getCompanionBehavior(charId).idlePool;
  const candidates = pool.filter(id => id !== currentMotionId);
  return candidates[Math.floor(Math.random() * candidates.length)] || pool[0];
}

function releaseAudio(audio: HTMLAudioElement) {
  audio.onplay = null;
  audio.onplaying = null;
  audio.onended = null;
  audio.onpause = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

export interface CompanionPreviewProps {
  characterId?: string;
  embedded?: boolean;
  onBackToChat?: () => void;
  externalMessages?: Array<{ id: string; role: 'user' | 'assistant' | 'system' | string; content: string }>;
  onSendMessage?: (content: string) => Promise<void>;
  isStreaming?: boolean;
  streamingContent?: string;
  draftValue?: string;
  onDraftChange?: (value: string) => void;
  reply?: CompanionReply | null;
  voice?: string;
}

export default function CompanionPreview({
  characterId: initialCharId,
  onBackToChat,
  externalMessages,
  onSendMessage,
  isStreaming = false,
  streamingContent = '',
  draftValue = '',
  onDraftChange,
  reply,
  voice,
}: CompanionPreviewProps = {}) {
  const character = companionCharacters.find(candidate => candidate.id === initialCharId) ?? companionCharacters[0];
  return (
    <CompanionSession
      key={character.id}
      character={character}
      onBackToChat={onBackToChat}
      externalMessages={externalMessages}
      onSendMessage={onSendMessage}
      isStreaming={isStreaming}
      streamingContent={streamingContent}
      draftValue={draftValue}
      onDraftChange={onDraftChange}
      reply={reply}
      voice={voice}
    />
  );
}

interface CompanionSessionProps {
  character: CompanionCharacter;
  onBackToChat?: () => void;
  externalMessages?: Array<{ id: string; role: 'user' | 'assistant' | 'system' | string; content: string }>;
  onSendMessage?: (content: string) => Promise<void>;
  isStreaming?: boolean;
  streamingContent?: string;
  draftValue?: string;
  onDraftChange?: (value: string) => void;
  reply?: CompanionReply | null;
  voice?: string;
}

function CompanionSession({
  character,
  onBackToChat,
  externalMessages,
  onSendMessage,
  isStreaming = false,
  streamingContent = '',
  draftValue: messageText = '',
  onDraftChange,
  reply,
  voice,
}: CompanionSessionProps) {
  const router = useRouter();
  const stage = useRef<StageHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [motionId, setMotionId] = useState(() => getInitialMotion(character.id));
  const [expressionId, setExpressionId] = useState('');
  const [showStickers, setShowStickers] = useState(false);

  const activeMessages = useMemo(() => {
    const base: CompanionDisplayMessage[] = (externalMessages || [])
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.id !== 'greeting'))
      .slice(-10)
      .map((m) => ({
        id: m.id,
        sender: m.role === 'user' ? 'user' : 'companion',
        text: m.content,
      }));
    if (isStreaming && streamingContent) {
      base.push({
        id: 'streaming-assistant',
        sender: 'companion',
        text: streamingContent,
      });
    }
    return base;
  }, [externalMessages, isStreaming, streamingContent]);

  const effectiveIsReplying = isStreaming;
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [autoIdle, setAutoIdle] = useState(true);
  const [autoBlink, setAutoBlink] = useState(true);
  const [lookAt, setLookAt] = useState(true);
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const [framingMode, setFramingMode] = useState<FramingMode>('auto');
  const [focusOffsetY, setFocusOffsetY] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isDebugOverride, setIsDebugOverride] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === '1' || params.get('dev') === '1') {
        setIsDebugOverride(true);
      }
    }
  }, []);
  const isDev = process.env.NODE_ENV === 'development' || isDebugOverride;

  const behavior = useMemo(() => getCompanionBehavior(character.id), [character.id]);

  const sceneBg = behavior.defaultSceneBg ?? 'cherry_room';
  const [ready, setReady] = useState(false);
  const [motionLoading, setMotionLoading] = useState(true);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const [snapshot, setSnapshot] = useState<StageSnapshot>({ time: 0, duration: 0, fps: 0, meshes: 0 });
  const activeMotion = character.motions.find(motion => motion.id === motionId);
  const motionGroups = [...new Set(character.motions.map(motion => motion.group))];
  const usable = ready && !error;
  const chatStreamRef = useRef<HTMLDivElement>(null);
  const desktopChatStreamRef = useRef<HTMLDivElement>(null);
  const [desktopTab, setDesktopTab] = useState<'chat' | 'motion'>('chat');
  const [tapBubble, setTapBubble] = useState<{ text: string; id: number; combo?: number } | null>(null);
  const [tapParticles, setTapParticles] = useState<{ id: number; x: number; y: number; symbol: string; trail?: boolean }[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [chatVoiceNotice, setChatVoiceNotice] = useState<{ messageId: string; status: 'preparing' | 'blocked' | 'failed' } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const val = localStorage.getItem('almaren_companion_voice_enabled');
    return val !== null ? val === 'true' : true;
  });
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const val = localStorage.getItem('almaren_companion_sfx_enabled');
    return val !== null ? val === 'true' : true;
  });



  // 移动端视口动态适配（精准兼容 iOS Safari 顶底栏、Chrome、微信 Webview 与软键盘弹起）
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateViewport = () => {
      const vv = window.visualViewport;
      // visualViewport 动态反映扣除 iOS Safari 底栏/顶栏以及软键盘后的真实可视高度
      const height = vv ? vv.height : window.innerHeight;
      const isInputActive = Boolean(
        document.activeElement &&
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')
      );
      const keyboardOpen = Boolean(isInputActive && vv && (window.innerHeight - vv.height > 60));

      setIsKeyboardOpen(keyboardOpen);
      document.documentElement.style.setProperty('--companion-vh', `${height}px`);

      if (keyboardOpen) {
        setTimeout(() => {
          chatStreamRef.current?.scrollTo({ top: chatStreamRef.current.scrollHeight, behavior: 'smooth' });
        }, 80);
        if (window.scrollY !== 0) {
          window.scrollTo(0, 0);
          document.body.scrollTop = 0;
        }
      }
    };

    updateViewport();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', updateViewport);
      vv.addEventListener('scroll', updateViewport);
    }
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);

    const handleFocusIn = () => {
      setTimeout(updateViewport, 100);
      setTimeout(updateViewport, 300);
    };

    const handleFocusOut = () => {
      setTimeout(updateViewport, 100);
    };

    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', updateViewport);
        vv.removeEventListener('scroll', updateViewport);
      }
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  const toggleVoice = (enabled: boolean) => {
    setVoiceEnabled(enabled);
    voiceEnabledRef.current = enabled;
    if (!enabled) {
      stopPlayback();
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem('almaren_companion_voice_enabled', String(enabled));
    }
  };

  const toggleSfx = (enabled: boolean) => {
    setSfxEnabled(enabled);
    if (typeof window !== 'undefined') {
      localStorage.setItem('almaren_companion_sfx_enabled', String(enabled));
    }
    if (!enabled && currentAudioRef.current && currentAudioRef.current !== chatAudioRef.current) {
      releaseAudio(currentAudioRef.current);
      currentAudioRef.current = null;
      isPlayingVoiceRef.current = false;
      if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
      setTapBubble(null);
      setIsSpeaking(false);
      stage.current?.stopSpeaking();
    }
  };

  const tapBubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapTimeRef = useRef<number>(0);
  const lastTapLineTextRef = useRef<string | undefined>(undefined);
  const isPlayingVoiceRef = useRef<boolean>(false);
  const comboCountRef = useRef<number>(0);
  const exhaustedUntilRef = useRef<number>(0);
  const expressionResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatPlaybackRef = useRef(0);
  const chatObjectUrlRef = useRef<string | null>(null);
  const isComposingRef = useRef(false);
  const lastReplyIdRef = useRef(reply?.id);
  const voiceEnabledRef = useRef(voiceEnabled);
  const preparedTapVoicesRef = useRef(new Map<'tap' | 'rapid', { line: VoiceLine; audio: HTMLAudioElement }>());
  const dragStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const lastDragParticleRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isDraggingGazeRef = useRef(false);
  const lastDragEndRef = useRef(0);
  const dragStartTimeRef = useRef(0);
  const dragDistanceRef = useRef(0);
  const lastDragVoiceTimeRef = useRef(0);
  const pendingStartupLineRef = useRef<{ line: VoiceLine; options?: any } | null>(null);
  const lastStartupCharIdRef = useRef<string | null>(null);
  const isTransitioningMotionRef = useRef(false);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const sessionActiveRef = useRef(true);
  const sessionTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const tapExpression = character.expressions.find(expression => expression.id === behavior.tapExpressionId)?.id ?? '';

  const setSessionTimeout = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      sessionTimersRef.current.delete(timer);
      if (sessionActiveRef.current) callback();
    }, delay);
    sessionTimersRef.current.add(timer);
    return timer;
  };

  const clearSessionTimeout = (timer: ReturnType<typeof setTimeout>) => {
    clearTimeout(timer);
    sessionTimersRef.current.delete(timer);
  };

  const stopPlayback = () => {
    chatPlaybackRef.current++;
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    const audio = currentAudioRef.current;
    currentAudioRef.current = null;
    if (audio) releaseAudio(audio);
    if (chatObjectUrlRef.current) URL.revokeObjectURL(chatObjectUrlRef.current);
    chatObjectUrlRef.current = null;
    isPlayingVoiceRef.current = false;
    pendingStartupLineRef.current = null;
    if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
    setTapBubble(null);
    setChatVoiceNotice(null);
    setIsSpeaking(false);
    stage.current?.stopSpeaking();
  };

  const primeReplyAudio = () => {
    stopPlayback();
    if (!voiceEnabledRef.current) return;
    const audio = chatAudioRef.current || new Audio();
    chatAudioRef.current = audio;
    primeChatAudio(audio);
  };

  const playPreparedReply = async (messageId: string) => {
    const audio = chatAudioRef.current;
    if (!audio || !chatObjectUrlRef.current || !voiceEnabledRef.current) return;
    const playback = chatPlaybackRef.current;
    isPlayingVoiceRef.current = true;
    setChatVoiceNotice({ messageId, status: 'preparing' });
    try {
      await audio.play();
    } catch {
      if (!sessionActiveRef.current || playback !== chatPlaybackRef.current) return;
      isPlayingVoiceRef.current = false;
      setIsSpeaking(false);
      stage.current?.stopSpeaking();
      setChatVoiceNotice({ messageId, status: 'blocked' });
    }
  };

  const playChatReply = async (message: CompanionReply) => {
    const text = cleanMarkdownForTTS(message.content);
    if (!voiceEnabledRef.current || !text) return;
    stopPlayback();
    const playback = chatPlaybackRef.current;
    const controller = new AbortController();
    chatAbortControllerRef.current = controller;
    isPlayingVoiceRef.current = true;
    setChatVoiceNotice({ messageId: message.id, status: 'preparing' });
    const isCurrent = () => sessionActiveRef.current && playback === chatPlaybackRef.current && voiceEnabledRef.current;
    const failed = () => {
      if (!isCurrent()) return;
      stopPlayback();
      setChatVoiceNotice({ messageId: message.id, status: 'failed' });
    };
    try {
      const blob = await tts.synthesizeBlob(text, { voice }, controller.signal);
      if (!isCurrent()) return;
      const audio = chatAudioRef.current || new Audio();
      chatAudioRef.current = audio;
      currentAudioRef.current = audio;
      const url = URL.createObjectURL(blob);
      chatObjectUrlRef.current = url;
      audio.src = url;
      audio.onplaying = () => {
        if (!isCurrent()) return;
        isPlayingVoiceRef.current = true;
        setChatVoiceNotice(null);
        setIsSpeaking(true);
        stage.current?.speak(Number.isFinite(audio.duration) ? audio.duration * 1000 : Math.max(2000, text.length * 180));
      };
      audio.onended = () => { if (isCurrent()) stopPlayback(); };
      audio.onpause = () => {
        if (!isCurrent()) return;
        setIsSpeaking(false);
        stage.current?.stopSpeaking();
      };
      audio.onerror = failed;
      await playPreparedReply(message.id);
    } catch {
      failed();
    } finally {
      if (chatAbortControllerRef.current === controller) chatAbortControllerRef.current = null;
    }
  };

  useEffect(() => {
    if (isStreaming && (currentAudioRef.current || chatAbortControllerRef.current)) stopPlayback();
  }, [isStreaming]);

  useEffect(() => {
    if (!ready || !reply || reply.id === lastReplyIdRef.current) return;
    lastReplyIdRef.current = reply.id;
    const reaction = getCompanionReplyReaction(character, reply.emotion);
    if (reaction.motionId) {
      if (motionId === reaction.motionId) stage.current?.restart();
      setMotionId(reaction.motionId);
      setPlaying(true);
    }
    setExpressionId(reaction.expressionId);
    if (expressionResetTimerRef.current) clearSessionTimeout(expressionResetTimerRef.current);
    expressionResetTimerRef.current = setSessionTimeout(() => setExpressionId(''), 4000);
    void playChatReply(reply);
  }, [reply, ready]);

  const selectTapLine = (kind: 'tap' | 'rapid') => kind === 'tap'
    ? getRandomTapLine(character.id, lastTapLineTextRef.current)
    : getRapidTapLine(character.id, lastTapLineTextRef.current);

  const prepareTapVoice = (kind: 'tap' | 'rapid') => {
    if (!voiceEnabled || !sfxEnabled || preparedTapVoicesRef.current.has(kind)) return;
    const line = selectTapLine(kind);
    if (!line.audioUrl) return;
    const audio = new Audio(line.audioUrl);
    audio.preload = 'auto';
    preparedTapVoicesRef.current.set(kind, { line, audio });
    audio.load();
  };

  useEffect(() => {
    if (ready) {
      prepareTapVoice('tap');
      prepareTapVoice('rapid');
    }
    return () => {
      preparedTapVoicesRef.current.forEach(({ audio }) => releaseAudio(audio));
      preparedTapVoicesRef.current.clear();
    };
  }, [ready, character.id, voiceEnabled, sfxEnabled]);

  useEffect(() => {
    sessionActiveRef.current = true;
    const timers = sessionTimersRef.current;
    return () => {
      sessionActiveRef.current = false;
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
      if (chatAbortControllerRef.current) {
        chatAbortControllerRef.current.abort();
      }
      const audio = currentAudioRef.current;
      currentAudioRef.current = null;
      if (audio) releaseAudio(audio);
      if (chatAudioRef.current && chatAudioRef.current !== audio) releaseAudio(chatAudioRef.current);
      chatAudioRef.current = null;
      if (chatObjectUrlRef.current) URL.revokeObjectURL(chatObjectUrlRef.current);
      chatObjectUrlRef.current = null;
      chatPlaybackRef.current++;
      isPlayingVoiceRef.current = false;
    };
  }, []);

  const handleSnapshot = (snap: StageSnapshot) => {
    // 仅在调试抽屉展开时更新 snapshot 状态，避免在伴侣沉浸交互与拖拽时引起不必要的全局重渲染
    if (!panelCollapsed) {
      setSnapshot(snap);
    }
  };

  const handleScenePointerDown = (e: React.PointerEvent) => {
    if (!usable || dragStartRef.current || e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as HTMLCanvasElement;
    if (!target.matches('canvas.companion-canvas')) return;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // 容错处理
    }
    dragStartRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    lastDragParticleRef.current = null;
    dragStartTimeRef.current = Date.now();
    dragDistanceRef.current = 0;
    isDraggingGazeRef.current = false;
  };

  const handleScenePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current || dragStartRef.current.pointerId !== e.pointerId) return;
    const dist = Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y);
    dragDistanceRef.current = Math.max(dragDistanceRef.current, dist);
    if (dist < 6 && !isDraggingGazeRef.current) return;
    isDraggingGazeRef.current = true;

    const now = Date.now();
    const last = lastDragParticleRef.current;
    if (last && (now - last.time < 60 || Math.hypot(e.clientX - last.x, e.clientY - last.y) < 10)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    lastDragParticleRef.current = { x: e.clientX, y: e.clientY, time: now };
    const id = now + Math.random();
    const symbol = Math.random() < 0.3 ? '♡' : '✦';
    setTapParticles(prev => [...prev.slice(-11), { id, x, y, symbol, trail: true }]);
    setSessionTimeout(() => setTapParticles(prev => prev.filter(p => p.id !== id)), 700);
  };

  const handleScenePointerUp = (e?: React.PointerEvent) => {
    if (!dragStartRef.current || (e && dragStartRef.current.pointerId !== e.pointerId)) return;
    const now = Date.now();
    const wasDragging = isDraggingGazeRef.current;
    const dragDuration = now - dragStartTimeRef.current;
    const dragDist = dragDistanceRef.current;
    dragStartRef.current = null;
    lastDragParticleRef.current = null;
    isDraggingGazeRef.current = false;

    if (e && e.currentTarget) {
      try {
        const canvas = e.currentTarget.querySelector('canvas.companion-canvas');
        if (canvas?.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch {
        // 容错处理
      }
    }
    if (wasDragging) {
      lastDragEndRef.current = now;

      // 拖拽趣味互动判定：按住拖动时长 >= 350ms 且总位移 >= 30px
      if (e?.type === 'pointerup' && dragDuration >= 350 && dragDist >= 30) {
        // 拖拽语音保护防连刷：至少间隔 3.5 秒且当前未在播放语音
        if (now - lastDragVoiceTimeRef.current > 3500 && !isPlayingVoiceRef.current) {
          lastDragVoiceTimeRef.current = now;
          playDragVoice();
        }
      }
    }
  };

  useEffect(() => {
    const cancelDrag = () => {
      dragStartRef.current = null;
      lastDragParticleRef.current = null;
      isDraggingGazeRef.current = false;
      lastDragEndRef.current = Date.now();
    };
    window.addEventListener('blur', cancelDrag);
    return () => window.removeEventListener('blur', cancelDrag);
  }, []);

  // 待机动作自然轮巡：当一个待机动作结束时，平滑过渡到下一个自然待机动作
  const handleMotionEnded = () => {
    if (autoIdle) {
      if (isTransitioningMotionRef.current) return;
      isTransitioningMotionRef.current = true;
      const nextId = getRandomIdleMotion(character.id, motionId);
      setMotionId(nextId);
      setPlaying(true);
      setSessionTimeout(() => {
        isTransitioningMotionRef.current = false;
      }, 1000);
    } else {
      if (!loop) setPlaying(false);
    }
  };

  // 核心语音播放通道（驱动口型、字幕气泡与动作表情联动）
  const playVoice = (
    line: VoiceLine,
    options?: {
      targetMotionId?: string;
      targetExpression?: string;
      combo?: number;
      isTap?: boolean;
      isStartup?: boolean;
    }
  ) => {
    if (chatAbortControllerRef.current || currentAudioRef.current === chatAudioRef.current && currentAudioRef.current) stopPlayback();
    const now = Date.now();
    const fallbackDuration = (line.seconds ?? Math.max(1.8, line.text.length * 0.16)) * 1000;

    // 动作与表情联动
    if (options?.targetMotionId) {
      setMotionId(options.targetMotionId);
      setPlaying(true);
    }
    if (typeof options?.targetExpression === 'string') {
      const expression = character.expressions.some(item => item.id === options.targetExpression) ? options.targetExpression : '';
      setExpressionId(expression);
      if (expressionResetTimerRef.current) clearSessionTimeout(expressionResetTimerRef.current);
      // 3.2 秒后表情平滑回归自然
      if (expression) {
        expressionResetTimerRef.current = setSessionTimeout(() => {
          setExpressionId('');
        }, 3200);
      }
    }

    // 弹出舞台台词字幕并联动发音（保持独立互动，不污染正常聊天流）
    if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
    setTapBubble(null);
    const showBubble = () => setTapBubble({ text: line.text, id: now, combo: options?.combo });

    const finishVoice = (bubbleDelay = 0) => {
      isPlayingVoiceRef.current = false;
      setIsSpeaking(false);
      stage.current?.stopSpeaking();
      if (options?.isTap) {
        const combo = comboCountRef.current;
        comboCountRef.current = 0;
        if (Date.now() - lastTapTimeRef.current < 1200 && combo >= 3) {
          playTapVoice(combo);
          return;
        }
      }
      if (bubbleDelay) {
        tapBubbleTimerRef.current = setSessionTimeout(() => setTapBubble(null), bubbleDelay);
      } else {
        setTapBubble(null);
      }
    };
    const playFallback = () => {
      isPlayingVoiceRef.current = true;
      showBubble();
      setIsSpeaking(true);
      stage.current?.speak(fallbackDuration);
      if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
      tapBubbleTimerRef.current = setSessionTimeout(() => finishVoice(), fallbackDuration);
    };

    if (!voiceEnabled || !sfxEnabled || !line.audioUrl) {
      playFallback();
      return;
    }

    if (line.audioUrl) {
      try {
        if (currentAudioRef.current) {
          chatPlaybackRef.current++;
          releaseAudio(currentAudioRef.current);
        }
        const prepared = [...preparedTapVoicesRef.current.entries()].find(([, entry]) => entry.line === line);
        const audio = prepared ? prepared[1].audio : new Audio(line.audioUrl);
        if (prepared) preparedTapVoicesRef.current.delete(prepared[0]);
        currentAudioRef.current = audio;
        isPlayingVoiceRef.current = true;
        let failed = false;
        const loadingTimer = setSessionTimeout(() => fallback(), 10000);
        const fallback = () => {
          if (failed || !sessionActiveRef.current || currentAudioRef.current !== audio) return;
          failed = true;
          clearSessionTimeout(loadingTimer);
          releaseAudio(audio);
          playFallback();
        };

        // 真实音频驱动口型与播放锁
        audio.onplaying = () => {
          if (!sessionActiveRef.current || currentAudioRef.current !== audio) return;
          clearSessionTimeout(loadingTimer);
          showBubble();
          isPlayingVoiceRef.current = true;
          setIsSpeaking(true);
        };
        audio.onended = () => {
          clearSessionTimeout(loadingTimer);
          if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
          finishVoice(500);
        };
        audio.onpause = () => {
          clearSessionTimeout(loadingTimer);
          isPlayingVoiceRef.current = false;
          setIsSpeaking(false);
          stage.current?.stopSpeaking();
        };
        audio.onerror = fallback;
        try {
          audio.play().then(() => {
            if (options?.isStartup) {
              pendingStartupLineRef.current = null;
            }
          }).catch(() => {
            if (options?.isStartup) {
              // 浏览器因自动播放策略拦截出声，保留待用户首次触摸屏幕时立即触发
              pendingStartupLineRef.current = { line, options };
            }
            fallback();
          });
        } catch {
          fallback();
        }
      } catch {
        playFallback();
      }
    } else {
      playFallback();
    }
  };

  // 播放初次载入欢迎问候语音
  const playStartupVoice = () => {
    const line = getRandomStartupLine(character.id);
    const { targetMotionId, targetExpression } = behavior.getStartupReaction(character);
    playVoice(line, { targetMotionId, targetExpression, isStartup: true });
  };

  // 播放拖拽反应趣味语音
  const playDragVoice = () => {
    const line = getRandomDragLine(character.id);
    const { targetMotionId, targetExpression } = behavior.getDragReaction(character, line);
    playVoice(line, { targetMotionId, targetExpression });
  };

  // 角色模型准备就绪后，播放亲切的进场日常问候（支持切换伴侣时重新触发）
  useEffect(() => {
    if (!ready || isStreaming || reply || externalMessages?.some(message => message.id !== 'greeting') || lastStartupCharIdRef.current === character.id) return;
    lastStartupCharIdRef.current = character.id;

    const timer = setSessionTimeout(() => {
      playStartupVoice();
    }, 450);

    return () => clearSessionTimeout(timer);
  }, [ready, character.id, isStreaming, reply, externalMessages]);

  // 用户与模型交互时，补播被浏览器自动播放限制拦截的入场语音。
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFirstUserInteraction = (event: Event) => {
      const target = event.target as Element | null;
      if (!target?.matches?.('canvas.companion-canvas')) return;
      if (pendingStartupLineRef.current) {
        const pending = pendingStartupLineRef.current;
        pendingStartupLineRef.current = null;
        playVoice(pending.line, pending.options);
      }
    };

    window.addEventListener('pointerdown', handleFirstUserInteraction, { capture: true, passive: true });
    window.addEventListener('keydown', handleFirstUserInteraction, { capture: true, passive: true });

    return () => {
      window.removeEventListener('pointerdown', handleFirstUserInteraction, { capture: true });
      window.removeEventListener('keydown', handleFirstUserInteraction, { capture: true });
    };
  }, []);

  // 播放触碰反馈语音（支持日常问候、急促连击台词、求饶三种档位）
  const playTapVoice = (combo: number) => {
    const now = Date.now();
    const kind = combo >= 3 ? 'rapid' : 'tap';
    const prepared = preparedTapVoicesRef.current.get(kind);
    if (combo < 5 && prepared && prepared.line.text === lastTapLineTextRef.current) {
      releaseAudio(prepared.audio);
      preparedTapVoicesRef.current.delete(kind);
    }
    let line: VoiceLine;
    let targetExpression = '';
    let targetMotionId = '';

    if (combo >= 5) {
      // 🌟 Level 3: 连击 5 次以上，触发【求饶/娇嗔保护态】！
      const reaction = behavior.getSurrenderReaction(character, tapExpression);
      line = reaction.line || { id: 'surrender', text: '好啦好啦，手下留情嘛~ 🌸', seconds: 2.2 };
      targetExpression = reaction.targetExpression || tapExpression;
      targetMotionId = reaction.targetMotionId || '';

      // 触发 2.4 秒求饶保护，防连点器刷屏
      exhaustedUntilRef.current = now + 2400;
      comboCountRef.current = 0;
    } else if (combo >= 3) {
      // 🌟 Level 2: 连点 3~4 次，触发【慌乱/连击专属台词】！
      line = preparedTapVoicesRef.current.get('rapid')?.line ?? selectTapLine('rapid');
      const reaction = behavior.getRapidTapReaction(character, tapExpression);
      targetExpression = reaction.targetExpression || tapExpression;
      targetMotionId = reaction.targetMotionId || '';
    } else {
      // 🌟 Level 1: 正常单次轻戳日常问候
      line = preparedTapVoicesRef.current.get('tap')?.line ?? selectTapLine('tap');
      const reaction = behavior.getRandomTapReaction(character, tapExpression);
      targetExpression = reaction.targetExpression || '';
      targetMotionId = reaction.targetMotionId || '';
    }

    lastTapLineTextRef.current = line.text;
    playVoice(line, { targetMotionId, targetExpression, combo, isTap: true });
    if (combo < 5) prepareTapVoice(kind);
  };

  // 角色点击触碰交互：
  // 1. 每点一次即刻触发心动微粒子反馈 (❤️ / 🌸 / ✨)
  // 2. 眼睛按照模型自身动作与待机节奏自然眨眼，绝不随点击暴力快速眨眼
  // 3. 播放语音中做禁用不要覆盖，只累计点击次数
  // 4. 语音播放完了，若仍在连击，紧接着播放连击语音
  const handleCharacterTap = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (!usable || !target.matches('canvas.companion-canvas')) return;

    // 若刚才是在按住拖拽视线引导（释放后 400ms 内），不误触发角色轻点对白与粒子
    if (Date.now() - lastDragEndRef.current < 400) {
      return;
    }

    const now = Date.now();

    // 1. 生成点击位置的浮动心动粒子 (❤️ / 🌸 / ✨)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(20, Math.min(rect.width - 20, e.clientX - rect.left));
    const y = Math.max(20, Math.min(rect.height - 20, e.clientY - rect.top));
    const symbols = behavior.tapSymbols;
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const pId = now + Math.random();
    setTapParticles(prev => [...prev.slice(-6), { id: pId, x, y, symbol }]);
    setSessionTimeout(() => {
      setTapParticles(prev => prev.filter(p => p.id !== pId));
    }, 850);

    // 2. 极限连点防刷保护态（求饶冷却中：轻微眨眼互动，保护引擎不被暴力狂刷）
    if (now < exhaustedUntilRef.current) {
      return;
    }

    // 3. 计算连击数 (Combo): 1400ms 内再次点击计入连击
    const isConsecutive = now - lastTapTimeRef.current < 1400;
    const combo = isConsecutive ? comboCountRef.current + 1 : 1;
    comboCountRef.current = combo;
    lastTapTimeRef.current = now;

    // 4. 核心：播放语音中，做禁用不要覆盖，只累计连击次数！
    if (isPlayingVoiceRef.current) {
      // 若连击数达到较高档位，给视觉微反馈（例如脸红），但不打断当前播放的语音
      if (combo >= 3 && !expressionId) {
        setExpressionId(tapExpression);
        if (expressionResetTimerRef.current) clearSessionTimeout(expressionResetTimerRef.current);
        expressionResetTimerRef.current = setSessionTimeout(() => setExpressionId(''), 3000);
      }
      return;
    }

    // 5. 当前没有播放语音，触发新语音播放
    playTapVoice(combo);
  };

  // 智能平滑触底：当消息列表或正在回复状态更新时，平滑滚动至最底部
  useEffect(() => {
    const el = chatStreamRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    const deskEl = desktopChatStreamRef.current;
    if (deskEl) deskEl.scrollTo({ top: deskEl.scrollHeight, behavior: 'smooth' });
  }, [activeMessages, effectiveIsReplying, desktopTab]);

  // 初次载入时直接触底展示最新气泡
  useEffect(() => {
    const el = chatStreamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const deskEl = desktopChatStreamRef.current;
    if (deskEl) deskEl.scrollTop = deskEl.scrollHeight;
  }, []);

  const replay = () => {
    stage.current?.restart();
    setPlaying(true);
  };

  const triggerListeningMotion = (preferredMotion?: string) => {
    const listening = preferredMotion || behavior.listeningMotion;
    const matched = character.motions.find(m => m.id === listening || m.id.toLowerCase().includes(listening.toLowerCase()))
      || character.motions.find(m =>
        m.id.toLowerCase().includes('attentive') ||
        m.id.toLowerCase().includes('chat') ||
        m.id.toLowerCase().includes('idle')
      );
    if (matched) {
      setMotionId(matched.id);
      setPlaying(true);
    }
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isComposingRef.current) return;
    const text = messageText.trim();
    if (!text || isStreaming) return;
    primeReplyAudio();
    setShowStickers(false);
    triggerListeningMotion();
    onSendMessage?.(text).catch(console.error);
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && (isComposingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) {
      event.preventDefault();
    }
  };

  const handleQuickPrompt = (item: QuickPromptItem) => {
    if (isStreaming) return;
    primeReplyAudio();
    setShowStickers(false);
    triggerListeningMotion(item.motion);
    onSendMessage?.(item.userText).catch(console.error);
  };

  const retry = () => {
    setError('');
    setReady(false);
    setMotionLoading(true);
    setSnapshot({ time: 0, duration: 0, fps: 0, meshes: 0 });
    setGeneration(value => value + 1);
  };

  const handleScrollToControls = () => {
    const el = document.getElementById('companion-controls-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const retryReplyAudio = () => {
    if (!chatVoiceNotice || !reply) return;
    if (chatVoiceNotice.status === 'blocked') {
      void playPreparedReply(reply.id);
    } else {
      primeReplyAudio();
      void playChatReply(reply);
    }
  };

  const hasVoiceNotice = chatVoiceNotice && reply?.id === chatVoiceNotice.messageId;
  const voiceReplayButton = hasVoiceNotice ? (
    chatVoiceNotice.status === 'preparing' ? (
      <button type="button" className="companion-hud-chip companion-hud-chip--btn" onClick={stopPlayback}>
        <Volume2 size={14} /><span role="status">正在准备语音…</span>取消
      </button>
    ) : (
      <button type="button" className="companion-hud-chip companion-hud-chip--btn" onClick={retryReplyAudio}>
        <Volume2 size={14} />{chatVoiceNotice.status === 'blocked' ? '语音未播放，点此重试' : '语音生成失败，点此重试'}
      </button>
    )
  ) : null;

  return (
    <main
      className="companion-page companion-page--embedded"
      data-character={character.id}
    >
      <div
        className={`companion-workspace ${panelCollapsed ? 'is-collapsed' : ''}`}
        data-keyboard-open={isKeyboardOpen ? 'true' : 'false'}
      >
        <section
          className={`companion-scene ${sceneBg !== 'none' ? `has-custom-bg companion-scene--${sceneBg}` : ''}`}
          aria-label="角色预览"
          onPointerDown={handleScenePointerDown}
          onPointerMove={handleScenePointerMove}
          onPointerUp={handleScenePointerUp}
          onPointerCancel={handleScenePointerUp}
          onLostPointerCapture={handleScenePointerUp}
          onClick={handleCharacterTap}
        >
          {/* 实景场景背景图 (温暖樱花阳光书房 / 蔚蓝海景天台书房) */}
          {sceneBg === 'cherry_room' && (
            <div className="companion-scene-backdrop companion-scene-backdrop--cherry" aria-hidden="true" />
          )}
          {sceneBg === 'ocean_room' && (
            <div className="companion-scene-backdrop companion-scene-backdrop--ocean" aria-hidden="true" />
          )}

          {/* PC 桌面端专属顶部舞台工具条 (左侧伴侣身份标，右侧场景氛围与视角模式) */}
          <div className="companion-stage-desktop-hud">
            {/* <div className="companion-stage-badge">
              <span className="companion-stage-badge-avatar">{character.name[0]}</span>
              <div className="companion-stage-badge-text">
                <strong>{character.name}</strong>
                <span>{character.title || '治愈伴侣'}</span>
              </div>
            </div> */}
            <div className="companion-stage-desktop-actions">
              <div className="companion-stage-pill-group" role="group" aria-label="镜头模式">
                <button
                  type="button"
                  className={`companion-stage-pill ${framingMode === 'closeup' ? 'is-active' : ''}`}
                  onClick={() => setFramingMode('closeup')}
                >
                  特写
                </button>
                <button
                  type="button"
                  className={`companion-stage-pill ${framingMode === 'half' ? 'is-active' : ''}`}
                  onClick={() => setFramingMode('half')}
                >
                  半身
                </button>
                <button
                  type="button"
                  className={`companion-stage-pill ${framingMode === 'full' ? 'is-active' : ''}`}
                  onClick={() => setFramingMode('full')}
                >
                  全身
                </button>
              </div>
            </div>
              <div className="companion-hud-capsules">
            {voiceReplayButton}
            <button
              type="button"
              className={`companion-hud-chip companion-hud-chip--btn ${!voiceEnabled ? 'is-muted' : ''}`}
              onClick={() => toggleVoice(!voiceEnabled)}
              title={voiceEnabled ? '伴侣对话语音已开启（点击静音）' : '伴侣对话语音已静音（点击开启）'}
              aria-label={voiceEnabled ? '伴侣对话语音已开启，点击静音' : '伴侣对话语音已静音，点击开启'}
            >
              {voiceEnabled ? (
                <>
                  <Volume2 size={15} className="companion-hud-icon--active" />
                  <span className="companion-hud-text">语音开启</span>
                </>
              ) : (
                <>
                  <VolumeX size={15} className="companion-hud-icon--muted" />
                  <span className="companion-hud-text">已静音</span>
                </>
              )}
            </button>
          </div>
          </div>

          {/* 移动端屏幕悬浮 HUD 标签 (右侧控制与设置) */}

          <div className="companion-floating-hud companion-floating-hud--right">
            <button
              type="button"
              className={`companion-stage-chip companion-stage-chip--icon ${!voiceEnabled ? 'is-muted' : ''}`}
              onClick={() => toggleVoice(!voiceEnabled)}
              title={voiceEnabled ? '伴侣对话语音已开启（点击静音）' : '伴侣对话语音已静音（点击开启）'}
              aria-label={voiceEnabled ? '伴侣对话语音已开启，点击静音' : '伴侣对话语音已静音，点击开启'}
            >
              {voiceEnabled ? (
                <Volume2 size={16} className="companion-hud-icon--active" />
              ) : (
                <VolumeX size={16} className="companion-hud-icon--muted" />
              )}
            </button>
            <button
              type="button"
              className="companion-stage-chip companion-stage-chip--icon"
              onClick={() => setSettingsOpen(true)}
              title="伴侣偏好设置"
              aria-label="伴侣偏好设置"
            >
              <Settings size={16} />
            </button>
            {isDev && (
              <button
                type="button"
                className="companion-stage-chip companion-stage-chip--icon companion-stage-chip--sub"
                onClick={() => setPanelCollapsed(false)}
                title="打开伴侣动作与视角调节抽屉（开发者）"
                aria-label="打开伴侣动作与视角调节抽屉"
              >
                <LayoutGrid size={16} />
              </button>
            )}
          </div>

          <div className="companion-floor" aria-hidden="true" />
          <CompanionStage
            key={generation}
            ref={stage}
            character={character}
            motionId={motionId}
            expressionId={expressionId}
            playing={playing && !error}
            loop={autoIdle ? false : loop}
            speed={speed}
            zoom={zoom}
            focusOffsetY={focusOffsetY}
            framingMode={framingMode}
            autoBlink={autoBlink}
            lookAt={lookAt}
            speaking={isSpeaking}
            onReady={() => setReady(true)}
            onError={setError}
            onEnded={handleMotionEnded}
            onMotionLoading={setMotionLoading}
            onSnapshot={handleSnapshot}
          />
          {(!ready || error) && (
            <div className="companion-stage-overlay" role="status" aria-live="polite">
              <div className="companion-loading-card">
                {error ? <><p>{error}</p><button onClick={retry}>重新加载</button></> : <><Loader2 size={24} className="companion-spinner" /><p>{character.name} 正在准备见你…</p><span>首次加载需要一点时间</span></>}
              </div>
            </div>
          )}

          {/* 点击飘动的心动粒子 (Hearts & Petals) */}
          {tapParticles.map(p => (
            <span
              key={p.id}
              className={`companion-tap-particle${p.trail ? ' companion-drag-particle' : ''}`}
              style={{ left: `${p.x}px`, top: `${p.y}px` }}
              aria-hidden="true"
            >
              {p.symbol}
            </span>
          ))}

          {/* 角色触碰/戳一戳专属灵动台词气泡 */}
          {tapBubble && (
            <div
              key={tapBubble.id}
              className={`companion-tap-bubble ${tapBubble.combo && tapBubble.combo >= 3 ? 'companion-tap-bubble--combo' : ''}`}
              role="status"
            >
              <span className="companion-tap-bubble-speaker" aria-hidden="true">
                {behavior.speakerTag}
              </span>
              <span className="companion-tap-bubble-text">{tapBubble.text}</span>
            </div>
          )}

          {/* 左下侧对话层 (Chat Layer - 默认展示最近5条消息，对齐 NariYume 界面截图) */}
          {/* 左下侧对话层 (带顶部渐变遮罩与独立平滑滚动，展开快捷互动时平滑隐去) */}
          <div
            className={`companion-chat-layer ${showStickers ? 'is-hidden' : ''}`}
            role="log"
            aria-live="polite"
            aria-label="最近对话"
          >
            <div className="companion-chat-stream" ref={chatStreamRef}>
              {activeMessages.map(msg => (
                <div
                  key={msg.id}
                  className={`companion-bubble-row companion-bubble-row--${msg.sender}`}
                >
                  <div
                    className={`companion-bubble companion-bubble--${msg.sender} ${msg.isSticker ? 'companion-bubble--sticker' : ''}`}
                    role="status"
                  >
                    <span>{msg.text}</span>
                  </div>
                </div>
              ))}
              {effectiveIsReplying && (
                <div className="companion-bubble-row companion-bubble-row--companion">
                  <div className="companion-bubble companion-bubble--companion companion-bubble--typing">
                    <span className="companion-typing-dot" />
                    <span className="companion-typing-dot" />
                    <span className="companion-typing-dot" />
                  </div>
                </div>
              )}
            </div>
            {hasVoiceNotice && (
              <div className="companion-mobile-voice-notice" data-state={chatVoiceNotice.status}>
                <span className="companion-mobile-voice-status" role="status">
                  {chatVoiceNotice.status === 'preparing'
                    ? <Loader2 size={14} className="companion-spinner" aria-hidden="true" />
                    : <Volume2 size={14} aria-hidden="true" />}
                  {chatVoiceNotice.status === 'preparing' ? '准备语音…' : chatVoiceNotice.status === 'blocked' ? '待播放' : '生成失败'}
                </span>
                <button
                  type="button"
                  onClick={chatVoiceNotice.status === 'preparing' ? stopPlayback : retryReplyAudio}
                >
                  {chatVoiceNotice.status === 'preparing' ? '取消' : chatVoiceNotice.status === 'blocked' ? '播放' : '重试'}
                </button>
              </div>
            )}
          </div>

          {/* Quick Reactions 快捷表情/提示浮块 (点击底栏笑脸按钮展开) */}
          {showStickers && (
            <>
              <div
                className="companion-quick-backdrop"
                onClick={() => setShowStickers(false)}
                aria-hidden="true"
              />
              <div className="companion-quick-reactions" role="region" aria-label="快捷互动">
                <div className="companion-quick-scroll">
                  {behavior.quickPrompts.map(item => (
                  <button
                    key={item.label}
                    type="button"
                    className="companion-quick-chip"
                    onClick={() => handleQuickPrompt(item)}
                    disabled={!usable || isStreaming}
                  >
                    <span className="companion-quick-emoji">{item.emoji}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
                </div>
              </div>
            </>
          )}

          {/* 灵动胶囊底栏 (Candy Dockbar: 表情互动 + 消息输入 + 发送) */}
          <div className="companion-dockbar" role="toolbar" aria-label="伴侣快捷交互栏">
            <div className="companion-dock" data-character={character.id}>
              {/* 1. 表情/快捷互动切换按钮 */}
              <button
                type="button"
                className={`companion-dock-btn companion-dock-btn--candy ${showStickers ? 'is-active' : ''}`}
                aria-label="快捷互动表情"
                title="快捷互动表情"
                onClick={() => setShowStickers(v => !v)}
              >
                <Smile size={18} />
              </button>

              {/* 2. 消息输入框 */}
              <form className="companion-composer" onSubmit={handleSendMessage}>
                <input
                  ref={inputRef}
                  type="text"
                  className="companion-composer-input"
                  placeholder={effectiveIsReplying ? `${character.name} 正在认真回复中…` : `和${character.name}聊聊...`}
                  value={messageText}
                  onChange={e => onDraftChange?.(e.target.value)}
                  onCompositionStart={() => { isComposingRef.current = true; }}
                  onCompositionEnd={() => { isComposingRef.current = false; }}
                  onKeyDown={handleComposerKeyDown}
                  disabled={!usable || effectiveIsReplying}
                />
              </form>

              {/* 3. 发送按钮 */}
              <button
                type="button"
                className={`companion-dock-btn companion-dock-btn--send ${messageText.trim() && !effectiveIsReplying ? 'is-ready' : 'is-disabled'}`}
                disabled={!messageText.trim() || !usable || effectiveIsReplying}
                aria-label="发送消息"
                onClick={handleSendMessage}
              >
                <SendHorizonal size={18} />
              </button>
            </div>
          </div>
        </section>

        {/* ==================== PC 桌面端专属独立沉浸交互舱 (35% 独立右栏) ==================== */}
        <aside className="companion-desktop-console" aria-label="伴侣独立交互舱">
          {/* 1. 顶部角色名片与切换栏 */}
          <div className="companion-console-header">
            <div className="companion-console-profile">
              <div className="companion-console-avatar-wrap">
                <span className="companion-console-avatar">{character.name[0]}</span>
                <span className="companion-console-dot" />
              </div>
              <div className="companion-console-meta">
                <h3>{character.name}</h3>
                <p>在线 · 随时陪伴倾听</p>
              </div>
            </div>
            <div className="companion-console-header-actions">
              <button
              type="button"
              className="companion-hud-chip companion-hud-chip--btn"
              onClick={() => setSettingsOpen(true)}
              title="伴侣偏好设置"
              aria-label="伴侣偏好设置"
            >
              <Settings size={15} />
              <span className="companion-hud-text">设置</span>
            </button>
            </div>
          </div>

          {/* 2. 交互 Tab 选项卡 (仅在开发模式显示，生产打包模式默认专属对话陪伴舱) */}
          {isDev && (
            <div className="companion-console-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={desktopTab === 'chat'}
                className={`companion-console-tab ${desktopTab === 'chat' ? 'is-active' : ''}`}
                onClick={() => setDesktopTab('chat')}
              >
                <MessageCircle size={15} />
                <span>交流对话</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={desktopTab === 'motion'}
                className={`companion-console-tab ${desktopTab === 'motion' ? 'is-active' : ''}`}
                onClick={() => setDesktopTab('motion')}
              >
                <Sparkles size={15} />
                <span>动作与表情</span>
                <span className="companion-console-tab-badge">{character.motions.length}</span>
              </button>
            </div>
          )}

          {/* 3. Tab 内容区 (打包模式下纯净沉浸式对话陪伴) */}
          {(!isDev || desktopTab === 'chat') ? (
            <div className="companion-desktop-chat-pane">
              {/* 消息滚动流 */}
              <div className="companion-desktop-chat-stream" ref={desktopChatStreamRef}>
                {activeMessages.map(msg => (
                  <div key={msg.id} className={`companion-bubble-row companion-bubble-row--${msg.sender}`}>
                    <div className={`companion-bubble companion-bubble--${msg.sender} ${msg.isSticker ? 'companion-bubble--sticker' : ''}`}>
                      <span>{msg.text}</span>
                    </div>
                  </div>
                ))}
                {effectiveIsReplying && (
                  <div className="companion-bubble-row companion-bubble-row--companion">
                    <div className="companion-bubble companion-bubble--companion companion-bubble--typing">
                      <span className="companion-typing-dot" />
                      <span className="companion-typing-dot" />
                      <span className="companion-typing-dot" />
                    </div>
                  </div>
                )}
              </div>

              {/* 灵感互动气泡 */}
              <div className="companion-desktop-quick-prompts">
                <div className="companion-desktop-quick-scroll">
                  {behavior.quickPrompts.map(item => (
                    <button
                      key={item.label}
                      type="button"
                      className="companion-quick-chip"
                      onClick={() => handleQuickPrompt(item)}
                      disabled={!usable || isStreaming}
                    >
                      <span className="companion-quick-emoji">{item.emoji}</span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 桌面端高质感输入栏 */}
              <div className="companion-desktop-composer-box">
                <form onSubmit={handleSendMessage} className="companion-desktop-composer-form">
                  <input
                    type="text"
                    className="companion-desktop-composer-input"
                    placeholder={effectiveIsReplying ? `${character.name} 正在认真回复中…` : `和${character.name}聊聊... (按 Enter 发送)`}
                    value={messageText}
                    onChange={e => onDraftChange?.(e.target.value)}
                    onCompositionStart={() => { isComposingRef.current = true; }}
                    onCompositionEnd={() => { isComposingRef.current = false; }}
                    onKeyDown={handleComposerKeyDown}
                    disabled={!usable || effectiveIsReplying}
                  />
                  <button
                    type="submit"
                    className={`companion-desktop-send-btn ${messageText.trim() && !effectiveIsReplying ? 'is-ready' : ''}`}
                    disabled={!messageText.trim() || !usable || effectiveIsReplying}
                    title="发送消息 (Enter)"
                    aria-label="发送消息"
                  >
                    <SendHorizonal size={16} />
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="companion-desktop-motion-pane">
              {/* 状态与进度条 */}
              <div className="companion-drawer-status-chip">
                <span className={`companion-status-dot ${usable ? 'is-ready' : ''}`} />
                <span>
                  {error
                    ? '加载遇到问题'
                    : !ready
                      ? '正在加载角色模型…'
                      : motionLoading
                        ? '正在切换动作…'
                        : playing
                          ? `${autoIdle ? '动态待机 · ' : ''}正在播放：${activeMotion?.label || motionId}`
                          : '已暂停 · 可拖动进度预览'}
                </span>
              </div>

              <section className="companion-control-section companion-player">
                <div className="companion-playback-row">
                  <button className="companion-play-button" disabled={!usable} aria-label={playing ? '暂停动作' : '播放动作'} onClick={() => {
                    if (!playing && snapshot.time >= snapshot.duration) stage.current?.restart();
                    setPlaying(value => !value);
                  }}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
                  <button className="companion-replay-button" disabled={!usable} onClick={replay}><RotateCcw size={14} />重播</button>
                  <label className="companion-speed-label">速度<select aria-label="播放速度" value={speed} onChange={event => setSpeed(Number(event.target.value))} disabled={!usable}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option></select></label>
                </div>
                <input className="companion-range" aria-label="动作进度" type="range" min="0" max={snapshot.duration || 1} step="0.01" value={snapshot.time} disabled={!usable} onChange={event => {
                  const time = Number(event.target.value);
                  stage.current?.seek(time);
                  setSnapshot(value => ({ ...value, time }));
                }} />
                <div className="companion-timeline"><span>{snapshot.time.toFixed(1)}s</span><span>{snapshot.duration.toFixed(1)}s</span></div>
                <div className="companion-options">
                  <label><input type="checkbox" checked={autoIdle} onChange={event => setAutoIdle(event.target.checked)} />动态待机轮巡</label>
                  <label><input type="checkbox" checked={loop} disabled={autoIdle} onChange={event => setLoop(event.target.checked)} />单动作循环</label>
                  <label><input type="checkbox" checked={autoBlink} onChange={event => setAutoBlink(event.target.checked)} />自然眨眼</label>
                  <label><input type="checkbox" checked={lookAt} onChange={event => setLookAt(event.target.checked)} />按住拖动视线跟随</label>
                </div>
              </section>

              {/* 全部动作列表 */}
              <section className="companion-control-section">
                <div className="companion-section-heading">
                  <h3>全部动作 · {character.motions.length} 个</h3>
                  <Link
                    href={`/companion/studio?character=${character.id}&motion=${encodeURIComponent(motionId)}`}
                    className="companion-text-button"
                    title="动作工坊：微调关键帧姿态与导出参数"
                  >
                    <Sliders size={12} />
                    <span>动作工坊</span>
                  </Link>
                </div>
                <div className="companion-motion-list" role="region" aria-label="全部动作" tabIndex={0}>
                  {motionGroups.map(group => (
                    <div className="companion-motion-group" key={group}>
                      <h4>{group}<span>{character.motions.filter(motion => motion.group === group).length}</span></h4>
                      <div className="companion-motion-grid">
                        {character.motions.filter(motion => motion.group === group).map(motion => (
                          <button
                            key={motion.id}
                            className={`companion-motion-button ${motionId === motion.id ? 'is-selected' : ''}`}
                            aria-pressed={motionId === motion.id}
                            title={motion.id}
                            disabled={!ready || !!error}
                            onClick={() => {
                              if (motionId === motion.id) replay();
                              else { setMotionId(motion.id); setPlaying(true); }
                            }}
                          >{motion.label}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 表情切换 */}
              <section className="companion-control-section">
                <div className="companion-section-heading"><h3>全部表情 · {character.expressions.length - 1} 个</h3><button className="companion-text-button" onClick={() => stage.current?.blink()} disabled={!usable}><Eye size={14} />眨眨眼</button></div>
                <div className="companion-expression-grid">
                  {character.expressions.map(expression => (
                    <button key={expression.id} className={expressionId === expression.id ? 'is-selected' : ''} aria-pressed={expressionId === expression.id} disabled={!usable} onClick={() => setExpressionId(expression.id)}>{expression.label}</button>
                  ))}
                </div>
              </section>

              {/* 镜头与视角调节 */}
              <section className="companion-control-section companion-view-controls">
                <div className="companion-section-heading">
                  <h3>构图与镜头</h3>
                  <span>参数微调</span>
                </div>
                <div className="companion-framing-switch" role="group" aria-label="构图模式">
                  <button type="button" aria-pressed={framingMode === 'auto'} onClick={() => setFramingMode('auto')}>自适应</button>
                  <button type="button" aria-pressed={framingMode === 'closeup'} onClick={() => setFramingMode('closeup')}>大特写</button>
                  <button type="button" aria-pressed={framingMode === 'half'} onClick={() => setFramingMode('half')}>半身</button>
                  <button type="button" aria-pressed={framingMode === 'full'} onClick={() => setFramingMode('full')}>全身</button>
                </div>

                <label htmlFor="companion-zoom-desk">画面大小 <span>{Math.round(zoom * 100)}%</span></label>
                <input id="companion-zoom-desk" className="companion-range" type="range" min="0.5" max="2.4" step="0.05" value={zoom} disabled={!usable} onChange={event => setZoom(Number(event.target.value))} />

                <label htmlFor="companion-focus-y-desk" style={{ marginTop: '14px' }}>
                  垂直镜头 <span>{focusOffsetY === 0 ? '默认' : focusOffsetY < 0 ? `向上 ${Math.round(-focusOffsetY * 100)}%` : `向下 ${Math.round(focusOffsetY * 100)}%`}</span>
                </label>
                <input id="companion-focus-y-desk" className="companion-range" type="range" min="-1" max="1" step="0.02" value={focusOffsetY} disabled={!usable} onChange={event => setFocusOffsetY(Number(event.target.value))} />

                <button className="companion-reset-button" disabled={!usable} onClick={() => {
                  stage.current?.reset();
                  setExpressionId('');
                  setZoom(1);
                  setFocusOffsetY(0);
                  setFramingMode('auto');
                  setSpeed(1);
                  setPlaying(false);
                }}><RotateCcw size={14} />重置镜头与姿态</button>
              </section>
            </div>
          )}
        </aside>

        {/* 抽屉毛玻璃遮罩 (Drawer Backdrop) - 仅在开发调试模式启用 */}
        {isDev && !panelCollapsed && (
          <div
            className="companion-drawer-backdrop"
            onClick={() => setPanelCollapsed(true)}
            aria-hidden="true"
          />
        )}

        {isDev && (
          <aside
            id="companion-controls-section"
            className={`companion-controls companion-drawer ${panelCollapsed ? '' : 'is-open'}`}
            aria-label="伴侣控制台"
          >
            <div className="companion-drawer-drag-bar" aria-hidden="true" />
          <div className="companion-drawer-header">
            <div className="companion-drawer-title">
              <span className="companion-avatar">{character.name[0]}</span>
              <div>
                <h2>伴侣调节面板</h2>
                <p>{character.name} · 动作、表情与视角调节</p>
              </div>
            </div>
            <button
              type="button"
              className="companion-drawer-close"
              onClick={() => setPanelCollapsed(true)}
              aria-label="关闭调节面板"
              title="关闭调节面板"
            >
              <X size={18} />
            </button>
          </div>

          {/* 引擎与动作状态条移入抽屉控制台 */}
          <div className="companion-drawer-status-chip">
            <span className={`companion-status-dot ${usable ? 'is-ready' : ''}`} />
            <span>
              {error
                ? '加载遇到问题'
                : !ready
                  ? '正在加载角色模型…'
                  : motionLoading
                    ? '正在切换动作…'
                    : playing
                      ? `${autoIdle ? '动态待机 · ' : ''}正在播放：${activeMotion?.label || motionId}`
                      : '已暂停 · 可拖动进度预览'}
            </span>
          </div>

          <section className="companion-control-section">
            <div className="companion-section-heading">
              <h3>此刻的动作 · {character.motions.length} 个</h3>
              <Link
                href={`/companion/studio?character=${character.id}&motion=${encodeURIComponent(motionId)}`}
                className="companion-text-button"
                title="动作工坊：微调关键帧姿态与导出参数"
              >
                <Sliders size={12} />
                <span>动作工坊</span>
              </Link>
            </div>
            <div className="companion-motion-list" role="region" aria-label="全部动作" tabIndex={0}>
              {motionGroups.map(group => (
                <div className="companion-motion-group" key={group}>
                  <h4>{group}<span>{character.motions.filter(motion => motion.group === group).length}</span></h4>
                  <div className="companion-motion-grid">
                    {character.motions.filter(motion => motion.group === group).map(motion => (
                      <button
                        key={motion.id}
                        className={`companion-motion-button ${motionId === motion.id ? 'is-selected' : ''}`}
                        aria-pressed={motionId === motion.id}
                        title={motion.id}
                        disabled={!ready || !!error}
                        onClick={() => {
                          if (motionId === motion.id) replay();
                          else { setMotionId(motion.id); setPlaying(true); }
                        }}
                      >{motion.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="companion-control-section">
            <div className="companion-section-heading"><h3>全部表情 · {character.expressions.length - 1} 个</h3><button className="companion-text-button" onClick={() => stage.current?.blink()} disabled={!usable}><Eye size={14} />眨眨眼</button></div>
            <div className="companion-expression-grid">
              {character.expressions.map(expression => (
                <button key={expression.id} className={expressionId === expression.id ? 'is-selected' : ''} aria-pressed={expressionId === expression.id} disabled={!usable} onClick={() => setExpressionId(expression.id)}>{expression.label}</button>
              ))}
            </div>
          </section>

          <section className="companion-control-section companion-player">
            <div className="companion-playback-row">
              <button className="companion-play-button" disabled={!usable} aria-label={playing ? '暂停动作' : '播放动作'} onClick={() => {
                if (!playing && snapshot.time >= snapshot.duration) stage.current?.restart();
                setPlaying(value => !value);
              }}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
              <button className="companion-replay-button" disabled={!usable} onClick={replay}><RotateCcw size={14} />重播</button>
              <label className="companion-speed-label">速度<select aria-label="播放速度" value={speed} onChange={event => setSpeed(Number(event.target.value))} disabled={!usable}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option></select></label>
            </div>
            <input className="companion-range" aria-label="动作进度" type="range" min="0" max={snapshot.duration || 1} step="0.01" value={snapshot.time} disabled={!usable} onChange={event => {
              const time = Number(event.target.value);
              stage.current?.seek(time);
              setSnapshot(value => ({ ...value, time }));
            }} />
            <div className="companion-timeline"><span>{snapshot.time.toFixed(1)}s</span><span>{snapshot.duration.toFixed(1)}s</span></div>
            <div className="companion-options">
              <label><input type="checkbox" checked={autoIdle} onChange={event => setAutoIdle(event.target.checked)} />动态待机轮巡</label>
              <label><input type="checkbox" checked={loop} disabled={autoIdle} onChange={event => setLoop(event.target.checked)} />单动作循环</label>
              <label><input type="checkbox" checked={autoBlink} onChange={event => setAutoBlink(event.target.checked)} />自然眨眼</label>
              <label><input type="checkbox" checked={lookAt} onChange={event => setLookAt(event.target.checked)} />按住拖动视线跟随</label>
            </div>
          </section>



          <section className="companion-control-section companion-view-controls">
            <div className="companion-section-heading">
              <h3>构图与镜头</h3>
              <span>参数调节</span>
            </div>
            <div className="companion-framing-switch" role="group" aria-label="构图模式">
              <button type="button" aria-pressed={framingMode === 'auto'} onClick={() => setFramingMode('auto')}>自适应</button>
              <button type="button" aria-pressed={framingMode === 'closeup'} onClick={() => setFramingMode('closeup')}>大特写</button>
              <button type="button" aria-pressed={framingMode === 'half'} onClick={() => setFramingMode('half')}>半身</button>
              <button type="button" aria-pressed={framingMode === 'full'} onClick={() => setFramingMode('full')}>全身</button>
            </div>

            <label htmlFor="companion-zoom">画面大小 <span>{Math.round(zoom * 100)}%</span></label>
            <input id="companion-zoom" className="companion-range" type="range" min="0.5" max="2.4" step="0.05" value={zoom} disabled={!usable} onChange={event => setZoom(Number(event.target.value))} />

            <label htmlFor="companion-focus-y" style={{ marginTop: '14px' }}>
              垂直镜头 <span>{focusOffsetY === 0 ? '默认' : focusOffsetY < 0 ? `向上 ${Math.round(-focusOffsetY * 100)}%` : `向下 ${Math.round(focusOffsetY * 100)}%`}</span>
            </label>
            <input id="companion-focus-y" className="companion-range" type="range" min="-1" max="1" step="0.02" value={focusOffsetY} disabled={!usable} onChange={event => setFocusOffsetY(Number(event.target.value))} />

            <button className="companion-reset-button" disabled={!usable} onClick={() => {
              stage.current?.reset();
              setExpressionId('');
              setZoom(1);
              setFocusOffsetY(0);
              setFramingMode('auto');
              setSpeed(1);
              setPlaying(false);
            }}><RotateCcw size={14} />重置镜头与姿态</button>
          </section>

            <div className="companion-preview-note"><span>角色与动作预览</span><p>心动日常，温暖相伴。随时畅聊倾诉。</p><small>{ready ? `${snapshot.meshes} 个网格 · ${snapshot.fps || '—'} FPS` : '本地资源加载中'}</small></div>
        </aside>
        )}

        {/* ==================== 伴侣偏好设置弹窗 (Companion Preferences & Storage Modal) ==================== */}
        {settingsOpen && (
          <div className="companion-char-picker-backdrop companion-settings-backdrop" onClick={() => setSettingsOpen(false)}>
            <div className="companion-settings-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="companion-settings-title">
              <div className="companion-settings-header">
                <div className="companion-settings-title-group">
                  <span className="companion-settings-icon-badge"><Settings size={18} /></span>
                  <div>
                    <h4 id="companion-settings-title">伴侣偏好设置</h4>
                    <p className="companion-settings-subtitle">个性化您的陪伴空间与交互体验</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="companion-char-picker-close"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="关闭设置"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="companion-settings-body">
                {/* 1. 声音与语音 */}
                <div className="companion-settings-group">
                  <div className="companion-settings-group-header">
                    <h5 className="companion-settings-group-title">声音与语音</h5>
                  </div>

                  <div className="companion-setting-row">
                    <div className="companion-setting-info">
                      <div className="companion-setting-label-wrap">
                        <span className="companion-setting-label">伴侣对话语音朗读</span>
                        <span className={`companion-setting-badge ${voiceEnabled ? 'is-active' : 'is-muted'}`}>
                          {voiceEnabled ? '已开启' : '已静音'}
                        </span>
                      </div>
                      <p className="companion-setting-desc">
                        开启后角色回复时由专属 AI 语音轻声朗诵；关闭时保留文字气泡并节省流量。
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`companion-switch ${voiceEnabled ? 'is-on' : ''}`}
                      onClick={() => toggleVoice(!voiceEnabled)}
                      role="switch"
                      aria-checked={voiceEnabled}
                      aria-label="切换对话语音朗读"
                    >
                      <span className="companion-switch-thumb" />
                    </button>
                  </div>

                  <div className="companion-setting-row">
                    <div className="companion-setting-info">
                      <div className="companion-setting-label-wrap">
                        <span className="companion-setting-label">触摸与互动音效</span>
                        <span className={`companion-setting-badge ${sfxEnabled ? 'is-active' : 'is-muted'}`}>
                          {sfxEnabled ? '已开启' : '已静音'}
                        </span>
                      </div>
                      <p className="companion-setting-desc">
                        触摸、点击或拖拽伴侣时的动作音效与轻柔娇嗔语音反馈。
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`companion-switch ${sfxEnabled ? 'is-on' : ''}`}
                      onClick={() => toggleSfx(!sfxEnabled)}
                      role="switch"
                      aria-checked={sfxEnabled}
                      aria-label="切换触摸与互动音效"
                    >
                      <span className="companion-switch-thumb" />
                    </button>
                  </div>
                </div>

                {/* 3. 模型与系统配置 */}
                <div className="companion-settings-footer-card">
                  <Link
                    href="/settings"
                    className="companion-settings-footer-link"
                    onClick={() => setSettingsOpen(false)}
                  >
                    <div className="companion-settings-footer-info">
                      <strong>系统大模型与 API 配置</strong>
                      <span>伴侣回复直接使用您在全局设置保存的专属模型与密钥</span>
                    </div>
                    <span className="companion-settings-footer-arrow">
                      <ChevronRight size={16} />
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
