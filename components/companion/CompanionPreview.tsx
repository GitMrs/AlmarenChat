'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, LayoutGrid, Loader2, MessageCircle, Pause, Play, RotateCcw, SendHorizonal, Settings, Sliders, Smile, Sparkles, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import CompanionStage, { type FramingMode, type StageHandle, type StageSnapshot } from './CompanionStage';
import { companionCharacters, type CompanionCharacter } from '@/lib/companion/catalog';
import { getRandomTapLine, getRapidTapLine, getRandomStartupLine, getRandomDragLine, type VoiceLine } from '@/lib/companion/voice';
import { primeChatAudio } from '@/lib/companion/chat-audio';

const quickPrompts = [
  {
    emoji: '👋',
    label: '拍拍头',
    userText: '（轻轻拍了拍你的头）',
    motion: 'happy',
    replyNari: '嘻嘻，被摸头发感觉好安心呀… (*´▽`*)',
    replyYume: '哇！突然摸头，心跳都漏了一拍呢！(*>ω<*)'
  },
  {
    emoji: '✨',
    label: '夸夸我',
    userText: '今天我很努力，快夸夸我！',
    motion: 'greeting',
    replyNari: '你一直都超级棒的！今天也是满分的一天，给你一朵小红花 🌸',
    replyYume: '太厉害啦！我就知道你最行了，为你超级骄傲！🎉'
  },
  {
    emoji: '🍵',
    label: '有点累',
    userText: '今天感觉有点累了…',
    motion: 'talk',
    replyNari: '辛苦啦…快靠着放松一会儿吧，我会一直安安静静陪着你。',
    replyYume: '给你递上一杯温温的奶茶~ 别硬撑，有我陪你放空休息！'
  },
  {
    emoji: '💭',
    label: '在想什么',
    userText: '你现在在想什么呢？',
    motion: 'talk',
    replyNari: '在想…此刻有你陪在身边，时光都变得很温柔。',
    replyYume: '在想等会儿咱们要不要一起放首歌听听呢！'
  },
  {
    emoji: '🌙',
    label: '晚安啦',
    userText: '今天先到这里啦，晚安！',
    motion: 'greeting',
    replyNari: '晚安好梦~ 盖好被子，愿你有甜甜的梦，明天见。🌙',
    replyYume: '晚安晚安！好好睡一觉，明天也要元气满满哦！✨'
  },
];

interface CompanionChatMessage {
  id: string;
  sender: 'user' | 'companion';
  text: string;
  isSticker?: boolean;
}

function getDefaultMessages(charId: string): CompanionChatMessage[] {
  if (charId === 'lafei') {
    return [
      { id: 'm1', sender: 'companion', text: '指挥官，欢迎回来。莱菲一直在等你。' },
      { id: 'm2', sender: 'user', text: '辛苦了拉菲，今天港区一切都好吗？' },
      { id: 'm3', sender: 'companion', text: '一切正常哦。今天的任务也已经完成了，指挥官。' },
      { id: 'm4', sender: 'companion', text: '莱菲有点困了...要靠在指挥官身边休息一下吗？' },
      { id: 'm5', sender: 'companion', text: '💤', isSticker: true },
    ];
  }
  if (charId === 'mao') {
    return [
      { id: 'm1', sender: 'companion', text: '喵~ 主人你回来啦！真央一直在这里等你喵~(ฅ´ω`ฅ)' },
      { id: 'm2', sender: 'user', text: '真央今天有没有乖乖看家？' },
      { id: 'm3', sender: 'companion', text: '真央今天也很努力在工作喵！(*^▽^*)' },
      { id: 'm4', sender: 'companion', text: '肚子饿了喵，主人是不是该上贡小鱼干了喵？' },
      { id: 'm5', sender: 'companion', text: '🐾', isSticker: true },
    ];
  }
  if (charId === 'yume') {
    return [
      { id: 'm1', sender: 'companion', text: '嗨！今天也是元气满满的一天哦！' },
      { id: 'm2', sender: 'user', text: '哈哈，看到你我也精神了！' },
      { id: 'm3', sender: 'companion', text: '嘿嘿，有你陪着超开心！' },
      { id: 'm4', sender: 'companion', text: '我是Yume！快跟我聊聊今天遇到什么好玩的事了吧？' },
      { id: 'm5', sender: 'companion', text: '✨', isSticker: true },
    ];
  }
  return [
    { id: 'm1', sender: 'companion', text: '你好呀，今天过得开心吗？' },
    { id: 'm2', sender: 'user', text: '还可以，你今天在做什么呢？' },
    { id: 'm3', sender: 'companion', text: '嘿，你好可爱呀！' },
    { id: 'm4', sender: 'companion', text: '初次见面，你能来我好开心，我是Nari。今天想做点什么呢？' },
    { id: 'm5', sender: 'companion', text: '☺️', isSticker: true },
  ];
}

const COMPANION_STORAGE_PREFIX = 'almaren_companion_chat_';

function getStoredMessages(charId: string): CompanionChatMessage[] {
  if (typeof window === 'undefined') return getDefaultMessages(charId);
  try {
    const raw = localStorage.getItem(`${COMPANION_STORAGE_PREFIX}${charId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[Companion Storage] Failed to load cached messages:', e);
  }
  return getDefaultMessages(charId);
}

function saveStoredMessages(charId: string, messages: CompanionChatMessage[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${COMPANION_STORAGE_PREFIX}${charId}`, JSON.stringify(messages.slice(-50)));
  } catch (e) {
    console.warn('[Companion Storage] Failed to save messages to localStorage:', e);
  }
}

const NARI_IDLE_POOL = [
  'Nari_idle_02_double_bounce', // 轻轻晃一晃 (5.58s - 少女元气轻晃与飘带摆动)
  'Nari_idle_08_look_around',   // 四处看看 (6.84s - 好奇环顾)
  'Nari_idle_06_giggle',        // 偷偷笑 (5.40s - 掩嘴轻笑)
  'Nari_idle_04_flirty_lashes', // 轻眨睫毛 (6.30s - 眨动睫毛)
  'Nari_idle_13_tease_peek',    // 调皮偷看 (6.48s - 探头偷看)
  'Nari_chat_02_listen_tilt',   // 侧头倾听 (8.46s - 温柔侧头)
  'Nari_chat_03_warm_breath',   // 轻柔呼吸 (9.00s - 舒缓呼吸)
  'Nari_chat_05_readjust',      // 调整站姿 (7.92s - 换重心站立)
  'Nari_mood_happy_sway',       // 开心摇摆 (5.22s - 轻快摇晃)
  'Nari_cheeky_swing_wink',     // 俏皮眨眼 (7.50s - 俏皮眨眼)
];

