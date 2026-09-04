'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bell, Check, CheckSquare, ChevronDown, ChevronUp, Clock, Cpu, Globe2, History, Loader2, Menu, MessageCircleHeart, PanelRightClose, Pin, Plus, Send, Settings2, Sparkles, Square, Trash2, X } from 'lucide-react';
import ComposerShell from '@/components/chat/ComposerShell';
import MessageBubbleFrame from '@/components/chat/MessageBubbleFrame';
import MessageContent from '@/components/chat/MessageContent';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { assistant, type AssistantPageContext } from '@/lib/api';
import { completeBrowserModel, readBrowserModelConfigForScope, streamBrowserModel } from '@/lib/browser-model';
import { cn } from '@/lib/utils';
import type { AssistantConversationSummary, AssistantReminder, AssistantReminderCandidate, Message, PersonalAssistantBootstrap } from '@/types';

const HIDDEN_PATHS = ['/login'];

function inferPageContext(pathname: string): AssistantPageContext | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'spaces' && parts[1]) return { type: 'space', spaceId: parts[1] };
  if (parts[0] === 'conversations' && parts[1]) return { type: 'conversation', conversationId: parts[1] };
  if ((parts[0] === 'agents' || parts[0] === 'chat') && parts[1]) return { type: 'agent', agentId: parts[1] };
  return null;
}

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}

function isProactive(val: unknown): boolean {
  if (val === false || val === 0 || val === '0' || val === 'false') return false;
  return true;
}

function playGentleReminderChime() {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // 温和自然的三度大调和弦轻音：E5, G#5, B5
    const notes = [659.25, 830.61, 987.77];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0, now + idx * 0.14);
      gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.14 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 1.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 1.3);
    });
  } catch {}
}

function formatReminderDue(dueTimeStr: string | null) {
  if (!dueTimeStr) return '随手便签';
  const due = new Date(dueTimeStr);
  const now = new Date();
  const isToday = due.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000);
  const isTomorrow = due.toDateString() === tomorrow.toDateString();
  const timeStr = `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`;
  if (isToday) return `今天 ${timeStr}`;
  if (isTomorrow) return `明天 ${timeStr}`;
  return `${due.getMonth() + 1}/${due.getDate()} ${timeStr}`;
}

function AssistantLauncher({
  open,
  onClick,
  proactiveGreeting,
  proactiveGreetingCollapsed = false,
  onDismissGreeting,
  onAcceptGreeting,
  proactiveEnabled = true,
  activeReminderAlert,
  onCompleteReminder,
  onSnoozeReminder,
  onDismissReminderAlert,
  pendingCount = 0,
}: {
  open: boolean;
  onClick: () => void;
  proactiveGreeting?: { deliveryId: string; text: string; name?: string; avatar?: string } | null;
  proactiveGreetingCollapsed?: boolean;
  onDismissGreeting?: () => void;
  onAcceptGreeting?: (text: string, deliveryId: string) => void;
  proactiveEnabled?: boolean;
  activeReminderAlert?: AssistantReminder | null;
  onCompleteReminder?: (id: string) => void;
  onSnoozeReminder?: (id: string) => void;
  onDismissReminderAlert?: () => void;
  pendingCount?: number;
}) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return (
    <div
      style={{
        bottom: mobile ? 'calc(80px + env(safe-area-inset-bottom, 0px))' : '24px',
        position: 'fixed',
        right: mobile ? '16px' : '24px',
        zIndex: 65,
      }}
      className={cn('fixed right-4 z-[65] md:right-6', open && 'pointer-events-none scale-90 opacity-0')}
    >
      {/* 待办闹钟专属微光弹窗（优先级最高） */}
      {activeReminderAlert ? (
        <div
          role="alert"
          aria-live="assertive"
          className="absolute bottom-14 right-0 w-76 rounded-2xl border border-orange-300 bg-white/98 p-3.5 shadow-2xl backdrop-blur-md transition animate-in fade-in slide-in-from-bottom-2 duration-300 text-left z-10 cursor-default"
        >
          <div className="flex items-center justify-between gap-1.5 pb-1 text-[11px] font-black text-orange-950">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
              </span>
              <span>⏰ 小伴提醒到啦</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismissReminderAlert?.();
              }}
              aria-label="关闭提醒"
              className="flex h-5 w-5 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer transition"
            >
              <X size={12} />
            </button>
          </div>
          <p className="mt-1 text-xs font-black leading-5 text-slate-900">
            {activeReminderAlert.content}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onCompleteReminder?.(activeReminderAlert.id)}
              className="flex-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-black text-white hover:bg-emerald-700 transition active:scale-95 cursor-pointer text-center"
            >
              ✓ 知道了 / 完成
            </button>
            <button
              type="button"
              onClick={() => onSnoozeReminder?.(activeReminderAlert.id)}
              className="rounded-lg border border-black/10 bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200 transition active:scale-95 cursor-pointer text-center"
            >
              💤 延后10分钟
            </button>
          </div>
          <div className="absolute -bottom-1.5 right-4 h-3 w-3 rotate-45 border-b border-r border-orange-300 bg-white" />
        </div>
      ) : proactiveGreeting && !proactiveGreetingCollapsed ? (
        /* 柔和微光的主动关怀悬浮气泡 */
        <div
          role="status"
          aria-live="polite"
          onClick={() => onAcceptGreeting?.(proactiveGreeting.text, proactiveGreeting.deliveryId)}
          className="absolute bottom-14 right-0 w-72 rounded-2xl border border-amber-200/90 bg-white/95 p-3.5 shadow-xl backdrop-blur-md transition animate-in fade-in slide-in-from-bottom-2 duration-300 text-left cursor-pointer group hover:border-amber-300"
        >
          <div className="flex items-center justify-between gap-1.5 pb-1 text-[11px] font-black text-amber-900">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span>{proactiveGreeting.name || '小伴'} · 轻声问候</span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismissGreeting?.();
              }}
              aria-label="关闭问候"
              className="flex h-5 w-5 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer transition"
            >
              <X size={12} />
            </button>
          </div>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-800">
            {proactiveGreeting.text}
          </p>
          <div className="mt-2.5 flex items-center justify-between text-[10px] font-bold text-slate-400">
            <span className="text-amber-800/80 group-hover:text-amber-950 transition flex items-center gap-1">
              点击与小伴聊聊 →
            </span>
            <span className="text-slate-300">8s 后自动收起</span>
          </div>
          {/* 小气泡尖角 */}
          <div className="absolute -bottom-1.5 right-4 h-3 w-3 rotate-45 border-b border-r border-amber-200/90 bg-white" />
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          if (proactiveGreeting && proactiveGreetingCollapsed && !activeReminderAlert) {
            onAcceptGreeting?.(proactiveGreeting.text, proactiveGreeting.deliveryId);
            return;
          }
          onClick();
        }}
        aria-label="打开个人助理"
        title={activeReminderAlert
          ? `⏰ 提醒：${activeReminderAlert.content}`
          : proactiveGreeting && proactiveGreetingCollapsed
            ? '有一条未读问候'
            : proactiveEnabled ? '小伴在线陪伴中' : '小伴待命中'}
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-full border bg-white text-slate-700 shadow-lg transition hover:-translate-y-0.5 hover:text-slate-950 cursor-pointer',
          activeReminderAlert ? 'border-orange-400 ring-4 ring-orange-200 animate-bounce' : 'border-black/10'
        )}
      >
        <div className="relative flex items-center justify-center">
          {activeReminderAlert ? (
            <Bell size={21} className="text-orange-600 animate-pulse" />
          ) : (
            <MessageCircleHeart size={21} />
          )}
          {activeReminderAlert ? (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-orange-500" />
            </span>
          ) : proactiveGreeting && proactiveGreetingCollapsed ? (
            <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-amber-500 px-1 text-[10px] font-black text-white shadow-sm">
              1
            </span>
          ) : pendingCount > 0 ? (
            <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-black text-white shadow-xs">
              {pendingCount}
            </span>
          ) : proactiveEnabled ? (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
            </span>
          ) : null}
        </div>
      </button>
    </div>
  );
}