const YUME_IDLE_POOL = [
  'Yume_idle_03_brisk_nods',     // 轻快点头 (6.98s - 元气活泼点头)
  'Yume_chat_03_shy_glance',     // 悄悄看你 (9.45s - 偷偷瞄你一眼)
  'Yume_idle_10_smug_wink',      // 得意眨眼 (10.80s - 骄傲小眨眼)
  'Yume_idle_11_double_take',    // 回头再看 (10.20s - 惊喜再看)
  'Yume_idle_13_victory',        // 小小得意 (9.90s - 胜利姿态)
  'Yume_mood_happy_pleased',     // 心情不错 (9.00s - 心情愉悦摇动)
  'Yume_chat_02_listen_tilt',    // 侧头倾听 (12.68s - 侧头倾听)
  'Yume_chat_05_readjust',       // 调整站姿 (12.08s - 整理姿态)
  'Yume_cheeky_swing_wink',      // 俏皮眨眼 (8.40s - 俏皮眨眼)
  'Yume_mood_loving_soft',       // 温柔心动 (10.50s - 温柔心动)
];

const LAFEI_IDLE_POOL = [
  'Idle',
  'Special_0',
  'Special_1',
  'Special_3',
  'Special_4',
];

const MAO_IDLE_POOL = [
  'Idle',
  'TapBody_1',
  'TapBody_2',
];

function getInitialMotion(charId: string): string {
  if (charId === 'yume') return 'Yume_idle_03_brisk_nods';
  if (charId === 'lafei') return 'Idle';
  if (charId === 'mao') return 'Idle';
  return 'Nari_idle_02_double_bounce';
}

function getRandomIdleMotion(charId: string, currentMotionId: string): string {
  const pool = charId === 'yume'
    ? YUME_IDLE_POOL
    : charId === 'lafei'
    ? LAFEI_IDLE_POOL
    : charId === 'mao'
    ? MAO_IDLE_POOL
    : NARI_IDLE_POOL;
  const candidates = pool.filter(id => id !== currentMotionId);
  const choice = candidates[Math.floor(Math.random() * candidates.length)] || pool[0];
  return choice;
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

export default function CompanionPreview() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [characterId, setCharacterId] = useState(companionCharacters[0].id);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      router.replace('/login?redirect=/companion');
      return;
    }
    setAuthed(true);

    const handleAuthChange = () => {
      const currentToken = localStorage.getItem('token');
      if (!currentToken) {
        router.replace('/login?redirect=/companion');
      }
    };
    window.addEventListener('almaren-auth-change', handleAuthChange);
    return () => window.removeEventListener('almaren-auth-change', handleAuthChange);
  }, [router]);

  if (authed !== true) {
    return (
      <main className="companion-page" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fcf8f5' }}>
        <div className="companion-loading-card" style={{ padding: '36px 48px', textAlign: 'center' }}>
          <Loader2 size={26} className="companion-spinner" style={{ margin: '0 auto 12px' }} />
          <p style={{ fontWeight: 600, color: '#4a3427', margin: '0 0 6px' }}>正在验证访问权限…</p>
          <span style={{ fontSize: '12px', color: '#9e7c64' }}>登录后方可进入伴侣专属空间</span>
        </div>
      </main>
    );
  }

  const character = companionCharacters.find(candidate => candidate.id === characterId) ?? companionCharacters[0];
  return <CompanionSession key={character.id} character={character} onCharacterChange={setCharacterId} />;
}

function CompanionSession({ character, onCharacterChange }: { character: CompanionCharacter; onCharacterChange(id: string): void }) {
  const router = useRouter();
  const stage = useRef<StageHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [motionId, setMotionId] = useState(() => getInitialMotion(character.id));
  const [expressionId, setExpressionId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState<CompanionChatMessage[]>(() => getStoredMessages(character.id));
  const [showStickers, setShowStickers] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
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
  const [sceneBg, setSceneBg] = useState<'cherry_room' | 'ocean_room' | 'none'>(() => (character.id === 'yume' || character.id === 'lafei') ? 'ocean_room' : 'cherry_room');
  const [ready, setReady] = useState(false);
  const [motionLoading, setMotionLoading] = useState(true);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const [snapshot, setSnapshot] = useState<StageSnapshot>({ time: 0, duration: 0, fps: 0, meshes: 0 });
  const activeMotion = character.motions.find(motion => motion.id === motionId);
  const motionGroups = [...new Set(character.motions.map(motion => motion.group))];
  const usable = ready && !error;
  const [charMenuOpen, setCharMenuOpen] = useState(false);
  const chatStreamRef = useRef<HTMLDivElement>(null);
  const desktopChatStreamRef = useRef<HTMLDivElement>(null);
  const [desktopTab, setDesktopTab] = useState<'chat' | 'motion'>('chat');
  const [tapBubble, setTapBubble] = useState<{ text: string; id: number; combo?: number } | null>(null);
  const [tapParticles, setTapParticles] = useState<{ id: number; x: number; y: number; symbol: string }[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [chatVoiceNotice, setChatVoiceNotice] = useState<{ messageId: string; audioUrl?: string } | null>(null);
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

  const toggleVoice = (enabled: boolean) => {
    setVoiceEnabled(enabled);
    voiceEnabledRef.current = enabled;
    if (!enabled) {
      chatPlaybackRef.current++;
      setChatVoiceNotice(null);
      if (chatAudioRef.current && chatAudioRef.current !== currentAudioRef.current) releaseAudio(chatAudioRef.current);
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem('almaren_companion_voice_enabled', String(enabled));
    }
    if (!enabled && currentAudioRef.current) {
      releaseAudio(currentAudioRef.current);
      currentAudioRef.current = null;
      isPlayingVoiceRef.current = false;
      if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
      setTapBubble(null);
      setIsSpeaking(false);
      stage.current?.stopSpeaking();
    }
  };

  const toggleSfx = (enabled: boolean) => {
    setSfxEnabled(enabled);
    if (typeof window !== 'undefined') {
      localStorage.setItem('almaren_companion_sfx_enabled', String(enabled));
    }
    if (!enabled && currentAudioRef.current) {
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
  const isPlayingVoiceRef = useRef<boolean>(false);
  const comboCountRef = useRef<number>(0);
  const exhaustedUntilRef = useRef<number>(0);
  const expressionResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatPlaybackRef = useRef(0);
  const voiceEnabledRef = useRef(voiceEnabled);
  const preparedTapVoicesRef = useRef(new Map<'tap' | 'rapid', { line: VoiceLine; audio: HTMLAudioElement }>());
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingGazeRef = useRef(false);
  const lastDragEndRef = useRef(0);
  const dragStartTimeRef = useRef(0);
  const dragDistanceRef = useRef(0);
  const lastDragVoiceTimeRef = useRef(0);
  const hasTriggeredStartupRef = useRef(false);
  const isTransitioningMotionRef = useRef(false);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const sessionActiveRef = useRef(true);
  const sessionTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const tapExpression = character.expressions.find(expression => {
    if (character.id === 'yume') return expression.id === 'Shy';
    if (character.id === 'mao') return expression.id === '害羞';
    return expression.id === 'Blushing';
  })?.id ?? '';

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

  const prepareTapVoice = (kind: 'tap' | 'rapid') => {
    if (!voiceEnabled || !sfxEnabled || preparedTapVoicesRef.current.has(kind)) return;
    const line = kind === 'tap' ? getRandomTapLine(character.id) : getRapidTapLine(character.id);
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
    const target = e.target as HTMLElement;
    if (target.closest('button, form, input, .companion-floating-hud, .companion-dockbar, .companion-quick-reactions, .companion-controls, .companion-drawer-backdrop')) {
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 容错处理
    }
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragStartTimeRef.current = Date.now();
    dragDistanceRef.current = 0;
    isDraggingGazeRef.current = false;
  };

  const handleScenePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dist = Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y);
    dragDistanceRef.current = Math.max(dragDistanceRef.current, dist);
    if (dist >= 6) {
      isDraggingGazeRef.current = true;
    }
  };

  const handleScenePointerUp = (e?: React.PointerEvent) => {
    if (e && e.currentTarget) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // 容错处理
      }
    }
    const now = Date.now();
    const wasDragging = isDraggingGazeRef.current;
    const dragDuration = now - dragStartTimeRef.current;
    const dragDist = dragDistanceRef.current;

    dragStartRef.current = null;
    isDraggingGazeRef.current = false;

    if (wasDragging) {
      lastDragEndRef.current = now;

      // 拖拽趣味互动判定：按住拖动时长 >= 350ms 且总位移 >= 30px
      if (dragDuration >= 350 && dragDist >= 30) {
        // 拖拽语音保护防连刷：至少间隔 3.5 秒且当前未在播放语音
        if (now - lastDragVoiceTimeRef.current > 3500 && !isPlayingVoiceRef.current) {
          lastDragVoiceTimeRef.current = now;
          playDragVoice();
        }
      }
    }
  };

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
    }
  ) => {
    const now = Date.now();
    const fallbackDuration = (line.seconds ?? Math.max(1.8, line.text.length * 0.16)) * 1000;

    // 动作与表情联动
    if (options?.targetMotionId) {
      setMotionId(options.targetMotionId);
      setPlaying(true);
    }
    if (options?.targetExpression) {
      setExpressionId(options.targetExpression);
      if (expressionResetTimerRef.current) clearSessionTimeout(expressionResetTimerRef.current);
      // 3.2 秒后表情平滑回归自然
      expressionResetTimerRef.current = setSessionTimeout(() => {
        setExpressionId('');
      }, 3200);
    }

    // 弹出舞台台词字幕并联动发音（保持独立互动，不污染正常聊天流）
    if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
    setTapBubble(null);
    const showBubble = () => setTapBubble({ text: line.text, id: now, combo: options?.combo });

    if (!voiceEnabled || !sfxEnabled || !line.audioUrl) {
      showBubble();
      setIsSpeaking(true);
      stage.current?.speak(fallbackDuration);
      if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
      tapBubbleTimerRef.current = setSessionTimeout(() => {
        setTapBubble(null);
        setIsSpeaking(false);
        stage.current?.stopSpeaking();
      }, fallbackDuration);
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
          isPlayingVoiceRef.current = false;
          showBubble();
          setIsSpeaking(true);
          stage.current?.speak(fallbackDuration);
          if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
          tapBubbleTimerRef.current = setSessionTimeout(() => {
            setTapBubble(null);
            setIsSpeaking(false);
            stage.current?.stopSpeaking();
          }, fallbackDuration);
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
          isPlayingVoiceRef.current = false;
          setIsSpeaking(false);
          stage.current?.stopSpeaking();

          // 若来自点击且在连击中（1.2s 内有点击且 combo >= 3），紧接着播放连击语音！
          if (options?.isTap) {
            const finishedAt = Date.now();
            if (finishedAt - lastTapTimeRef.current < 1200 && comboCountRef.current >= 3) {
              const nextCombo = comboCountRef.current;
              playTapVoice(nextCombo);
              return;
            }
          }
          if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
          tapBubbleTimerRef.current = setSessionTimeout(() => {
            setTapBubble(null);
          }, 500);
        };
        audio.onpause = () => {
          clearSessionTimeout(loadingTimer);
          isPlayingVoiceRef.current = false;
          setIsSpeaking(false);
          stage.current?.stopSpeaking();
        };
        audio.onerror = fallback;
        audio.play().catch(fallback);
        if (prepared) prepareTapVoice(prepared[0]);
      } catch {
        isPlayingVoiceRef.current = false;
        showBubble();
        setIsSpeaking(true);
        stage.current?.speak(fallbackDuration);
        tapBubbleTimerRef.current = setSessionTimeout(() => {
          setTapBubble(null);
          setIsSpeaking(false);
        }, fallbackDuration);
      }
    } else {
      isPlayingVoiceRef.current = true;
      setIsSpeaking(true);
      stage.current?.speak(fallbackDuration);
      tapBubbleTimerRef.current = setSessionTimeout(() => {
        isPlayingVoiceRef.current = false;
        setIsSpeaking(false);
        if (options?.isTap) {
          const finishedAt = Date.now();
          if (finishedAt - lastTapTimeRef.current < 1200 && comboCountRef.current >= 3) {
            playTapVoice(comboCountRef.current);
            return;
          }
        }
        setTapBubble(null);
      }, fallbackDuration);
    }
  };

  // 播放初次载入欢迎问候语音
  const playStartupVoice = () => {
    const line = getRandomStartupLine(character.id);
    let targetMotionId = '';
    let targetExpression = '';

    if (character.id === 'nari') {
      const startupMotions = ['Nari_bright_bounce', 'Nari_chat_01_attentive', 'Nari_mood_happy_sway', 'Nari_idle_02_double_bounce'];
      const chosen = startupMotions[Math.floor(Math.random() * startupMotions.length)];
      const m = character.motions.find(candidate => candidate.id === chosen);
      if (m) targetMotionId = m.id;
    } else if (character.id === 'yume') {
      const startupMotions = ['Yume_idle_03_brisk_nods', 'Yume_chat_01_attentive', 'Yume_idle_13_victory'];
      const m = character.motions.find(candidate => startupMotions.includes(candidate.id));
      if (m) targetMotionId = m.id;
    } else if (character.id === 'lafei') {
      const m = character.motions.find(candidate => candidate.id === 'Idle');
      if (m) targetMotionId = m.id;
    } else if (character.id === 'mao') {
      const m = character.motions.find(candidate => candidate.id === 'Idle');
      if (m) targetMotionId = m.id;
      targetExpression = '微笑';
    }

    playVoice(line, { targetMotionId, targetExpression });
  };

  // 播放拖拽反应趣味语音
  const playDragVoice = () => {
    const line = getRandomDragLine(character.id);
    let targetMotionId = '';
    let targetExpression = '';

    if (character.id === 'nari') {
      const dragMotions = ['Nari_idle_08_look_around', 'Nari_mood_surprised_lean', 'Nari_cheeky_swing_wink', 'Nari_mood_happy_sway', 'Nari_bright_bounce'];
      const chosen = dragMotions[Math.floor(Math.random() * dragMotions.length)];
      const m = character.motions.find(candidate => candidate.id === chosen);
      if (m) targetMotionId = m.id;
      if (line.id === 'nari_drag_01' || line.id === 'nari_drag_02') {
        targetExpression = 'Silly';
      } else if (line.id === 'nari_drag_05') {
        targetExpression = 'Mischievous';
      } else if (line.id === 'nari_drag_06') {
        targetExpression = 'Love';
      } else {
        targetExpression = 'Shocked';
      }
    } else if (character.id === 'yume') {
      const dragMotions = ['Yume_mood_surprised_wait_what', 'Yume_idle_01_hmph_look_away'];
      const m = character.motions.find(candidate => dragMotions.includes(candidate.id));
      if (m) targetMotionId = m.id;
      targetExpression = '吃惊';
    } else if (character.id === 'lafei') {
      const m = character.motions.find(candidate => candidate.id === 'TapBody_0');
      if (m) targetMotionId = m.id;
    } else if (character.id === 'mao') {
      const m = character.motions.find(candidate => candidate.id === 'TapBody_1');
      if (m) targetMotionId = m.id;
      targetExpression = '生气';
    }

    playVoice(line, { targetMotionId, targetExpression });
  };

  // 角色模型准备就绪后，播放亲切的进场日常问候
  useEffect(() => {
    if (!ready || hasTriggeredStartupRef.current) return;
    hasTriggeredStartupRef.current = true;

    const timer = setSessionTimeout(() => {
      playStartupVoice();
    }, 550);

    return () => clearSessionTimeout(timer);
  }, [ready, character.id]);

  // 播放触碰反馈语音（支持日常问候、急促连击台词、求饶三种档位）
  const playTapVoice = (combo: number) => {
    const now = Date.now();
    let line: VoiceLine;
    let targetExpression = '';
    let targetMotionId = '';

    if (combo >= 5) {
      // 🌟 Level 3: 连击 5 次以上，触发【求饶/娇嗔保护态】！
      if (character.id === 'lafei') {
        line = { id: 'surrender', text: '要...要坏掉了...指挥官...！', seconds: 2.2 };
        const motion = character.motions.find(m => m.id === 'TapBody_1');
        if (motion) targetMotionId = motion.id;
      } else if (character.id === 'mao') {
        line = { id: 'surrender', text: '哇啊啊！主人太热情了喵，真央要坏掉啦喵~~ (///Σ///)', seconds: 2.4 };
        targetExpression = '害羞';
        const motion = character.motions.find(m => m.id === 'TapBody_1');
        if (motion) targetMotionId = motion.id;
      } else if (character.id === 'nari') {
        line = { id: 'surrender', text: '好啦好啦，手下留情嘛~ 🌸', audioUrl: '/companion/audio/voice/nari/tap_09.mp3', seconds: 2.2 };
        targetExpression = tapExpression;
        const shyMotion = character.motions.find(m =>
          m.id.toLowerCase().includes('shy_duck') ||
          m.id.toLowerCase().includes('shy')
        );
        if (shyMotion) targetMotionId = shyMotion.id;
      } else {
        line = { id: 'surrender', text: '真是的，败给你了！快停下啦~ 😤', seconds: 2.2 };
        targetExpression = tapExpression;
        const shyMotion = character.motions.find(m =>
          m.id.toLowerCase().includes('flustered') ||
          m.id.toLowerCase().includes('shy')
        );
        if (shyMotion) targetMotionId = shyMotion.id;
      }

      // 触发 2.4 秒求饶保护，防连点器刷屏
      exhaustedUntilRef.current = now + 2400;
      comboCountRef.current = 0;
    } else if (combo >= 3) {
      // 🌟 Level 2: 连点 3~4 次，触发【慌乱/连击专属台词】！
      line = preparedTapVoicesRef.current.get('rapid')?.line ?? getRapidTapLine(character.id);
      targetExpression = tapExpression;
      if (character.id === 'lafei') {
        const rapidMotion = character.motions.find(m => m.id === 'TapBody_0');
        if (rapidMotion) targetMotionId = rapidMotion.id;
      } else if (character.id === 'mao') {
        targetExpression = '生气';
        const rapidMotion = character.motions.find(m => m.id === 'TapBody_0');
        if (rapidMotion) targetMotionId = rapidMotion.id;
      } else {
        const rapidMotion = character.motions.find(m =>
          m.id.toLowerCase().includes('surprised_jolt') ||
          m.id.toLowerCase().includes('giggle') ||
          m.id.toLowerCase().includes('shy_twist') ||
          m.id.toLowerCase().includes('bounce')
        );
        if (rapidMotion) targetMotionId = rapidMotion.id;
      }
    } else {
      // 🌟 Level 1: 正常单次轻戳日常问候
      line = preparedTapVoicesRef.current.get('tap')?.line ?? getRandomTapLine(character.id);
      if (character.id === 'lafei') {
        const tapPool = ['TapHead', 'TapBody_0', 'Special_2', 'Idle'];
        const chosen = tapPool[Math.floor(Math.random() * tapPool.length)];
        const motion = character.motions.find(m => m.id === chosen);
        if (motion) targetMotionId = motion.id;
      } else if (character.id === 'mao') {
        const tapPool = ['TapBody_0', 'TapBody_1', 'TapBody_2', 'Idle'];
        const chosen = tapPool[Math.floor(Math.random() * tapPool.length)];
        const motion = character.motions.find(m => m.id === chosen);
        if (motion) targetMotionId = motion.id;
        const expPool = ['开心', '微笑', '通常'];
        const exp = character.expressions.find(e => expPool.includes(e.id));
        if (exp) targetExpression = exp.id;
      } else {
        const tapMotions = character.motions.filter(m =>
          m.id.toLowerCase().includes('giggle') ||
          m.id.toLowerCase().includes('shy') ||
          m.id.toLowerCase().includes('bounce') ||
          m.id.toLowerCase().includes('wink') ||
          m.id.toLowerCase().includes('pop') ||
          m.group === '心情' ||
          m.group === '互动'
        );
        if (tapMotions.length > 0) {
          targetMotionId = tapMotions[Math.floor(Math.random() * tapMotions.length)].id;
        }
      }
    }

    playVoice(line, { targetMotionId, targetExpression, combo, isTap: true });
  };

  // 角色点击触碰交互：
  // 1. 每点一次即刻触发心动微粒子反馈 (❤️ / 🌸 / ✨)
  // 2. 眼睛按照模型自身动作与待机节奏自然眨眼，绝不随点击暴力快速眨眼
  // 3. 播放语音中做禁用不要覆盖，只累计点击次数
  // 4. 语音播放完了，若仍在连击，紧接着播放连击语音
  const handleCharacterTap = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, form, input, .companion-floating-hud, .companion-dockbar, .companion-quick-reactions, .companion-controls, .companion-drawer-backdrop')) {
      return;
    }

    // 若刚才是在按住拖拽视线引导（释放后 400ms 内），不误触发角色轻点对白与粒子
    if (Date.now() - lastDragEndRef.current < 400) {
      return;
    }

    const now = Date.now();

    // 1. 生成点击位置的浮动心动粒子 (❤️ / 🌸 / ✨)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(20, Math.min(rect.width - 20, e.clientX - rect.left));
    const y = Math.max(20, Math.min(rect.height - 20, e.clientY - rect.top));
    const symbols = character.id === 'yume'
      ? ['🌊', '✨', '💙', '⭐']
      : character.id === 'lafei'
      ? ['🍷', '🐰', '💤', '✨', '🤍']
      : character.id === 'mao'
      ? ['🐾', '🐟', '🐱', '💖', '✨']
      : ['🌸', '❤️', '✨', '💕'];
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
  }, [messages, isReplying, desktopTab]);

  // 初次载入时直接触底展示最新气泡
  useEffect(() => {
    const el = chatStreamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    const deskEl = desktopChatStreamRef.current;
    if (deskEl) deskEl.scrollTop = deskEl.scrollHeight;
  }, []);

  // 聊天记录自动保存至本地缓存 (localStorage)
  useEffect(() => {
    saveStoredMessages(character.id, messages);
  }, [messages, character.id]);

  const handleClearHistory = () => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`确定要清空与 ${character.name} 的本地对话记录吗？清空后将恢复为最初问候。`);
      if (!ok) return;
      try {
        localStorage.removeItem(`${COMPANION_STORAGE_PREFIX}${character.id}`);
      } catch {}
    }
    setMessages(getDefaultMessages(character.id));
  };

  const replay = () => {
    stage.current?.restart();
    setPlaying(true);
  };

  const playChatVoice = (audioUrl: string, messageId: string) => {
    if (!sessionActiveRef.current || !voiceEnabledRef.current) return;
    const playback = ++chatPlaybackRef.current;
    const audio = chatAudioRef.current ?? new Audio();
    chatAudioRef.current = audio;
    if (currentAudioRef.current) releaseAudio(currentAudioRef.current);
    currentAudioRef.current = audio;
    const isCurrent = () => sessionActiveRef.current && voiceEnabledRef.current
      && chatPlaybackRef.current === playback && currentAudioRef.current === audio;
    let failed = false;
    const stopSpeaking = () => {
      isPlayingVoiceRef.current = false;
      setIsSpeaking(false);
      stage.current?.stopSpeaking();
    };
    const onFailure = () => {
      if (failed || !isCurrent()) return;
      failed = true;
      releaseAudio(audio);
      stopSpeaking();
      setChatVoiceNotice({ messageId, audioUrl });
    };
    setChatVoiceNotice(null);
    isPlayingVoiceRef.current = true;
    audio.onplaying = () => {
      if (!isCurrent()) return;
      isPlayingVoiceRef.current = true;
      setIsSpeaking(true);
    };
    audio.onended = audio.onpause = () => {
      if (isCurrent()) stopSpeaking();
    };
    audio.onerror = onFailure;
    try {
      audio.src = audioUrl;
      audio.load();
      audio.play().catch(onFailure);
    } catch {
      onFailure();
    }
  };

  const chatVoiceFeedback = (messageId: string) => chatVoiceNotice?.messageId === messageId && (
    chatVoiceNotice.audioUrl ? (
      <button type="button" className="companion-chat-voice-retry" onClick={() => playChatVoice(chatVoiceNotice.audioUrl!, messageId)}>
        <Volume2 size={14} /> 点击播放语音
      </button>
    ) : <small className="companion-chat-voice-notice">本次回复暂时没有语音</small>
  );

  const sendCompanionMessage = async (text: string, preferredMotion?: string) => {
    const trimmed = text.trim();
    if (!trimmed || !usable || isReplying) return;
    chatPlaybackRef.current++;
    setChatVoiceNotice(null);

    // 清空输入框并收起快捷表情面板
    setMessageText('');
    setShowStickers(false);

    // 如果之前有正在播放的语音，立即停止旧语音
    if (currentAudioRef.current) {
      releaseAudio(currentAudioRef.current);
    }
    currentAudioRef.current = null;
    if (voiceEnabledRef.current) {
      try {
        const audio = chatAudioRef.current ?? new Audio();
        chatAudioRef.current = audio;
        releaseAudio(audio);
        primeChatAudio(audio);
      } catch {}
    }
    if (tapBubbleTimerRef.current) clearSessionTimeout(tapBubbleTimerRef.current);
    setTapBubble(null);
    isPlayingVoiceRef.current = false;
    setIsSpeaking(false);
    stage.current?.stopSpeaking();

    const userMsg: CompanionChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: trimmed,
    };

    // 保留历史对话流，配合顶部渐变遮罩支持向上滚动翻看
    const historySnapshot = messages.slice(-6);
    setMessages(prev => [...prev.slice(-49), userMsg]);
    setIsReplying(true);

    if (bubbleTimerRef.current) clearSessionTimeout(bubbleTimerRef.current);

    // 倾听姿态联动：用户发消息时，伴侣切换为专注倾听或互动动作
    let listeningMotion = preferredMotion;
    if (!listeningMotion) {
      if (character.id === 'nari') {
        listeningMotion = 'Nari_chat_01_attentive';
      } else if (character.id === 'yume') {
        listeningMotion = 'Yume_chat_01_attentive';
      } else {
        const found = character.motions.find(m =>
          m.id.toLowerCase().includes('attentive') ||
          m.id.toLowerCase().includes('chat') ||
          m.id.toLowerCase().includes('idle')
        );
        listeningMotion = found?.id;
      }
    }
    if (listeningMotion) {
      const matched = character.motions.find(m => m.id === listeningMotion || m.id.toLowerCase().includes(listeningMotion!.toLowerCase()));
      if (matched) {
        setMotionId(matched.id);
        setPlaying(true);
      }
    }

    // 中断上一次仍在进行的对话请求，防止快速连续点击并发冲突
    if (chatAbortControllerRef.current) {
      chatAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    chatAbortControllerRef.current = abortController;

    const currentCharacterId = character.id;

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const response = await fetch('/api/companion/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          characterId: currentCharacterId,
          message: trimmed,
          history: historySnapshot.map(m => ({ sender: m.sender, text: m.text })),
          speakVoice: voiceEnabled,
        }),
        signal: abortController.signal,
      });

      if (!sessionActiveRef.current || abortController.signal.aborted) return;

      if (response.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('token');
          window.dispatchEvent(new Event('almaren-auth-change'));
        }
        router.replace('/login?redirect=/companion');
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!sessionActiveRef.current || abortController.signal.aborted) return;

      const replyText = typeof data.reply === 'string' && data.reply.trim()
        ? data.reply.trim()
        : (currentCharacterId === 'nari'
            ? '收到你的心意啦~ 很高兴此刻能和你在一起。🌸'
            : '嗨！听到你的声音啦，今天也要一起开心哦！✨');

      const compMsg: CompanionChatMessage = {
        id: `c-${Date.now()}`,
        sender: 'companion',
        text: replyText,
      };

      setMessages(prev => [...prev.slice(-49), compMsg]);
      setIsReplying(false);

      // 动作与表情同步联动
      if (data.motion && character.motions.some(m => m.id === data.motion)) {
        setMotionId(data.motion);
        setPlaying(true);
      }
      if (data.expression && typeof data.expression === 'string') {
        setExpressionId(data.expression);
        if (expressionResetTimerRef.current) clearSessionTimeout(expressionResetTimerRef.current);
        expressionResetTimerRef.current = setSessionTimeout(() => {
          setExpressionId('');
        }, 4000);
      }

      // 声音与口型同步
      if (voiceEnabledRef.current) {
        if (typeof data.audioDataUrl === 'string' && data.audioDataUrl) {
          playChatVoice(data.audioDataUrl, compMsg.id);
        } else {
          setChatVoiceNotice({ messageId: compMsg.id });
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (!sessionActiveRef.current) return;

      const fallbackReply = currentCharacterId === 'nari'
        ? '刚才稍微有些走神了呢……你再说一次好不好嘛？🌸'
        : '哎呀，我刚才有点走神啦，能再跟我说一次吗？✨';

      const compMsg: CompanionChatMessage = {
        id: `c-${Date.now()}`,
        sender: 'companion',
        text: fallbackReply,
      };
      setMessages(prev => [...prev.slice(-49), compMsg]);
      setIsReplying(false);
      stage.current?.speak(2200);
      setIsSpeaking(true);
      setSessionTimeout(() => setIsSpeaking(false), 2200);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    sendCompanionMessage(messageText);
  };

  const handleQuickPrompt = (item: typeof quickPrompts[number]) => {
    const targetMotion = character.motions.find(m =>
      m.id.toLowerCase().includes(item.motion) ||
      m.group === '互动' ||
      m.group === '心情'
    );
    sendCompanionMessage(item.userText, targetMotion?.id);
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

  return (
    <main className="companion-page" data-character={character.id}>
      <header className="companion-header" role="banner" aria-label="Almaren 品牌与状态">
        <Link href="/" className="companion-wordmark" title="返回 Almaren 首页">
          <span className="companion-logomark"><Sparkles size={15} /></span>
          <span>Almaren</span>
          <span className="companion-header-divider" />
          <span>陪伴</span>
        </Link>

        <div className="companion-hud-capsules">
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
      </header>

      <div className={`companion-workspace ${panelCollapsed ? 'is-collapsed' : ''}`}>
        <section
          className={`companion-scene ${sceneBg !== 'none' ? `has-custom-bg companion-scene--${sceneBg}` : ''}`}
          aria-label="角色预览"
          onPointerDown={handleScenePointerDown}
          onPointerMove={handleScenePointerMove}
          onPointerUp={handleScenePointerUp}
          onPointerCancel={handleScenePointerUp}
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
            <div className="companion-stage-badge">
              <span className="companion-stage-badge-avatar">{character.name[0]}</span>
              <div className="companion-stage-badge-text">
                <strong>{character.name}</strong>
                <span>{character.id === 'nari' ? '森林少女 · 温暖伴侣' : '深海歌姬 · 蔚蓝治愈'}</span>
              </div>
            </div>
            <div className="companion-stage-desktop-actions">
              <div className="companion-stage-pill-group" role="group" aria-label="场景氛围">
                <button
                  type="button"
                  className={`companion-stage-pill ${sceneBg === 'cherry_room' ? 'is-active' : ''}`}
                  onClick={() => setSceneBg('cherry_room')}
                  title="浪漫花房"
                >
                  🌸 花房
                </button>
                <button
                  type="button"
                  className={`companion-stage-pill ${sceneBg === 'ocean_room' ? 'is-active' : ''}`}
                  onClick={() => setSceneBg('ocean_room')}
                  title="蔚蓝海景"
                >
                  🌊 海景
                </button>
                <button
                  type="button"
                  className={`companion-stage-pill ${sceneBg === 'none' ? 'is-active' : ''}`}
                  onClick={() => setSceneBg('none')}
                  title="极简纯色"
                >
                  🎨 极简
                </button>
              </div>
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
          </div>

          {/* 屏幕悬浮 HUD 标签 (左侧角色切换，右侧视角与动作调节 - 仅移动端显示，纯图标轻量设计) */}
          <div className="companion-floating-hud companion-floating-hud--left">
            <button
              type="button"
              className="companion-stage-chip companion-stage-chip--swap companion-stage-chip--icon"
              onClick={() => setCharMenuOpen(true)}
              title={`切换陪伴角色（当前：${character.name}）`}
              aria-label={`切换陪伴角色，当前：${character.name}`}
            >
              <span className="companion-stage-chip-avatar">{character.name[0]}</span>
              <span className="companion-stage-chip-dot" />
            </button>
          </div>

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
            <button
              type="button"
              className="companion-stage-chip companion-stage-chip--icon companion-stage-chip--sub"
              onClick={() => setPanelCollapsed(false)}
              title="打开伴侣动作与视角调节抽屉"
              aria-label="打开伴侣动作与视角调节抽屉"
            >
              <LayoutGrid size={16} />
            </button>
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
              className="companion-tap-particle"
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
                {character.id === 'yume' ? '🌊 Cora' : character.id === 'nari' ? '☀️ Sunny' : character.name}
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
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`companion-bubble-row companion-bubble-row--${msg.sender}`}
                >
                  <div
                    className={`companion-bubble companion-bubble--${msg.sender} ${msg.isSticker ? 'companion-bubble--sticker' : ''}`}
                    role="status"
                  >
                    <span>{msg.text}</span>
                    {chatVoiceFeedback(msg.id)}
                  </div>
                </div>
              ))}
              {isReplying && (
                <div className="companion-bubble-row companion-bubble-row--companion">
                  <div className="companion-bubble companion-bubble--companion companion-bubble--typing">
                    <span className="companion-typing-dot" />
                    <span className="companion-typing-dot" />
                    <span className="companion-typing-dot" />
                  </div>
                </div>
              )}
            </div>
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
                  {quickPrompts.map(item => (
                  <button
                    key={item.label}
                    type="button"
                    className="companion-quick-chip"
                    onClick={() => handleQuickPrompt(item)}
                    disabled={!usable || isReplying}
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
                  placeholder={isReplying ? `${character.name} 正在认真回复中…` : `和${character.name}聊聊...`}
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  disabled={!usable || isReplying}
                />
              </form>

              {/* 3. 发送按钮 */}
              <button
                type="button"
                className={`companion-dock-btn companion-dock-btn--send ${messageText.trim() && !isReplying ? 'is-ready' : 'is-disabled'}`}
                disabled={!messageText.trim() || !usable || isReplying}
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
                className="companion-console-swap-btn"
                onClick={() => setCharMenuOpen(true)}
                title="切换陪伴角色"
              >
                <span className="companion-console-swap-avatar">{character.name[0]}</span>
                <span>切换角色 ({character.name.split(' ')[0]}) ▾</span>
              </button>
            </div>
          </div>

          {/* 2. 交互 Tab 选项卡 (💬 对话陪伴 vs 🎭 动作姿态) */}
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

          {/* 3. Tab 内容区 */}
          {desktopTab === 'chat' ? (
            <div className="companion-desktop-chat-pane">
              {/* 本地存储与清空工具栏 */}
              <div className="companion-desktop-chat-toolbar">
                <span className="companion-desktop-chat-count">
                  {messages.length} 条对话已本地保存
                </span>
                <button
                  type="button"
                  className="companion-text-button"
                  onClick={handleClearHistory}
                  title="清空对话记录并重置为初始问候"
                >
                  <Trash2 size={12} />
                  <span>清空记录</span>
                </button>
              </div>

              {/* 消息滚动流 */}
              <div className="companion-desktop-chat-stream" ref={desktopChatStreamRef}>
                {messages.map(msg => (
                  <div key={msg.id} className={`companion-bubble-row companion-bubble-row--${msg.sender}`}>
                    <div className={`companion-bubble companion-bubble--${msg.sender} ${msg.isSticker ? 'companion-bubble--sticker' : ''}`}>
                      <span>{msg.text}</span>
                      {chatVoiceFeedback(msg.id)}
                    </div>
                  </div>
                ))}
                {isReplying && (
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
                  {quickPrompts.map(item => (
                    <button
                      key={item.label}
                      type="button"
                      className="companion-quick-chip"
                      onClick={() => handleQuickPrompt(item)}
                      disabled={!usable || isReplying}
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
                    placeholder={isReplying ? `${character.name} 正在认真回复中…` : `和${character.name}聊聊... (按 Enter 发送)`}
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    disabled={!usable || isReplying}
                  />
                  <button
                    type="submit"
                    className={`companion-desktop-send-btn ${messageText.trim() && !isReplying ? 'is-ready' : ''}`}
                    disabled={!messageText.trim() || !usable || isReplying}
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

        {/* 抽屉毛玻璃遮罩 (Drawer Backdrop) */}
        {!panelCollapsed && (
          <div
            className="companion-drawer-backdrop"
            onClick={() => setPanelCollapsed(true)}
            aria-hidden="true"
          />
        )}

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

          <section className="companion-control-section">
            <div className="companion-section-heading">
              <h3>场景氛围</h3>
              <span>实景环境</span>
            </div>
            <div className="companion-framing-switch" role="group" aria-label="场景氛围切换">
              <button
                type="button"
                aria-pressed={sceneBg === 'cherry_room'}
                onClick={() => setSceneBg('cherry_room')}
              >
                🌸 浪漫花房
              </button>
              <button
                type="button"
                aria-pressed={sceneBg === 'ocean_room'}
                onClick={() => setSceneBg('ocean_room')}
              >
                🌊 蔚蓝海景
              </button>
              <button
                type="button"
                aria-pressed={sceneBg === 'none'}
                onClick={() => setSceneBg('none')}
              >
                🎨 极简纯色
              </button>
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

          <section className="companion-control-section">
            <div className="companion-section-heading">
              <h3>对话与本地缓存</h3>
              <span>{messages.length} 条已保存</span>
            </div>
            <button
              type="button"
              className="companion-reset-button"
              onClick={handleClearHistory}
              title="清空对话记录并重置为初始问候"
            >
              <Trash2 size={14} />清空本角色对话记录
            </button>
          </section>

          <div className="companion-preview-note"><span>角色与动作预览</span><p>心动日常，温暖相伴。随时畅聊倾诉。</p><small>{ready ? `${snapshot.meshes} 个网格 · ${snapshot.fps || '—'} FPS · 本地存储已启用` : '本地资源加载中'}</small></div>
        </aside>

        {/* 角色切换选择器弹窗 (适用于移动端与桌面端) */}
        {charMenuOpen && (
          <div className="companion-char-picker-backdrop" onClick={() => setCharMenuOpen(false)}>
            <div className="companion-char-picker-card" onClick={e => e.stopPropagation()}>
              <div className="companion-char-picker-header">
                <h4>选择陪伴角色</h4>
                <button
                  type="button"
                  className="companion-char-picker-close"
                  onClick={() => setCharMenuOpen(false)}
                  aria-label="关闭"
                >
                  ✕
                </button>
              </div>
              <div className="companion-char-picker-grid">
                {companionCharacters.map(c => {
                  const isCurrent = c.id === character.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`companion-char-card ${isCurrent ? 'is-active' : ''}`}
                      onClick={() => {
                        setCharMenuOpen(false);
                        if (c.id !== character.id) {
                          onCharacterChange(c.id);
                        }
                      }}
                    >
                      <div className="companion-char-card-avatar">
                        <span>{c.name[0]}</span>
                        {isCurrent && <span className="companion-char-card-badge">当前</span>}
                      </div>
                      <div className="companion-char-card-body">
                        <div className="companion-char-card-name-row">
                          <span className="companion-char-card-name">{c.name}</span>
                          <span className="companion-char-card-engine">
                            {c.engine === 'cubism' ? 'Live2D' : 'Koro 2D'}
                          </span>
                        </div>
                        <p className="companion-char-card-desc">{c.title ?? c.name}</p>
                        <div className="companion-char-card-meta">
                          <span>动作 {c.motions.length} 种</span>
                          {c.expressions.length > 0 && <span> · 表情 {c.expressions.length} 款</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
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
                    <p className="companion-settings-subtitle">个性化您的陪伴体验与本地数据偏好</p>
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
                {/* 1. 声音与朗读设置 */}
                <div className="companion-settings-group">
                  <h5 className="companion-settings-group-title">声音与语音</h5>

                  <div className="companion-setting-row">
                    <div className="companion-setting-info">
                      <div className="companion-setting-label-wrap">
                        <span className="companion-setting-label">伴侣对话语音朗读</span>
                        <span className={`companion-setting-badge ${voiceEnabled ? 'is-active' : 'is-muted'}`}>
                          {voiceEnabled ? '已开启' : '已静音'}
                        </span>
                      </div>
                      <p className="companion-setting-desc">
                        开启后，全部伴侣角色回复时由专属 AI 配音朗读；关闭时全体角色全局静音，仅保留文字气泡与轻柔口型，免去 TTS 等待并节省流量。
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
                        控制全部伴侣角色在点击触摸或拖拽时的互动音效与娇嗔语音反馈。
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

                {/* 2. 拟真动效与交互表现 */}
                <div className="companion-settings-group">
                  <h5 className="companion-settings-group-title">拟真表现与交互</h5>

                  <div className="companion-setting-row">
                    <div className="companion-setting-info">
                      <div className="companion-setting-label-wrap">
                        <span className="companion-setting-label">目光与视线跟随</span>
                        <span className={`companion-setting-badge ${lookAt ? 'is-active' : 'is-muted'}`}>
                          {lookAt ? '开启' : '关闭'}
                        </span>
                      </div>
                      <p className="companion-setting-desc">
                        伴侣眼神与头部自然跟随光标或触控点移动。
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`companion-switch ${lookAt ? 'is-on' : ''}`}
                      onClick={() => setLookAt(v => !v)}
                      role="switch"
                      aria-checked={lookAt}
                      aria-label="切换视线跟随"
                    >
                      <span className="companion-switch-thumb" />
                    </button>
                  </div>

                  <div className="companion-setting-row">
                    <div className="companion-setting-info">
                      <div className="companion-setting-label-wrap">
                        <span className="companion-setting-label">待机微动作巡航</span>
                        <span className={`companion-setting-badge ${autoIdle ? 'is-active' : 'is-muted'}`}>
                          {autoIdle ? '开启' : '关闭'}
                        </span>
                      </div>
                      <p className="companion-setting-desc">
                        空闲无交互时自动切换呼吸与自然待机微动作，保持生动感。
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`companion-switch ${autoIdle ? 'is-on' : ''}`}
                      onClick={() => setAutoIdle(v => !v)}
                      role="switch"
                      aria-checked={autoIdle}
                      aria-label="切换待机微动作巡航"
                    >
                      <span className="companion-switch-thumb" />
                    </button>
                  </div>

                  <div className="companion-setting-row">
                    <div className="companion-setting-info">
                      <div className="companion-setting-label-wrap">
                        <span className="companion-setting-label">自然自主眨眼</span>
                        <span className={`companion-setting-badge ${autoBlink ? 'is-active' : 'is-muted'}`}>
                          {autoBlink ? '开启' : '关闭'}
                        </span>
                      </div>
                      <p className="companion-setting-desc">
                        伴侣双眼周期性自然眨动。
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`companion-switch ${autoBlink ? 'is-on' : ''}`}
                      onClick={() => setAutoBlink(v => !v)}
                      role="switch"
                      aria-checked={autoBlink}
                      aria-label="切换自然自主眨眼"
                    >
                      <span className="companion-switch-thumb" />
                    </button>
                  </div>
                </div>

                {/* 3. 存储与隐私（本地缓存） */}
                <div className="companion-settings-group">
                  <h5 className="companion-settings-group-title">数据存储与隐私</h5>
                  <div className="companion-setting-storage-card">
                    <div className="companion-setting-storage-header">
                      <strong>浏览器本地缓存 (localStorage)</strong>
                      <p>
                        当前角色 ({character.name}) 记录：共 {messages.length} 条。所有聊天数据仅保存在当前浏览器的本地存储中，断网可用，不会上报服务器，充分保护个人隐私。
                      </p>
                    </div>
                    <div className="companion-setting-storage-actions">
                      <button
                        type="button"
                        className="companion-setting-danger-btn"
                        onClick={handleClearHistory}
                      >
                        <Trash2 size={14} />
                        <span>清空当前伴侣本地记录</span>
                      </button>
                      <button
                        type="button"
                        className="companion-setting-secondary-btn"
                        onClick={() => {
                          if (typeof window !== 'undefined') {
                            const ok = window.confirm('确定要清空全部角色的本地对话记录吗？清空后无法找回。');
                            if (!ok) return;
                            try {
                              companionCharacters.forEach(c => {
                                localStorage.removeItem(`${COMPANION_STORAGE_PREFIX}${c.id}`);
                              });
                            } catch {}
                            setMessages(getDefaultMessages(character.id));
                          }
                        }}
                      >
                        <span>清空全部角色本地记录</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* 4. 模型与系统配置 */}
                <div className="companion-settings-group">
                  <h5 className="companion-settings-group-title">模型与系统配置</h5>
                  <div className="companion-setting-link-card">
                    <div className="companion-setting-link-text">
                      <strong>大模型与 API 配置</strong>
                      <p>伴侣对话直接使用您在系统设置中保存的专属 LLM API Key、端点及模型类型。</p>
                    </div>
                    <Link
                      href="/settings"
                      className="companion-setting-link-btn"
                      onClick={() => setSettingsOpen(false)}
                    >
                      前往配置
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