export default function PersonalAssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PersonalAssistantBootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [webEnabled, setWebEnabled] = useState(false);
  const [sharePage, setSharePage] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [conversations, setConversations] = useState<AssistantConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [busyConversationId, setBusyConversationId] = useState<string | null>(null);
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<AssistantConversationSummary | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [bubbleSuggestions, setBubbleSuggestions] = useState<Record<string, Array<{ content: string; category: string }>>>({});
  const [savedTips, setSavedTips] = useState<Record<string, string>>({});
  const [topicSummaryModal, setTopicSummaryModal] = useState<{
    suggestions: Array<{ content: string; category: string }>;
    selected: Set<number>;
  } | null>(null);
  const [extractingSummary, setExtractingSummary] = useState(false);
  const [confirmClearAssistantOpen, setConfirmClearAssistantOpen] = useState(false);
  const [clearingAssistantMessages, setClearingAssistantMessages] = useState(false);

  const handleClearAssistantMessages = async () => {
    setClearingAssistantMessages(true);
    try {
      await assistant.clearMessages();
      setData((prev) => (prev ? { ...prev, messages: [] } : prev));
      setConfirmClearAssistantOpen(false);
    } catch (e) {
      console.error('Failed to clear assistant messages:', e);
    } finally {
      setClearingAssistantMessages(false);
    }
  };
  const [proactiveGreeting, setProactiveGreeting] = useState<{ deliveryId: string; text: string; name?: string; avatar?: string } | null>(null);
  const [proactiveGreetingCollapsed, setProactiveGreetingCollapsed] = useState(false);
  const [localProactive, setLocalProactive] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') return null;
    const saved = localStorage.getItem('almaren_assistant_proactive_enabled');
    if (saved === 'false' || saved === '0') return false;
    if (saved === 'true' || saved === '1') return true;
    return null;
  });
  const [toolsOpen, setToolsOpen] = useState(false);
  const [reminders, setReminders] = useState<AssistantReminder[]>([]);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [activeReminderAlert, setActiveReminderAlert] = useState<AssistantReminder | null>(null);
  const [remindToast, setRemindToast] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [pendingReminderCandidates, setPendingReminderCandidates] = useState<AssistantReminderCandidate[] | null>(null);
  const [creatingReminderCandidates, setCreatingReminderCandidates] = useState(false);
  const [localModelActive, setLocalModelActive] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const pageContext = useMemo(() => inferPageContext(pathname), [pathname]);
  const hidden = HIDDEN_PATHS.some((path) => pathname.startsWith(path));

  useEffect(() => {
    if (!open) return;
    const local = readBrowserModelConfigForScope('GLOBAL').source === 'OLLAMA';
    setLocalModelActive(local);
    if (local) setWebEnabled(false);
  }, [data?.conversationId, open]);

  useEffect(() => {
    if (!toolsOpen) return;
    const close = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [toolsOpen]);

  useEffect(() => {
    setLoggedIn(Boolean(localStorage.getItem('token')));
  }, [pathname]);
  useEffect(() => {
    const invalidate = () => {
      failedAtRef.current = 0;
      setData(null);
    };
    const handleOpen = () => setOpen(true);
    window.addEventListener('personal-assistant-updated', invalidate);
    window.addEventListener('open-personal-assistant', handleOpen);
    return () => {
      window.removeEventListener('personal-assistant-updated', invalidate);
      window.removeEventListener('open-personal-assistant', handleOpen);
    };
  }, []);
  useEffect(() => {
    const onProactiveChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled: boolean }>;
      if (typeof customEvent.detail?.enabled === 'boolean') {
        const val = customEvent.detail.enabled;
        setLocalProactive(val);
        setData((current) => current ? {
          ...current,
          profile: { ...current.profile, proactiveEnabled: val },
        } : current);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'almaren_assistant_proactive_enabled' && event.newValue) {
        const val = event.newValue === 'true' || event.newValue === '1';
        setLocalProactive(val);
        setData((current) => current ? {
          ...current,
          profile: { ...current.profile, proactiveEnabled: val },
        } : current);
      }
    };
    window.addEventListener('personal-assistant-proactive-changed', onProactiveChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('personal-assistant-proactive-changed', onProactiveChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const loadingRef = useRef(false);
  const failedAtRef = useRef(0);

  const load = useCallback(async () => {
    if (typeof window === 'undefined' || !localStorage.getItem('token') || data || loadingRef.current) return;
    // 防御死循环重试：若上一次请求失败，10 秒内禁止静默重发
    if (Date.now() - failedAtRef.current < 10000) return;

    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const res = await assistant.get();
      setData(res);
      if (res?.reminders) setReminders(res.reminders);
      const isEnabled = isProactive(res?.profile?.proactiveEnabled);
      setLocalProactive(isEnabled);
      localStorage.setItem('almaren_assistant_proactive_enabled', String(isEnabled));
      failedAtRef.current = 0;
    } catch (err: any) {
      failedAtRef.current = Date.now();
      if (err.message !== 'Unauthorized') setError(err.message || '助理加载失败');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    if (loggedIn && !hidden) load();
    else if (open) load();
  }, [loggedIn, hidden, open, pathname, load]);

  // 定时提醒巡检调度器：每 6 秒检查是否有到期的待办事项
  useEffect(() => {
    if (!loggedIn || hidden) return;

    const checkReminders = () => {
      const now = Date.now();
      const due = reminders.find((r) => {
        if (r.status !== 'PENDING' || !r.dueTime) return false;
        const dueTimestamp = new Date(r.dueTime).getTime();
        return dueTimestamp <= now;
      });

      if (due) {
        const alertKey = `almaren_alerted_${due.id}`;
        const lastAlert = parseInt(localStorage.getItem(alertKey) || '0', 10);
        // 若此提醒在 10 分钟内已经响过，则暂缓避免重复响铃
        if (now - lastAlert > 10 * 60 * 1000) {
          localStorage.setItem(alertKey, String(now));
          playGentleReminderChime();
          setActiveReminderAlert(due);
        }
      }
    };

    checkReminders();
    const timer = setInterval(checkReminders, 6000);
    return () => clearInterval(timer);
  }, [loggedIn, hidden, reminders]);

  const handleToggleReminder = async (item: AssistantReminder) => {
    const nextStatus = item.status === 'PENDING' ? 'COMPLETED' : 'PENDING';
    setReminders((prev) => prev.map((r) => r.id === item.id ? { ...r, status: nextStatus } : r));
    try {
      await assistant.updateReminder({ id: item.id, status: nextStatus });
    } catch (err: any) {
      setError(err.message || '更新待办失败');
    }
  };

  const handleDeleteReminder = async (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    if (activeReminderAlert?.id === id) setActiveReminderAlert(null);
    try {
      await assistant.deleteReminder(id);
    } catch (err: any) {
      setError(err.message || '删除待办失败');
    }
  };

  const handleCreateManualNote = async () => {
    const text = newNoteText.trim();
    if (!text || addingNote) return;
    setAddingNote(true);
    try {
      const res = await assistant.createReminder({ content: text });
      setReminders((prev) => [res.reminder, ...prev]);
      setNewNoteText('');
      setRemindToast(`便签已保存：「${res.reminder.content}」📌`);
      setTimeout(() => setRemindToast(null), 4000);
    } catch (err: any) {
      setError(err.message || '创建便签失败');
    } finally {
      setAddingNote(false);
    }
  };

  const handleSnoozeReminder = async (id: string, minutes = 10) => {
    setActiveReminderAlert(null);
    try {
      const res = await assistant.updateReminder({ id, snoozeMinutes: minutes });
      setReminders((prev) => prev.map((r) => r.id === id ? res.reminder : r));
      setRemindToast(`已为你推迟 ${minutes} 分钟后再提醒 ⏰`);
      setTimeout(() => setRemindToast(null), 3500);
    } catch (err: any) {
      setError(err.message || '推迟提醒失败');
    }
  };

  const handleCompleteReminderAlert = async (id: string) => {
    setActiveReminderAlert(null);
    setReminders((prev) => prev.map((r) => r.id === id ? { ...r, status: 'COMPLETED' } : r));
    try {
      await assistant.updateReminder({ id, status: 'COMPLETED' });
      setRemindToast('太棒了，又完成了一项待办！✨');
      setTimeout(() => setRemindToast(null), 3500);
    } catch (err: any) {
      setError(err.message || '完成提醒失败');
    }
  };
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [data?.messages, streaming, open]);
  useEffect(() => {
    if (!pageContext) setSharePage(false);
  }, [pageContext]);

  // 在线主动关怀：仅当用户打开网页在前台、未展开抽屉且冷却满足时感应（动态 4-6 次/天，75分钟冷却）
  useEffect(() => {
    if (!loggedIn || open || hidden || proactiveGreeting) return;

    const checkProactive = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      const PROACTIVE_KEY = 'almaren_assistant_last_proactive';
      const PROACTIVE_DATE_KEY = 'almaren_assistant_proactive_date';
      const now = Date.now();
      const todayStr = new Date().toDateString();
      const savedDate = localStorage.getItem(PROACTIVE_DATE_KEY);
      let count = 0;
      if (savedDate === todayStr) {
        count = parseInt(localStorage.getItem(PROACTIVE_KEY + '_count') || '0', 10);
      }
      const lastTime = parseInt(localStorage.getItem(PROACTIVE_KEY) || '0', 10);
      const allowNew = count < 5 && now - lastTime >= 75 * 60 * 1000;

      try {
        const modelSource = readBrowserModelConfigForScope('GLOBAL').source;
        const res = await assistant.getProactiveGreeting(modelSource, allowNew);
        if (res.shouldGreet && res.deliveryId && res.greeting) {
          setProactiveGreeting({
            deliveryId: res.deliveryId,
            text: res.greeting,
            name: res.assistantName,
            avatar: res.assistantAvatar,
          });
          setProactiveGreetingCollapsed(false);
          if (!res.recovered) {
            localStorage.setItem(PROACTIVE_KEY, String(now));
            localStorage.setItem(PROACTIVE_DATE_KEY, todayStr);
            localStorage.setItem(PROACTIVE_KEY + '_count', String(count + 1));
          }
        }
      } catch {
        // Silently fail
      }
    };

    const initialTimer = setTimeout(checkProactive, 3200);
    const intervalTimer = setInterval(checkProactive, 180000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [loggedIn, open, hidden, data?.conversationId, proactiveGreeting]);

  // 问候气泡 8 秒后收起为未读标记，直到用户打开或明确关闭
  useEffect(() => {
    if (!proactiveGreeting) return;
    const timer = setTimeout(() => {
      setProactiveGreetingCollapsed(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [proactiveGreeting]);

  const handleAcceptGreeting = async (greetingText?: string, deliveryId?: string) => {
    setProactiveGreeting(null);
    setProactiveGreetingCollapsed(false);
    setOpen(true);
    if (!greetingText || !deliveryId) return;

    // 检查是否已有重复项，并先在前端呈现这条问候消息
    const now = new Date().toISOString();
    const tempId = `greeting-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      conversationId: data?.conversationId || 'current',
      role: 'assistant',
      content: greetingText,
      createdAt: now,
    };

    setData((prev) => {
      if (!prev) return prev;
      const lastMsg = prev.messages[prev.messages.length - 1];
      if (lastMsg?.content === greetingText && lastMsg.role === 'assistant') {
        return prev;
      }
      return {
        ...prev,
        messages: [...prev.messages, optimisticMessage],
      };
    });

    try {
      const res = await assistant.acceptProactiveGreeting(deliveryId);
      if (res?.message) {
        setData((prev) => prev ? {
          ...prev,
          messages: prev.messages.map((m) => m.id === tempId ? res.message : m),
        } : prev);
      }
    } catch {
      // 保留前端乐观展示
    }
  };

  const toggleProactive = async () => {
    const currentVal = localProactive !== null ? localProactive : isProactive(data?.profile.proactiveEnabled);
    const nextVal = !currentVal;
    setLocalProactive(nextVal);
    localStorage.setItem('almaren_assistant_proactive_enabled', String(nextVal));
    window.dispatchEvent(new CustomEvent('personal-assistant-proactive-changed', { detail: { enabled: nextVal } }));

    if (data) {
      setData((current) => current ? {
        ...current,
        profile: {
          ...current.profile,
          proactiveEnabled: nextVal,
        },
      } : current);
    }
    try {
      const res = await assistant.updateProfile({ proactiveEnabled: nextVal });
      if (res?.profile) {
        const confirmedVal = isProactive(res.profile.proactiveEnabled);
        setLocalProactive(confirmedVal);
        localStorage.setItem('almaren_assistant_proactive_enabled', String(confirmedVal));
        setData((current) => current ? {
          ...current,
          profile: {
            ...current.profile,
            proactiveEnabled: confirmedVal,
          },
        } : current);
      }
    } catch (err: any) {
      setLocalProactive(currentVal);
      localStorage.setItem('almaren_assistant_proactive_enabled', String(currentVal));
      setData((current) => current ? {
        ...current,
        profile: {
          ...current.profile,
          proactiveEnabled: currentVal,
        },
      } : current);
      setError(err.message || '更新在线陪伴状态失败');
    }
  };

  const handleDismissGreeting = async () => {
    const delivery = proactiveGreeting;
    setProactiveGreeting(null);
    setProactiveGreetingCollapsed(false);
    if (!delivery) return;
    try {
      await assistant.dismissProactiveGreeting(delivery.deliveryId);
    } catch {
      // The unread delivery will be recovered on the next page load if dismissal was not saved.
    }
  };

  const createReminderCandidates = async (candidates: AssistantReminderCandidate[]) => {
    if (!candidates.length || creatingReminderCandidates) return;
    setCreatingReminderCandidates(true);
    try {
      const created = await assistant.createReminders(candidates);
      const newItems = created.reminders;
      const newIds = new Set(newItems.map((item) => item.id));
      setReminders((current) => [...newItems, ...current.filter((item) => !newIds.has(item.id))]);
      setPendingReminderCandidates(null);
      setRemindToast(newItems.length === 1
        ? `小伴已记下待办：「${newItems[0].content}」⏰`
        : `小伴已为你记下 ${newItems.length} 项日程待办 ⏰`);
      setTimeout(() => setRemindToast(null), 4500);
    } catch (err: any) {
      setError(err.message || '创建提醒失败');
    } finally {
      setCreatingReminderCandidates(false);
    }
  };

  const extractMemoriesWithCurrentModel = async (payload: {
    mode: 'single' | 'conversation';
    userMessage?: string;
    assistantMessage?: string;
    conversationId?: string;
  }) => {
    const modelConfig = readBrowserModelConfigForScope('GLOBAL');
    if (modelConfig.source !== 'OLLAMA') return assistant.extractMemories(payload);

    const prepared = await assistant.extractMemories({ ...payload, localOnly: true });
    if (!prepared.modelMessages?.length) return prepared;
    const localResponse = await completeBrowserModel({ config: modelConfig, messages: prepared.modelMessages });
    return assistant.extractMemories({ ...payload, localResponse });
  };

  const parseReminderWithCurrentModel = async (userMessage: string) => {
    const modelConfig = readBrowserModelConfigForScope('GLOBAL');
    if (modelConfig.source !== 'OLLAMA') return assistant.parseReminder({ userMessage });

    const prepared = await assistant.parseReminder({ userMessage, localOnly: true });
    if (!prepared.modelMessages?.length) return prepared;
    const localResponse = await completeBrowserModel({ config: modelConfig, messages: prepared.modelMessages });
    return assistant.parseReminder({ userMessage, localResponse });
  };

  const send = async () => {
    const content = input.trim();
    if (!content || streaming || !data) return;
    const now = new Date().toISOString();
    const userMessage: Message = { id: `local-user-${Date.now()}`, conversationId: data.conversationId, role: 'user', content, createdAt: now };
    const assistantMessage: Message = { id: `local-assistant-${Date.now()}`, conversationId: data.conversationId, role: 'assistant', content: '', createdAt: now };
    setData({ ...data, messages: [...data.messages, userMessage, assistantMessage] });
    setInput('');
    setError('');
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const modelConfig = readBrowserModelConfigForScope('GLOBAL');
      const usesLocalModel = modelConfig.source === 'OLLAMA';
      setLocalModelActive(usesLocalModel);
      if (usesLocalModel && webEnabled) throw new Error('浏览器直连 Ollama 时不能使用服务端联网搜索');

      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let localConversationId = '';
      if (usesLocalModel) {
        const prepared = await assistant.prepareLocalMessage({
          message: content,
          sharePage,
          pageContext,
          signal: controller.signal,
        });
        localConversationId = prepared.conversationId;
        const stream = await streamBrowserModel({
          config: modelConfig,
          messages: prepared.messages,
          signal: controller.signal,
        });
        reader = stream.getReader();
      } else {
        const response = await assistant.sendMessage({ message: content, webSearchEnabled: webEnabled, sharePage, pageContext, signal: controller.signal });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        reader = response.body?.getReader();
      }
      const decoder = new TextDecoder();
      if (!reader) throw new Error('模型没有返回内容');
      let answer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setData((current) => current ? {
          ...current,
          messages: current.messages.map((message) => message.id === assistantMessage.id ? { ...message, content: answer } : message),
        } : current);
      }

      if (usesLocalModel) {
        if (!answer.trim()) throw new Error('Ollama 没有返回可展示的正文');
        await assistant.persistLocalMessage(localConversationId, answer);
      }

      // 方案 A：流式结束后异步轻量提取长期记忆建议
      if (content.length >= 3 && answer) {
        extractMemoriesWithCurrentModel({
          mode: 'single',
          userMessage: content,
          assistantMessage: answer,
        }).then((extractRes) => {
          if (extractRes?.suggestions && extractRes.suggestions.length > 0) {
            setBubbleSuggestions((prev) => ({
              ...prev,
              [assistantMessage.id]: extractRes.suggestions,
            }));
          }
        }).catch(() => {});
      }

      // 自然语言待办提醒与多日程智能识别
      if (content.length >= 2) {
        parseReminderWithCurrentModel(content).then((remRes) => {
          const candidates = remRes?.candidates || [];
          if (remRes?.hasReminder && candidates.length > 0) {
            if (remRes.explicit) createReminderCandidates(candidates);
            else setPendingReminderCandidates(candidates);
          }
        }).catch(() => {});
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message || '发送失败');
      setData((current) => current ? { ...current, messages: current.messages.filter((message) => message.id !== assistantMessage.id || message.content) } : current);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const acceptBubbleSuggestion = async (msgId: string, sug: { content: string; category: string }, index: number) => {
    try {
      await assistant.addMemory({ content: sug.content, category: sug.category });
      window.dispatchEvent(new Event('personal-assistant-updated'));
      setBubbleSuggestions((prev) => {
        const next = { ...prev };
        const list = (next[msgId] || []).filter((_, i) => i !== index);
        if (list.length === 0) delete next[msgId];
        else next[msgId] = list;
        return next;
      });
      setSavedTips((prev) => ({ ...prev, [msgId]: `小伴已记下：“${sug.content}”` }));
      setTimeout(() => {
        setSavedTips((prev) => {
          const next = { ...prev };
          delete next[msgId];
          return next;
        });
      }, 3500);
    } catch (err: any) {
      setError(err.message || '存入记忆失败');
    }
  };

  const dismissBubbleSuggestion = (msgId: string, index: number) => {
    setBubbleSuggestions((prev) => {
      const next = { ...prev };
      const list = (next[msgId] || []).filter((_, i) => i !== index);
      if (list.length === 0) delete next[msgId];
      else next[msgId] = list;
      return next;
    });
  };

  const handleNewConversation = async (title?: string) => {
    if (streaming) abortRef.current?.abort();
    setError('');
    setBusyConversationId('new');
    try {
      const res = await assistant.newConversation(title);
      setData((current) => current ? { ...current, conversationId: res.conversationId, messages: [] } : current);
      setView('chat');
    } catch (err: any) {
      setError(err.message || '创建新话题失败');
    } finally {
      setBusyConversationId(null);
    }
  };

  const onRequestNewConversation = async (title?: string) => {
    if (!data) return;
    if (streaming) abortRef.current?.abort();

    // 消息少于 2 条直接重开，不弹出打扰
    if (data.messages.length < 2) {
      handleNewConversation(title);
      return;
    }

    setExtractingSummary(true);
    try {
      const res = await extractMemoriesWithCurrentModel({
        mode: 'conversation',
        conversationId: data.conversationId,
      });
      if (res?.suggestions && res.suggestions.length > 0) {
        setTopicSummaryModal({
          suggestions: res.suggestions,
          selected: new Set(res.suggestions.map((_, i) => i)),
        });
      } else {
        handleNewConversation(title);
      }
    } catch {
      handleNewConversation(title);
    } finally {
      setExtractingSummary(false);
    }
  };

  const commitSummaryAndNewTopic = async () => {
    if (topicSummaryModal && topicSummaryModal.selected.size > 0) {
      const toSave = topicSummaryModal.suggestions.filter((_, i) => topicSummaryModal.selected.has(i));
      await Promise.allSettled(
        toSave.map((item) => assistant.addMemory({ content: item.content, category: item.category }))
      );
      window.dispatchEvent(new Event('personal-assistant-updated'));
    }
    setTopicSummaryModal(null);
    handleNewConversation();
  };

  const openHistory = async () => {
    setView('history');
    setLoadingConversations(true);
    setError('');
    try {
      const res = await assistant.listConversations();
      setConversations(res.conversations);
    } catch (err: any) {
      setError(err.message || '加载历史话题失败');
    } finally {
      setLoadingConversations(false);
    }
  };

  const handleSwitchConversation = async (targetId: string) => {
    if (!data || targetId === data.conversationId) {
      setView('chat');
      return;
    }
    if (streaming) abortRef.current?.abort();
    setBusyConversationId(targetId);
    setError('');
    try {
      const res = await assistant.switchConversation(targetId);
      setData((current) => current ? { ...current, conversationId: res.conversationId, messages: res.messages } : current);
      setView('chat');
    } catch (err: any) {
      setError(err.message || '切换话题失败');
    } finally {
      setBusyConversationId(null);
    }
  };

  const handleDeleteConversation = (conv: AssistantConversationSummary, event: React.MouseEvent) => {
    event.stopPropagation();
    setPendingDeleteConversation(conv);
  };

  const confirmDeleteConversation = async () => {
    if (!pendingDeleteConversation) return;
    const targetId = pendingDeleteConversation.id;
    setDeletingConversation(true);
    setBusyConversationId(targetId);
    setError('');
    try {
      const res = await assistant.deleteConversation(targetId);
      setConversations((prev) => prev.filter((c) => c.id !== targetId));
      if (data && targetId === data.conversationId) {
        setData({
          ...data,
          conversationId: res.currentConversationId,
          messages: res.messages || [],
        });
      }
      setPendingDeleteConversation(null);
    } catch (err: any) {
      setError(err.message || '删除话题失败');
    } finally {
      setDeletingConversation(false);
      setBusyConversationId(null);
    }
  };

  return (
    <>
      {children}
      {!hidden && loggedIn && (
        <AssistantLauncher
          open={open}
          onClick={() => setOpen(true)}
          proactiveGreeting={proactiveGreeting}
          proactiveGreetingCollapsed={proactiveGreetingCollapsed}
          onDismissGreeting={handleDismissGreeting}
          onAcceptGreeting={handleAcceptGreeting}
          proactiveEnabled={localProactive !== null ? localProactive : isProactive(data?.profile.proactiveEnabled)}
          activeReminderAlert={activeReminderAlert}
          onCompleteReminder={handleCompleteReminderAlert}
          onSnoozeReminder={handleSnoozeReminder}
          onDismissReminderAlert={() => setActiveReminderAlert(null)}
          pendingCount={reminders.filter((r) => r.status === 'PENDING').length}
        />
      )}
      {!hidden && loggedIn && open && (
        <div className="fixed inset-0 z-[70] md:pointer-events-none" style={{ position: 'fixed', inset: 0, zIndex: 70 }}>
          <button type="button" aria-label="关闭个人助理" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/20 backdrop-blur-[2px] md:pointer-events-auto md:bg-black/10" />
          <aside
            className="pointer-events-auto absolute flex flex-col overflow-hidden bg-[#fbfaf7] shadow-2xl md:rounded-lg md:border md:border-black/10"
            style={mobile
              ? { inset: 0 }
              : { top: 12, right: 12, bottom: 12, width: 430, borderRadius: 8, border: '1px solid rgb(0 0 0 / 0.1)' }}
          >
            {view === 'history' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <header className="flex h-16 shrink-0 items-center gap-3 border-b border-black/[0.06] bg-white/80 px-4 backdrop-blur">
                  <button
                    type="button"
                    onClick={() => setView('chat')}
                    aria-label="返回对话"
                    title="返回对话"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-black text-slate-900">历史话题</h2>
                    <p className="text-[11px] font-semibold text-slate-400">随时切回过去的对话继续聊</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRequestNewConversation()}
                    disabled={Boolean(busyConversationId) || extractingSummary}
                    aria-label="开启新话题"
                    title={extractingSummary ? '正在整理小结...' : '开启新话题'}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-slate-950 px-2.5 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                  >
                    {extractingSummary ? <Loader2 size={13} className="animate-spin text-amber-400" /> : <Plus size={14} />}
                    <span>新话题</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); router.push('/me?tab=assistant'); }}
                    aria-label="助理设置"
                    title="助理设置"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                  >
                    <Settings2 size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="关闭个人助理"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                  >
                    <PanelRightClose size={18} />
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
                  {loadingConversations ? (
                    <div className="flex h-48 items-center justify-center text-slate-400">
                      <Loader2 size={22} className="animate-spin" />
                    </div>
                  ) : conversations.length === 0 ? (
                    <div className="py-16 text-center text-sm font-semibold text-slate-400">
                      暂无历史话题
                    </div>
                  ) : (
                    conversations.map((item) => {
                      const isActive = item.id === data?.conversationId;
                      const isBusy = busyConversationId === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleSwitchConversation(item.id)}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            'group relative rounded-xl border p-3.5 transition cursor-pointer text-left',
                            isActive
                              ? 'border-emerald-400/80 bg-emerald-50/40 shadow-xs'
                              : 'border-black/[0.08] bg-white hover:border-black/20 hover:shadow-sm'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="min-w-0 flex-1 truncate text-sm font-black text-slate-900">
                              {item.title || '新话题'}
                            </h3>
                            <div className="flex items-center gap-1.5">
                              {isActive && (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                                  进行中
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => handleDeleteConversation(item, e)}
                                disabled={isBusy}
                                aria-label="删除话题"
                                title="删除话题"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 opacity-80 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                              >
                                {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                              </button>
                            </div>
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs text-slate-500 font-medium">
                            {item.lastMessageSnippet || '（无消息）'}
                          </p>
                          <div className="mt-2.5 flex items-center justify-between text-[11px] font-semibold text-slate-400">
                            <span>{formatTime(item.updatedAt)}</span>
                            <span>{item.messageCount} 条消息</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <>
                <header className="flex h-16 shrink-0 items-center gap-2 border-b border-black/[0.06] bg-white/80 px-4 backdrop-blur">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white">
                    <MessageCircleHeart size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h1 className="truncate text-sm font-black text-slate-900">{data?.profile.name || '个人助理'}</h1>
                      {(() => {
                        const active = localProactive !== null ? localProactive : isProactive(data?.profile.proactiveEnabled);
                        return (
                          <button
                            type="button"
                            onClick={toggleProactive}
                            title={active ? '当前为在线陪伴，点击切换为仅待命' : '当前为仅待命，点击切换为在线陪伴'}
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-black transition cursor-pointer select-none active:scale-95',
                              active
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200'
                            )}
                          >
                            <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400')} />
                            <span>{active ? '在线' : '待命'}</span>
                          </button>
                        );
                      })()}
                    </div>
                    <p className="truncate text-[11px] font-semibold text-slate-400">陪你聊天，也帮你看清平台里的事</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRemindersOpen((prev) => !prev)}
                    aria-label="待办与便签"
                    title={remindersOpen ? '收起便签与待办' : '查看便签与待办'}
                    className={cn(
                      'relative flex h-9 w-9 items-center justify-center rounded-lg transition cursor-pointer',
                      remindersOpen
                        ? 'bg-amber-100 text-amber-900 font-bold'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                    )}
                  >
                    <Pin size={16} />
                    {reminders.filter((r) => r.status === 'PENDING').length > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-black text-white shadow-xs">
                        {reminders.filter((r) => r.status === 'PENDING').length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={openHistory}
                    aria-label="历史话题"
                    title="历史话题"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-950 cursor-pointer"
                  >
                    <History size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="收起"
                    title="收起"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                  >
                    <PanelRightClose size={18} />
                  </button>
                </header>

                {/* 随手记与待办便签折叠托盘 */}
                {remindersOpen && (
                  <div className="border-b border-black/[0.06] bg-amber-50/50 p-3.5 space-y-2.5 transition animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-black text-amber-950">
                        <Pin size={13} className="text-amber-600" />
                        <span>随手记与待办提醒</span>
                        <span className="rounded-full bg-amber-200/80 px-1.5 py-0.2 text-[10px] text-amber-900 font-bold">
                          {reminders.filter((r) => r.status === 'PENDING').length} 待办
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRemindersOpen(false)}
                        className="text-slate-400 hover:text-slate-700 text-xs cursor-pointer p-0.5"
                      >
                        <X size={13} />
                      </button>
                    </div>

                    {/* 快速加一条便签 */}
                    <div className="flex items-center gap-1.5">
                      <input
                        value={newNoteText}
                        onChange={(e) => setNewNoteText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateManualNote();
                        }}
                        placeholder="随手记便签（聊天中说“下午3点提醒我...”也会自动记下）"
                        className="h-8 flex-1 rounded-lg border border-black/10 bg-white px-2.5 text-xs font-semibold outline-none transition focus:border-amber-400"
                      />
                      <button
                        type="button"
                        onClick={handleCreateManualNote}
                        disabled={!newNoteText.trim() || addingNote}
                        className="h-8 rounded-lg bg-amber-600 px-2.5 text-xs font-bold text-white hover:bg-amber-700 transition disabled:opacity-40 cursor-pointer"
                      >
                        + 记下
                      </button>
                    </div>

                    {/* 便签列表 */}
                    <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                      {reminders.length === 0 ? (
                        <div className="py-3 text-center text-xs text-slate-400 font-medium">
                          暂无待办事项，聊天中随口说“下午3点提醒我...”试试~
                        </div>
                      ) : (
                        reminders.map((item) => {
                          const isPending = item.status === 'PENDING';
                          return (
                            <div
                              key={item.id}
                              className={cn(
                                'group flex items-center justify-between gap-2 rounded-lg border p-2 text-xs transition',
                                isPending
                                  ? 'border-black/[0.06] bg-white shadow-xs'
                                  : 'border-transparent bg-slate-100/60 opacity-60'
                              )}
                            >
                              <div
                                onClick={() => handleToggleReminder(item)}
                                className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                              >
                                <button
                                  type="button"
                                  className={cn(
                                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
                                    isPending
                                      ? 'border-slate-300 text-transparent hover:border-amber-500'
                                      : 'border-emerald-600 bg-emerald-600 text-white'
                                  )}
                                >
                                  {!isPending && <Check size={11} strokeWidth={3} />}
                                </button>
                                <span
                                  className={cn(
                                    'truncate font-semibold text-slate-800',
                                    !isPending && 'line-through text-slate-400'
                                  )}
                                >
                                  {item.content}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold',
                                    item.dueTime
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-slate-100 text-slate-500'
                                  )}
                                >
                                  {item.dueTime && <Clock size={10} />}
                                  {formatReminderDue(item.dueTime)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteReminder(item.id)}
                                  className="text-slate-300 hover:text-rose-600 p-0.5 cursor-pointer opacity-0 group-hover:opacity-100 transition"
                                  title="删除"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
                <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5">
                  {loading && <div className="flex h-full items-center justify-center"><Loader2 size={20} className="animate-spin text-slate-400" /></div>}
                  {!loading && data && data.messages.length === 0 && (
                    <div className="mx-auto flex min-h-full max-w-xs flex-col items-center justify-center pb-16 text-center">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-black/[0.08] bg-white shadow-sm"><MessageCircleHeart size={25} /></div>
                      <p className="text-base font-black text-slate-800">{data.profile.greeting || '我在，今天想聊什么？'}</p>
                    </div>
                  )}
                  {data?.messages.map((message) => (
                    <div key={message.id} className="space-y-2">
                      <MessageBubbleFrame role={message.role} avatar={data.profile.avatar || '🌿'} agentName={data.profile.name} userColor="#0f172a" showAgentName={false}>
                        {message.content ? <MessageContent role={message.role} content={message.content} /> : <span className="inline-flex gap-1 py-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:240ms]" /></span>}
                      </MessageBubbleFrame>

                      {/* 方案 A：建议记忆提示卡片 */}
                      {message.role === 'assistant' && bubbleSuggestions[message.id]?.map((sug, idx) => (
                        <div
                          key={idx}
                          className="ml-10 flex items-start gap-2.5 rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50/90 to-orange-50/70 p-3 text-xs shadow-2xs animate-in fade-in slide-in-from-top-1 duration-200"
                        >
                          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                            <Sparkles size={12} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-black text-amber-950">小伴想记下这件小事：</div>
                            <p className="mt-0.5 font-semibold text-amber-900 leading-5">“{sug.content}”</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5 ml-1 mt-0.5">
                            <button
                              type="button"
                              onClick={() => acceptBubbleSuggestion(message.id, sug, idx)}
                              className="inline-flex items-center gap-1 rounded-lg bg-amber-950 px-2.5 py-1 text-[11px] font-black text-white hover:bg-slate-900 cursor-pointer shadow-xs transition"
                            >
                              <Check size={12} />
                              <span>存入记忆</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => dismissBubbleSuggestion(message.id, idx)}
                              className="flex h-6 w-6 items-center justify-center rounded-lg text-amber-800/60 hover:bg-amber-100 hover:text-amber-950 cursor-pointer transition"
                              title="忽略"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* 存入成功反馈提示 */}
                      {savedTips[message.id] && (
                        <div className="ml-10 flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50/80 border border-emerald-200/60 rounded-xl px-3 py-1.5 w-fit animate-in fade-in duration-200">
                          <Check size={12} className="text-emerald-600" />
                          <span>{savedTips[message.id]}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="shrink-0 border-t border-black/[0.06] bg-white/90 px-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
                  {remindToast && (
                    <div className="mb-2 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/95 px-3 py-1.5 text-xs font-bold text-amber-900 shadow-xs animate-in fade-in duration-200">
                      <span className="flex items-center gap-1.5 truncate">
                        <Sparkles size={13} className="text-amber-600 shrink-0" />
                        <span className="truncate">{remindToast}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setRemindToast(null)}
                        className="text-amber-500 hover:text-amber-800 ml-2 cursor-pointer shrink-0"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  {error && <p className="mb-2 px-1 text-xs font-bold text-rose-600">{error}</p>}
                  <ComposerShell
                    rowClassName="gap-2"
                    toolbar={(webEnabled || sharePage || localModelActive) ? (
                      <div className="flex flex-wrap items-center gap-1.5 pb-1 pt-0.5">
                        {localModelActive && (
                          <div className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-slate-100 px-2 text-xs font-black text-slate-700 shadow-xs">
                            <Cpu size={12} className="shrink-0" />
                            <span>Ollama 本地</span>
                          </div>
                        )}
                        {webEnabled && (
                          <div className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-emerald-50 px-2 text-xs font-black text-emerald-700 shadow-xs">
                            <Globe2 size={12} className="shrink-0" />
                            <span>联网搜索</span>
                            <button
                              type="button"
                              onClick={() => setWebEnabled(false)}
                              aria-label="关闭联网"
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-emerald-500 hover:bg-emerald-100 hover:text-emerald-900"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        )}
                        {sharePage && (
                          <div className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-blue-50 px-2 text-xs font-black text-blue-700 shadow-xs">
                            <Menu size={12} className="shrink-0" />
                            <span>结合当前页面</span>
                            <button
                              type="button"
                              onClick={() => setSharePage(false)}
                              aria-label="取消结合当前页面"
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-blue-500 hover:bg-blue-100 hover:text-blue-900"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    ) : undefined}
                  >
                    <div ref={toolsRef} className="relative mb-0.5 shrink-0">
                      {toolsOpen && (
                        <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-56 rounded-xl border border-black/[0.08] bg-white p-1.5 shadow-xl">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={webEnabled}
                            onClick={() => {
                              setWebEnabled((v) => !v);
                              setToolsOpen(false);
                            }}
                            disabled={streaming}
                            className={cn(
                              'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs font-black transition disabled:opacity-40',
                              webEnabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                            )}
                          >
                            <Globe2 size={16} />
                            <span className="min-w-0 flex-1">联网搜索</span>
                            {webEnabled && <Check size={14} />}
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={sharePage}
                            disabled={!pageContext || streaming}
                            onClick={() => {
                              setSharePage((v) => !v);
                              setToolsOpen(false);
                            }}
                            title={!pageContext ? '当前页面无法读取上下文' : undefined}
                            className={cn(
                              'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs font-black transition disabled:opacity-40',
                              sharePage ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                            )}
                          >
                            <Menu size={16} />
                            <span className="min-w-0 flex-1">结合当前页面</span>
                            {sharePage && <Check size={14} />}
                          </button>
                          <div className="my-1 h-[1px] bg-black/[0.06]" />
                          <button
                            type="button"
                            disabled={!data?.messages?.length || streaming}
                            onClick={() => {
                              setToolsOpen(false);
                              setConfirmClearAssistantOpen(true);
                            }}
                            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs font-black text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40 cursor-pointer"
                          >
                            <Trash2 size={16} />
                            <span className="min-w-0 flex-1">清空当前对话</span>
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setToolsOpen((open) => !open)}
                        disabled={streaming}
                        aria-label={toolsOpen ? '关闭工具菜单' : '打开工具菜单'}
                        aria-expanded={toolsOpen}
                        title="工具选项"
                        className={cn(
                          'relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:text-slate-300',
                          toolsOpen && 'bg-white text-slate-950 shadow-sm'
                        )}
                      >
                        <Plus size={18} className={cn('transition-transform duration-200', toolsOpen && 'rotate-45')} />
                        {(webEnabled || sharePage) && (
                          <span className="absolute right-2 top-2 h-2 w-2 rounded-full ring-2 ring-white bg-emerald-500" />
                        )}
                      </button>
                    </div>

                    <textarea
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          send();
                        }
                      }}
                      rows={1}
                      className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm font-medium leading-6 text-slate-800 outline-none placeholder:text-slate-400"
                      placeholder="和我说点什么..."
                    />

                    {streaming ? (
                      <button
                        onClick={() => abortRef.current?.abort()}
                        aria-label="停止生成"
                        className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-sm"
                      >
                        <Square size={15} />
                      </button>
                    ) : (
                      <button
                        onClick={send}
                        disabled={!input.trim() || !data}
                        aria-label="发送"
                        className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm transition disabled:opacity-30"
                      >
                        <Send size={16} />
                      </button>
                    )}
                  </ComposerShell>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {pendingReminderCandidates && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assistant-reminder-confirm-title"
        >
          <div className="w-full max-w-sm rounded-lg border border-black/[0.08] bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                <Clock size={18} />
              </div>
              <div className="min-w-0">
                <h3 id="assistant-reminder-confirm-title" className="text-base font-black text-slate-950">要添加提醒吗？</h3>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">你提到了日程，但没有明确要求小伴设置提醒。</p>
              </div>
            </div>
            <div className="my-4 space-y-2">
              {pendingReminderCandidates.map((candidate, index) => (
                <div key={`${candidate.content}-${index}`} className="rounded-lg border border-black/[0.06] bg-slate-50 px-3 py-2.5">
                  <p className="text-sm font-bold text-slate-800">{candidate.content}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">{formatReminderDue(candidate.dueTime)}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingReminderCandidates(null)}
                disabled={creatingReminderCandidates}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-black/10 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <X size={14} />暂不添加
              </button>
              <button
                type="button"
                onClick={() => createReminderCandidates(pendingReminderCandidates)}
                disabled={creatingReminderCandidates}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-950 text-xs font-black text-white disabled:opacity-40"
              >
                {creatingReminderCandidates ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}添加提醒
              </button>
            </div>
          </div>
        </div>
      )}

      {topicSummaryModal && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-[28px] border border-black/[0.08] bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
              <Sparkles size={20} />
            </div>
            <h3 className="text-lg font-black text-slate-950">开启新话题前的小结</h3>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
              在这段聊天中，小伴为你梳理了以下习惯与偏好，是否存入长期记忆库？
            </p>
            <div className="my-4 space-y-2 max-h-48 overflow-y-auto">
              {topicSummaryModal.suggestions.map((sug, idx) => {
                const checked = topicSummaryModal.selected.has(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setTopicSummaryModal((prev) => {
                        if (!prev) return prev;
                        const nextSelected = new Set(prev.selected);
                        if (checked) nextSelected.delete(idx);
                        else nextSelected.add(idx);
                        return { ...prev, selected: nextSelected };
                      });
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left text-xs font-semibold transition cursor-pointer',
                      checked
                        ? 'border-amber-300 bg-amber-50/60 text-amber-950'
                        : 'border-black/[0.06] bg-slate-50 text-slate-400'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
                        checked ? 'border-amber-600 bg-amber-600 text-white' : 'border-slate-300 bg-white'
                      )}
                    >
                      {checked && <Check size={11} />}
                    </div>
                    <span className="min-w-0 flex-1 leading-5">{sug.content}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={commitSummaryAndNewTopic}
                disabled={topicSummaryModal.selected.size === 0}
                className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-950 text-xs font-black text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                <Check size={14} />
                <span>存入已选记忆并开启新话题</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTopicSummaryModal(null);
                  handleNewConversation();
                }}
                className="flex h-9 w-full items-center justify-center text-xs font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                直接开启新话题（不存记忆）
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClearAssistantOpen}
        title="清空小伴当前对话？"
        description="清空后将从头开始交流，不会影响已保存的长期记忆与便签提醒。"
        icon={<Trash2 size={20} />}
        confirmText="确认清空"
        cancelText="先保留"
        destructive
        loading={clearingAssistantMessages}
        onCancel={() => {
          if (!clearingAssistantMessages) setConfirmClearAssistantOpen(false);
        }}
        onConfirm={handleClearAssistantMessages}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteConversation)}
        title="删除这个历史话题？"
        description={`确定要删除「${pendingDeleteConversation?.title || '新话题'}」吗？删除后该话题的历史聊天记录将无法找回。`}
        icon={<Trash2 size={20} />}
        confirmText="确认删除"
        cancelText="先保留"
        destructive
        loading={deletingConversation}
        onCancel={() => {
          if (!deletingConversation) setPendingDeleteConversation(null);
        }}
        onConfirm={confirmDeleteConversation}
      />
    </>
  );
}
