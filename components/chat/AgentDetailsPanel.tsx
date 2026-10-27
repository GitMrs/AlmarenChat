'use client';

import { ArrowLeft, BookOpen, ChevronDown, ChevronUp, Cpu, Database, Info, Loader2, MessageSquarePlus, Plus, QrCode, RefreshCw, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import KnowledgeManager from '@/components/agent/KnowledgeManager';
import SpaceMemberModelDialog from '@/components/spaces/SpaceMemberModelDialog';
import AgentDailyStudyCard from '@/components/chat/AgentDailyStudyCard';
import AgentMemoryEditor from '@/components/chat/AgentMemoryEditor';
import AgentExperienceEditor from '@/components/chat/AgentExperienceEditor';
import { agentMemories as agentMemoryApi, agents as agentsApi } from '@/lib/client/api';
import { cn } from '@/lib/client/utils';
import type { DisplayAgent } from '@/components/chat/ChatMessageItem';
import type { AgentExperience, AgentGrowthEvent, AgentMemoryItem } from '@/types';
import type { AgentModelSettingsResponse } from '@/types';
import type { AgentDailyStudyRecord, AgentStudyItem } from '@/lib/agent-study/types';
import type { BilibiliProfile } from '@/lib/client/api';

const DEFAULT_DAILY_STUDY_SCHEDULE = {
  startHour: 8,
  endHour: 24,
  maxAttempts: 2,
  retryBackoffMinutes: 30,
};

const AGENT_MEMORY_CATEGORY_LABELS: Record<string, string> = {
  preference: '偏好习惯',
  rule: '交互约定',
  tech: '技术选型',
  project: '项目背景',
  fact: '已知事实',
  skill: '旧版研习参考',
};

const ACTIVITY_SOURCE_LABELS: Record<string, string> = {
  CHAT: '对话归档', TASK: '任务', DISCUSSION: '讨论', RELAY: '接力', GAME: '游戏', COORDINATION: '成员协作', STUDY: '自主研习',
};

function ActivityText({ content }: { content: string }) {
  const body = (
    <div className="markdown-body break-words text-sm leading-6 text-slate-600 [&_p]:my-2 [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline underline-offset-2">{children}</a> }}>{content}</ReactMarkdown>
    </div>
  );
  if (content.length <= 240 && content.split('\n').length <= 6) return body;
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer list-none text-xs font-bold text-indigo-600">
        <span className="mb-2 line-clamp-3 break-words text-sm font-normal leading-6 text-slate-600 group-open:hidden">{content.replace(/\s+/g, ' ')}</span>
        <span className="group-open:hidden">展开完整内容</span><span className="hidden group-open:inline">收起完整内容</span>
      </summary>
      {body}
    </details>
  );
}

type AgentDetailsPanelProps = {
  displayAgent: DisplayAgent;
  categoryColor: string;
  detailsOpen: boolean;
  mobileDetailsOpen: boolean;
  isLoggedIn: boolean;
  onBack: () => void;
  onToggleDetails: () => void;
  onOpenMobileDetails: () => void;
  onCloseMobileDetails: () => void;
  conversationMode: 'MAIN' | 'TEMPORARY';
  onOpenMainConversation: () => void;
  onCreateTemporaryConversation: () => void;
  temporaryConversations: { id: string; title?: string | null; archived: boolean }[];
  onSelectConversation: (conversationId: string) => void;
  onArchiveConversation: (conversationId: string, archived: boolean) => void;
  onDeleteConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string) => void;
  viewMode?: 'chat' | 'companion';
  onToggleCompanionView?: () => void;
  dailyStudy?: AgentDailyStudyRecord | null;
  loadingDailyStudy?: boolean;
  studyEnabled?: boolean;
  onToggleStudyEnabled?: (enabled: boolean) => void;
  studySourceMode?: 'internal' | 'bilibili';
  onChangeStudySourceMode?: (mode: 'internal' | 'bilibili') => void;
  onRefreshDailyStudy?: () => void;
  onDiscussDailyStudy?: (item: AgentStudyItem) => void;
};

function AgentDetailBody({ displayAgent }: { displayAgent: DisplayAgent }) {
  return (
    <>
      <div>
        <p className="text-xs font-bold text-slate-400">开场白</p>
        <p className="mt-2 rounded-2xl bg-[#fbfaf7] p-4 text-sm leading-6 text-slate-600">
          {displayAgent.greeting || `你好，我是 ${displayAgent.name}。告诉我你想完成什么，我们从第一步开始。`}
        </p>
      </div>
      <div>
        <p className="text-xs font-bold text-slate-400">行为设定摘要</p>
        <div className="markdown-body mt-2 rounded-2xl bg-[#fbfaf7] p-4 text-xs leading-5 text-slate-500">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {'这个 Agent 会根据用户的问题给出清晰、具体、可执行的帮助。'}
          </ReactMarkdown>
        </div>
      </div>
    </>
  );
}

export default function AgentDetailsPanel({
  displayAgent,
  categoryColor,
  detailsOpen,
  mobileDetailsOpen,
  isLoggedIn,
  onBack,
  onToggleDetails,
  onOpenMobileDetails,
  onCloseMobileDetails,
  conversationMode,
  onOpenMainConversation,
  onCreateTemporaryConversation,
  temporaryConversations,
  onSelectConversation,
  onArchiveConversation,
  onDeleteConversation,
  onRenameConversation,
  viewMode = 'chat',
  onToggleCompanionView,
  dailyStudy,
  loadingDailyStudy,
  studyEnabled = false,
  onToggleStudyEnabled,
  studySourceMode = 'internal',
  onChangeStudySourceMode,
  onRefreshDailyStudy,
  onDiscussDailyStudy,
}: AgentDetailsPanelProps) {
  const memoryEnabled = isLoggedIn && conversationMode === 'MAIN';
  const activeMemoryEnabled = useRef(memoryEnabled);
  activeMemoryEnabled.current = memoryEnabled;
  const [conversationDrawerOpen, setConversationDrawerOpen] = useState(false);
  const [memoryDrawerOpen, setMemoryDrawerOpen] = useState(false);
  const [studyDrawerOpen, setStudyDrawerOpen] = useState(false);
  const [memoryTab, setMemoryTab] = useState<'memories' | 'experiences' | 'growthEvents' | 'archives'>('memories');
  const [activityHelpTab, setActivityHelpTab] = useState<'experiences' | 'growthEvents' | 'archives' | null>(null);
  const [memoryHelpOpen, setMemoryHelpOpen] = useState(false);
  const [renameMemoryTarget, setRenameMemoryTarget] = useState<AgentMemoryItem | null>(null);
  const [memoryEditorOpen, setMemoryEditorOpen] = useState(false);
  const [memoryNotice, setMemoryNotice] = useState('');
  const [memoryError, setMemoryError] = useState('');
  const [deleteMemoryTarget, setDeleteMemoryTarget] = useState<AgentMemoryItem | null>(null);
  const [toggleMemoryTarget, setToggleMemoryTarget] = useState<{ memory: AgentMemoryItem; nextStatus: 'ACTIVE' | 'DISABLED' } | null>(null);
  const [togglingMemory, setTogglingMemory] = useState(false);
  const [agentMemories, setAgentMemories] = useState<AgentMemoryItem[]>([]);
  const [agentExperiences, setAgentExperiences] = useState<AgentExperience[]>([]);
  const [agentGrowthEvents, setAgentGrowthEvents] = useState<AgentGrowthEvent[]>([]);
  const [editExperience, setEditExperience] = useState<AgentExperience | null>(null);
  const [experienceAction, setExperienceAction] = useState<{ experience: AgentExperience; status: 'ACTIVE' | 'DISABLED' | 'DELETED' } | null>(null);
  const [savingExperience, setSavingExperience] = useState(false);
  const savingExperienceRef = useRef(false);
  const [experienceActionError, setExperienceActionError] = useState('');
  const [activityNotice, setActivityNotice] = useState<{ tab: 'experiences' | 'archives'; message: string } | null>(null);
  const activeAgentId = useRef(displayAgent.id);
  activeAgentId.current = displayAgent.id;
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);
  const [knowledgeDocCount, setKnowledgeDocCount] = useState<number | null>(null);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelProfile, setModelProfile] = useState<AgentModelSettingsResponse | null>(null);
  const [studySchedule, setStudySchedule] = useState(DEFAULT_DAILY_STUDY_SCHEDULE);
  const [studyScheduleOpen, setStudyScheduleOpen] = useState(false);
  const [savingStudySchedule, setSavingStudySchedule] = useState(false);
  const [studyScheduleSaved, setStudyScheduleSaved] = useState(false);
  const [studyScheduleError, setStudyScheduleError] = useState('');
  const [bilibiliConnection, setBilibiliConnection] = useState<{
    connected: boolean;
    profile?: BilibiliProfile | null;
    lastError?: string | null;
  } | null>(null);
  const [bilibiliQr, setBilibiliQr] = useState<{ url: string; key: string } | null>(null);
  const [bilibiliQrImage, setBilibiliQrImage] = useState('');
  const [bilibiliQrStatus, setBilibiliQrStatus] = useState<'waiting' | 'scanned'>('waiting');
  const [bilibiliLoginBusy, setBilibiliLoginBusy] = useState(false);
  const [bilibiliLoginError, setBilibiliLoginError] = useState('');
  const refreshDailyStudyRef = useRef(onRefreshDailyStudy);
  refreshDailyStudyRef.current = onRefreshDailyStudy;

  useEffect(() => {
    let cancelled = false;
    setBilibiliQr(null);
    setBilibiliQrImage('');
    setBilibiliLoginError('');
    if (!isLoggedIn || !displayAgent.id || studySourceMode !== 'bilibili') {
      setBilibiliConnection(null);
      return () => { cancelled = true; };
    }
    agentsApi.dailyStudyBilibiliConnection(displayAgent.id)
      .then((result) => { if (!cancelled) setBilibiliConnection(result); })
      .catch(() => { if (!cancelled) setBilibiliConnection({ connected: false }); });
    return () => { cancelled = true; };
  }, [displayAgent.id, isLoggedIn, studySourceMode]);

  useEffect(() => {
    if (!bilibiliQr) {
      setBilibiliQrImage('');
      return;
    }
    let cancelled = false;
    import('qrcode')
      .then((mod: any) => (typeof mod?.toDataURL === 'function' ? mod : mod?.default).toDataURL(
        bilibiliQr.url,
        { width: 200, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } },
      ))
      .then((url: string) => { if (!cancelled) setBilibiliQrImage(url); })
      .catch(() => { if (!cancelled) setBilibiliQrImage(''); });
    return () => { cancelled = true; };
  }, [bilibiliQr]);

  useEffect(() => {
    if (!bilibiliQr || !displayAgent.id) return;
    let stopped = false;
    setBilibiliQrStatus('waiting');
    const timer = setInterval(async () => {
      try {
        const result = await agentsApi.pollDailyStudyBilibiliQrCode(displayAgent.id, bilibiliQr.key);
        if (stopped) return;
        if (result.status === 'scanned') setBilibiliQrStatus('scanned');
        if (result.status === 'expired') {
          setBilibiliQr(null);
          setBilibiliLoginError('二维码已过期，请重新生成');
        }
        if (result.status === 'success') {
          setBilibiliQr(null);
          setBilibiliConnection({ connected: true, profile: result.profile, lastError: result.warning || null });
          refreshDailyStudyRef.current?.();
        }
      } catch (error: any) {
        if (!stopped && error?.status >= 500) {
          setBilibiliQr(null);
          setBilibiliLoginError(error.message || '扫码状态查询失败，请重试');
        }
      }
    }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [bilibiliQr, displayAgent.id]);

  const startBilibiliQr = async () => {
    setBilibiliLoginBusy(true);
    setBilibiliLoginError('');
    try {
      const result = await agentsApi.createDailyStudyBilibiliQrCode(displayAgent.id);
      setBilibiliQr(result);
    } catch (error: any) {
      setBilibiliLoginError(error?.message || '生成二维码失败');
    } finally {
      setBilibiliLoginBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setModelProfile(null);
    setStudySchedule(DEFAULT_DAILY_STUDY_SCHEDULE);
    setStudyScheduleOpen(false);
    setStudyScheduleSaved(false);
    setStudyScheduleError('');
    setModelDialogOpen(false);
    if (isLoggedIn && displayAgent.id) {
      agentsApi.modelSettings(displayAgent.id).then(result => {
        if (!cancelled) setModelProfile(result);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [displayAgent.id, isLoggedIn]);

  useEffect(() => {
    const settings = modelProfile?.settings;
    if (!settings) return;
    setStudySchedule({
      startHour: settings.dailyStudyStartHour ?? DEFAULT_DAILY_STUDY_SCHEDULE.startHour,
      endHour: settings.dailyStudyWindowEndHour ?? DEFAULT_DAILY_STUDY_SCHEDULE.endHour,
      maxAttempts: settings.dailyStudyMaxAttempts ?? DEFAULT_DAILY_STUDY_SCHEDULE.maxAttempts,
      retryBackoffMinutes: settings.dailyStudyRetryBackoffMinutes ?? DEFAULT_DAILY_STUDY_SCHEDULE.retryBackoffMinutes,
    });
  }, [modelProfile]);

  useEffect(() => {
    let cancelled = false;
    setAgentMemories([]);
    setAgentExperiences([]);
    setAgentGrowthEvents([]);
    setMemoryDrawerOpen(false);
    setMemoryTab('memories');
    setMemoryEditorOpen(false);
    setMemoryNotice('');
    setMemoryError('');
    setRenameMemoryTarget(null);
    setDeleteMemoryTarget(null);
    setToggleMemoryTarget(null);
    setEditExperience(null);
    setExperienceAction(null);
    setExperienceActionError('');
    setActivityNotice(null);
    if (!displayAgent?.id) return;
    if (memoryEnabled) {
      agentMemoryApi.get(displayAgent.id).then((res) => {
        if (cancelled) return;
        setAgentMemories((res.memories || []).filter((m) => m.agentId === displayAgent.id));
        setAgentExperiences(res.experiences || []);
        setAgentGrowthEvents(res.growthEvents || []);
      }).catch(() => {});
    }
    agentsApi.knowledge(displayAgent.id).then((res) => {
      if (cancelled) return;
      setKnowledgeDocCount(res.documents?.length || 0);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [displayAgent?.id, isLoggedIn, memoryEnabled]);

  const openMemoryDrawer = async (tab: 'memories' | 'experiences' = 'memories') => {
    if (!memoryEnabled) return;
    const agentId = displayAgent.id;
    setMemoryTab(tab);
    setActivityHelpTab(null);
    setMemoryHelpOpen(false);
    setMemoryDrawerOpen(true);
    setMemoryLoading(true);
    setMemoryError('');
    try {
      const memoryResult = await agentMemoryApi.get(displayAgent.id);
      if (activeAgentId.current !== agentId || !activeMemoryEnabled.current) return;
      setAgentMemories(memoryResult.memories.filter((memory) => memory.agentId === displayAgent.id));
      setAgentExperiences(memoryResult.experiences || []);
      setAgentGrowthEvents(memoryResult.growthEvents || []);
    } catch (error: any) {
      if (activeAgentId.current === agentId) setMemoryError(error?.message || '加载失败，请重新打开重试。');
    } finally {
      setMemoryLoading(false);
    }
  };

  const saveAgentMemory = async (data: { content: string; category?: string }) => {
    const agentId = displayAgent.id;
    const result = renameMemoryTarget
      ? await agentMemoryApi.update(agentId, renameMemoryTarget.id, data)
      : await agentMemoryApi.add(agentId, data);
    if (activeAgentId.current !== agentId || !activeMemoryEnabled.current) return;
    setAgentMemories((items) => [result.memory, ...items.filter(item => item.id !== result.memory.id)]);
    setMemoryNotice('duplicate' in result && result.duplicate ? '这条记忆已经存在，已保留原记录。' : result.memory.status === 'DISABLED' ? '记忆已更新，仍处于停用状态。' : renameMemoryTarget ? '记忆已更新。' : '记忆已保存，后续主聊天会按需使用。');
    setMemoryError('');
    setMemoryEditorOpen(false);
    setRenameMemoryTarget(null);
  };

  const renameAgentMemory = async (memory: AgentMemoryItem) => {
    setRenameMemoryTarget(memory);
    setMemoryEditorOpen(true);
  };

  const toggleAgentMemory = async (memory: AgentMemoryItem) => {
    setToggleMemoryTarget({ memory, nextStatus: memory.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
  };

  const confirmToggleAgentMemory = async () => {
    if (!toggleMemoryTarget || togglingMemory) return;
    setTogglingMemory(true);
    try {
      const { memory, nextStatus } = toggleMemoryTarget;
      const result = await agentMemoryApi.update(displayAgent.id, memory.id, { status: nextStatus });
      setAgentMemories((items) => items.map((item) => item.id === memory.id ? result.memory : item));
      setToggleMemoryTarget(null);
    } finally {
      setTogglingMemory(false);
    }
  };

  const deleteAgentMemory = async (memory: AgentMemoryItem) => {
    setDeleteMemoryTarget(memory);
  };

  const confirmDeleteAgentMemory = async () => {
    if (!deleteMemoryTarget) return;
    await agentMemoryApi.remove(displayAgent.id, deleteMemoryTarget.id);
    setAgentMemories((items) => items.filter((item) => item.id !== deleteMemoryTarget.id));
    setDeleteMemoryTarget(null);
  };

  const updateExperience = async (experience: AgentExperience, data: { summary?: string; status?: 'ACTIVE' | 'DISABLED' | 'DELETED' }) => {
    if (savingExperienceRef.current) throw new Error('上一项操作还在保存，请稍后重试。');
    const agentId = displayAgent.id;
    savingExperienceRef.current = true;
    setSavingExperience(true);
    try {
      const result = await agentMemoryApi.updateExperience(agentId, experience.id, data);
      if (activeAgentId.current !== agentId || !activeMemoryEnabled.current) return;
      setAgentExperiences(items => data.status === 'DELETED'
        ? items.filter(item => item.id !== experience.id)
        : items.map(item => item.id === experience.id ? result.experience : item));
      setEditExperience(null);
      setExperienceAction(null);
      setExperienceActionError('');
      setActivityNotice({
        tab: experience.sourceType === 'CHAT' ? 'archives' : 'experiences',
        message: data.status === 'DELETED' ? '已遗忘这条记录。原始资料、知识笔记和独立的判断记录仍保留。'
          : data.status === 'DISABLED' ? '记录已停用，不再参与后续回忆，可随时重新启用。'
          : data.status === 'ACTIVE' ? '记录已启用，会按相关性用于后续回忆。'
          : result.experience.status === 'DISABLED' ? '纠正已保存，记录仍保持停用。' : '纠正已保存，后续回忆会使用修改后的内容。',
      });
    } finally {
      savingExperienceRef.current = false;
      setSavingExperience(false);
    }
  };

  const openExperienceAction = (experience: AgentExperience, status: 'ACTIVE' | 'DISABLED' | 'DELETED') => {
    setExperienceActionError('');
    setExperienceAction({ experience, status });
  };

  const confirmExperienceAction = async () => {
    if (!experienceAction || savingExperienceRef.current) return;
    const agentId = displayAgent.id;
    setExperienceActionError('');
    try {
      await updateExperience(experienceAction.experience, { status: experienceAction.status });
    } catch (error: any) {
      if (activeAgentId.current === agentId && activeMemoryEnabled.current) setExperienceActionError(error?.message || '操作失败，请重试。');
    }
  };
  const conversationSwitcher = (
      <button
        type="button"
        onClick={() => setConversationDrawerOpen(true)}
        className="flex w-full items-center justify-between rounded-xl bg-[#fbfaf7] px-3 py-2.5 text-left transition hover:bg-slate-100"
      >
        <span className="text-xs font-black text-slate-700">当前聊天：{conversationMode === 'MAIN' ? '主聊天' : '临时聊天'}</span>
        <ChevronDown size={15} className="text-slate-400" />
      </button>
  );

  const modelWidget = isLoggedIn && (
    <button
      type="button"
      onClick={() => setModelDialogOpen(true)}
      className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl bg-[#fbfaf7] px-3 py-2.5 text-left transition hover:bg-slate-100"
    >
      <span className="flex shrink-0 items-center gap-2 text-xs font-black text-slate-700"><Cpu size={15} />角色模型设置</span>
      <span className="truncate text-[11px] text-slate-500">{modelProfile
        ? `${modelProfile.effective.source === 'AGENT' ? '角色默认' : modelProfile.effective.source === 'GLOBAL' ? '继承全局' : '系统默认'} · ${modelProfile.effective.modelName}`
        : '设置默认模型'}</span>
    </button>
  );

  const saveStudySchedule = async () => {
    if (savingStudySchedule) return;
    setSavingStudySchedule(true);
    setStudyScheduleSaved(false);
    setStudyScheduleError('');
    try {
      const result = await agentsApi.updateModelSettings(displayAgent.id, {
        dailyStudyStartHour: studySchedule.startHour,
        dailyStudyWindowEndHour: studySchedule.endHour,
        dailyStudyMaxAttempts: studySchedule.maxAttempts,
        dailyStudyRetryBackoffMinutes: studySchedule.retryBackoffMinutes,
      });
      setModelProfile(result);
      setStudyScheduleSaved(true);
    } catch (error: any) {
      setStudyScheduleError(error?.message || '保存每日学习设置失败');
    } finally {
      setSavingStudySchedule(false);
    }
  };

  const personalMemories = agentMemories.filter((memory) => memory.category !== 'skill');
  const legacyStudyReferences = agentMemories.filter((memory) => memory.category === 'skill');
  const activityExperiences = agentExperiences.filter((experience) => experience.sourceType !== 'CHAT');
  const chatArchives = agentExperiences.filter((experience) => experience.sourceType === 'CHAT');
  const visibleExperiences = memoryTab === 'archives' ? chatArchives : activityExperiences;

  const memoryWidget = memoryEnabled && (
    <button
      type="button"
      onClick={() => openMemoryDrawer()}
      className="mt-3 flex w-full items-center justify-between rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50/70 to-orange-50/40 p-2.5 text-left transition hover:border-amber-300 hover:shadow-xs group cursor-pointer"
      title="管理你确认过的偏好、约定和背景"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
          <Sparkles size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black text-slate-900 group-hover:text-amber-950">
            个人记忆
          </div>
          <div className="text-[11px] font-semibold text-slate-500 truncate">
            {personalMemories.length > 0 ? `已保存 ${personalMemories.length} 条偏好、约定与背景` : '确认过的偏好、约定与背景'}
          </div>
        </div>
      </div>
      <span className="flex shrink-0 items-center rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-amber-700 border border-amber-200/60 shadow-2xs">
        {personalMemories.length}
      </span>
    </button>
  );

  const activityWidget = memoryEnabled && (
    <button
      type="button"
      onClick={() => openMemoryDrawer('experiences')}
      className="mt-2.5 flex w-full items-center justify-between rounded-2xl border border-indigo-200/80 bg-indigo-50/50 p-2.5 text-left transition hover:border-indigo-300 cursor-pointer"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white"><BookOpen size={14} /></div>
        <div>
          <div className="text-xs font-black text-slate-900">活动记录</div>
          <div className="text-[11px] font-semibold text-slate-500">学习、任务、共同经历与成长</div>
        </div>
      </div>
      <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-indigo-700">{activityExperiences.length + agentGrowthEvents.length}</span>
    </button>
  );

  const knowledgeWidget = (
    <button
      type="button"
      onClick={() => setKnowledgeModalOpen(true)}
      className="mt-2.5 flex w-full items-center justify-between rounded-2xl border border-sky-200/80 bg-gradient-to-r from-sky-50/70 to-blue-50/40 p-2.5 text-left transition hover:border-sky-300 hover:shadow-xs group cursor-pointer"
      title="查看与管理这个 Agent 掌握的专属知识库"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white shadow-xs">
          <Database size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black text-slate-900 group-hover:text-sky-950">
            知识库
          </div>
          <div className="text-[11px] font-semibold text-slate-500 truncate">
            {knowledgeDocCount !== null ? (knowledgeDocCount > 0 ? `已挂载 ${knowledgeDocCount} 篇文档` : '未挂载文档，点击上传') : '文档与章节向量'}
          </div>
        </div>
      </div>
      <span className="flex shrink-0 items-center rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-sky-700 border border-sky-200/60 shadow-2xs">
        {knowledgeDocCount ?? 0}
      </span>
    </button>
  );

  const studyWidget = (
    <button
      type="button"
      onClick={() => setStudyDrawerOpen(true)}
      className={cn(
        "mt-2.5 flex w-full items-center justify-between rounded-2xl border p-2.5 text-left transition hover:shadow-xs group cursor-pointer",
        studyEnabled
          ? "border-amber-300/80 bg-gradient-to-r from-amber-50/80 via-rose-50/40 to-orange-50/30 hover:border-amber-400"
          : "border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-50"
      )}
      title="查看与设置 Agent 每日全网自主研习"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-white shadow-xs transition",
          studyEnabled ? "bg-gradient-to-br from-amber-500 to-rose-500" : "bg-slate-400"
        )}>
          <BookOpen size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black text-slate-900 group-hover:text-amber-950 flex items-center gap-1.5">
            <span>今日自主研习</span>
            <span className={cn(
              "rounded-full text-[10px] font-bold px-1.5 py-0.2",
              studyEnabled ? "bg-amber-500/10 text-amber-700" : "bg-slate-200 text-slate-500"
            )}>
              {studyEnabled ? 'Daily' : '未开启'}
            </span>
          </div>
          <div className="text-[11px] font-semibold text-slate-500 truncate">
            {studyEnabled
              ? (dailyStudy?.items?.length ? `精读 ${dailyStudy.items.length} 篇 · 已沉淀到认知` : '每日精读全网热点')
              : '点击进入可为该角色开启'}
          </div>
        </div>
      </div>
      <span className={cn(
        "flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-black border shadow-2xs transition",
        studyEnabled
          ? "bg-white text-amber-700 border-amber-200/60"
          : "bg-white text-slate-400 border-slate-200"
      )}>
        {studyEnabled ? (dailyStudy?.items?.length ?? 3) : 'OFF'}
      </span>
    </button>
  );

  const studyDrawer = studyDrawerOpen && (
    <div className="fixed inset-0 z-[60] bg-slate-950/25" onClick={() => setStudyDrawerOpen(false)}>
      <div className="absolute inset-y-0 right-0 flex w-[min(600px,94vw)] flex-col bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-xl text-white shadow-2xs transition",
              studyEnabled ? "bg-gradient-to-br from-amber-500 to-rose-500" : "bg-slate-400"
            )}>
              <BookOpen size={16} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-950">{displayAgent.name}的自主研习</h2>
              <p className="mt-0.5 text-xs font-semibold text-slate-400">每日自主精选研读 3 篇热点 · 知识提炼与第一人称心得</p>
            </div>
          </div>
          <button type="button" onClick={() => setStudyDrawerOpen(false)} className="rounded-full bg-[#fbfaf7] p-2 text-slate-500 hover:bg-slate-100 cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {/* 开关卡片 */}
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-black/[0.06] bg-[#fcfbf9] p-3.5">
          <div className="flex items-center gap-2.5">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-900">自主学习开关</span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-black transition",
                  studyEnabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                )}>
                  {studyEnabled ? '已开启' : '已关闭'}
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-400 mt-0.5">
                {studyEnabled ? '开启后每天自选 3 篇全网热点研习并主动分享' : '目前仅 Sunny 默认开启自学，你可以随时为该角色开启'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onToggleStudyEnabled?.(!studyEnabled)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
              studyEnabled ? "bg-amber-500" : "bg-slate-300"
            )}
            role="switch"
            aria-checked={studyEnabled}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                studyEnabled ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>

        {/* 学习源选择模式 */}
        {studyEnabled && (
          <div className="mt-2.5 rounded-2xl border border-black/[0.06] bg-[#fcfbf9] p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black text-slate-900">研习内容来源</span>
              <span className="text-[10px] font-bold text-slate-400">选择 Agent 学习渠道</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChangeStudySourceMode?.('internal')}
                className={cn(
                  "flex flex-col rounded-xl border p-2.5 text-left transition cursor-pointer",
                  studySourceMode === 'internal'
                    ? "border-amber-400/80 bg-amber-500/10 shadow-2xs"
                    : "border-black/[0.06] bg-white hover:bg-slate-50 text-slate-600"
                )}
              >
                <div className="flex items-center gap-1.5 font-black text-xs text-slate-900">
                  <span>📰 全网热点精选</span>
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500 leading-4">
                  走内部聚合热搜（知乎/微博/少数派/读书等），极速轻量
                </div>
              </button>

              <button
                type="button"
                onClick={() => onChangeStudySourceMode?.('bilibili')}
                className={cn(
                  "flex flex-col rounded-xl border p-2.5 text-left transition cursor-pointer",
                  studySourceMode === 'bilibili'
                    ? "border-rose-400/80 bg-rose-500/10 shadow-2xs"
                    : "border-black/[0.06] bg-white hover:bg-slate-50 text-slate-600"
                )}
              >
                <div className="flex items-center gap-1.5 font-black text-xs text-slate-900">
                  <span>📺 Bilibili 主动搜索</span>
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-500 leading-4">
                  到 B 站定向搜 1 小时内精炼课程，提取字幕与 ASR 深度沉淀
                </div>
              </button>
            </div>
            {studySourceMode === 'bilibili' && (
              <div className="mt-2.5 rounded-xl border border-rose-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-900">
                      <QrCode size={14} className="text-rose-500" />
                      {bilibiliConnection?.connected ? 'B 站已连接' : '先连接 B 站账号'}
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">
                      {bilibiliConnection?.connected
                        ? `每日学习将使用${bilibiliConnection.profile?.uname ? `「${bilibiliConnection.profile.uname}」` : '当前账号'}的登录态读取字幕与音频。`
                        : '需要扫码登录后，Agent 才能搜索并读取 B 站内容。'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startBilibiliQr}
                    disabled={bilibiliLoginBusy}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] font-black text-white disabled:opacity-50"
                  >
                    {bilibiliLoginBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {bilibiliConnection?.connected ? '重新扫码' : '扫码登录'}
                  </button>
                </div>
                {bilibiliQr && (
                  <div className="mt-2 flex items-center gap-3 rounded-lg bg-slate-50 p-2">
                    {bilibiliQrImage ? <img src={bilibiliQrImage} alt="B 站登录二维码" className="h-28 w-28 rounded bg-white" /> : <div className="h-28 w-28 animate-pulse rounded bg-slate-200" />}
                    <div className="text-[11px] leading-5 text-slate-500">
                      <div className="font-bold text-slate-700">请用 B 站 App 扫码</div>
                      <div>{bilibiliQrStatus === 'scanned' ? '已扫码，请在手机上确认登录' : '等待扫码确认…'}</div>
                    </div>
                  </div>
                )}
                {(bilibiliLoginError || bilibiliConnection?.lastError) && (
                  <div className="mt-2 text-[11px] leading-4 text-rose-600">
                    {bilibiliLoginError || bilibiliConnection?.lastError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {studyEnabled && (
          <div className="mt-2.5 rounded-2xl border border-amber-200/80 bg-amber-50/30 p-3.5">
            <button
              type="button"
              onClick={() => setStudyScheduleOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-2 text-left"
              aria-expanded={studyScheduleOpen}
            >
              <div>
                <div className="text-xs font-black text-slate-900">每日学习调度</div>
                <div className="mt-0.5 text-[10px] font-medium text-slate-500">只在这个时间段运行，达到尝试上限后当天停止</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500">
                  {studySchedule.startHour}:00–{studySchedule.endHour === 24 ? '24:00' : `${studySchedule.endHour}:00`} · 最多 {studySchedule.maxAttempts} 次
                </span>
                {studyScheduleOpen ? <ChevronUp size={15} className="text-slate-500" /> : <ChevronDown size={15} className="text-slate-500" />}
              </div>
            </button>
            {studyScheduleOpen && <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="rounded-xl border border-black/[0.06] bg-white px-2.5 py-2">
                <span className="block text-[10px] font-bold text-slate-400">开始时间</span>
                <div className="mt-1 flex items-center gap-1 text-xs font-black text-slate-800">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={studySchedule.startHour}
                    onChange={(event) => setStudySchedule((current) => ({ ...current, startHour: Number(event.target.value) }))}
                    className="h-7 w-14 rounded-lg border border-black/[0.08] bg-slate-50 px-1.5 text-center outline-none focus:border-amber-400"
                  />
                  <span>点</span>
                </div>
              </label>
              <label className="rounded-xl border border-black/[0.06] bg-white px-2.5 py-2">
                <span className="block text-[10px] font-bold text-slate-400">结束时间</span>
                <div className="mt-1 flex items-center gap-1 text-xs font-black text-slate-800">
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={studySchedule.endHour}
                    onChange={(event) => setStudySchedule((current) => ({ ...current, endHour: Number(event.target.value) }))}
                    className="h-7 w-14 rounded-lg border border-black/[0.08] bg-slate-50 px-1.5 text-center outline-none focus:border-amber-400"
                  />
                  <span>点</span>
                </div>
              </label>
              <label className="rounded-xl border border-black/[0.06] bg-white px-2.5 py-2">
                <span className="block text-[10px] font-bold text-slate-400">当天尝试上限</span>
                <div className="mt-1 flex items-center gap-1 text-xs font-black text-slate-800">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={studySchedule.maxAttempts}
                    onChange={(event) => setStudySchedule((current) => ({ ...current, maxAttempts: Number(event.target.value) }))}
                    className="h-7 w-14 rounded-lg border border-black/[0.08] bg-slate-50 px-1.5 text-center outline-none focus:border-amber-400"
                  />
                  <span>次</span>
                </div>
              </label>
              <label className="rounded-xl border border-black/[0.06] bg-white px-2.5 py-2">
                <span className="block text-[10px] font-bold text-slate-400">失败重试间隔</span>
                <div className="mt-1 flex items-center gap-1 text-xs font-black text-slate-800">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={studySchedule.retryBackoffMinutes}
                    onChange={(event) => setStudySchedule((current) => ({ ...current, retryBackoffMinutes: Number(event.target.value) }))}
                    className="h-7 w-14 rounded-lg border border-black/[0.08] bg-slate-50 px-1.5 text-center outline-none focus:border-amber-400"
                  />
                  <span>分钟</span>
                </div>
              </label>
            </div>}
            {studyScheduleOpen && (studySchedule.endHour <= studySchedule.startHour || studyScheduleError) && (
              <div className="mt-2 text-[11px] font-semibold text-rose-600">
                {studyScheduleError || '结束时间必须晚于开始时间'}
              </div>
            )}
            {studyScheduleOpen && <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium text-slate-400">
                {studyScheduleSaved ? '已保存，下一轮调度生效' : '按当前 Agent 单独生效'}
              </span>
              <button
                type="button"
                onClick={saveStudySchedule}
                disabled={savingStudySchedule || studySchedule.endHour <= studySchedule.startHour}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-1.5 text-[11px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingStudySchedule && <Loader2 size={12} className="animate-spin" />}
                保存调度设置
              </button>
            </div>}
          </div>
        )}

        <div className="mt-2 flex-1 overflow-y-auto pr-1">
          {!studyEnabled ? (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-[#fbfaf7] p-8 text-center my-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 mb-3.5">
                <Sparkles size={28} />
              </div>
              <h3 className="text-sm font-black text-slate-900">{displayAgent.name} 当前未开启自主研习</h3>
              <p className="mt-1.5 max-w-[280px] text-xs leading-5 text-slate-500">
                开启后，{displayAgent.name} 每天会根据自身的性格与兴趣，从 B站、知乎、GitHub 等全网平台精读 3 篇内容，形成心得以供交流。
              </p>
              <button
                type="button"
                onClick={() => onToggleStudyEnabled?.(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-5 py-2 text-xs font-black text-white shadow-xs hover:bg-slate-800 transition active:scale-95 cursor-pointer"
              >
                <span>立即为 {displayAgent.name} 开启</span>
              </button>
            </div>
          ) : (
            <AgentDailyStudyCard
              study={dailyStudy ?? null}
              loading={loadingDailyStudy}
              onRefresh={onRefreshDailyStudy}
              onDiscuss={(item) => {
                setStudyDrawerOpen(false);
                onCloseMobileDetails();
                onDiscussDailyStudy?.(item);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );

  const conversationDrawer = conversationDrawerOpen && (
    <div className="fixed inset-0 z-[60] bg-slate-950/25" onClick={() => setConversationDrawerOpen(false)}>
          <div className="absolute inset-y-0 left-0 flex w-[min(400px,90vw)] flex-col bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">切换聊天</h2>
                <p className="mt-1 text-xs font-semibold text-slate-400">主聊天长期保留，临时聊天彼此独立</p>
              </div>
              <button type="button" onClick={() => setConversationDrawerOpen(false)} className="rounded-full bg-[#fbfaf7] p-2 text-slate-500"><X size={18} /></button>
            </div>
            <div className="mt-4 space-y-2 overflow-y-auto">
              <button type="button" onClick={() => { onOpenMainConversation(); setConversationDrawerOpen(false); }} disabled={conversationMode === 'MAIN'} className="w-full rounded-xl bg-slate-950 px-4 py-3 text-left text-sm font-black text-white disabled:bg-[#fbfaf7] disabled:text-slate-700">主聊天</button>
              {temporaryConversations.filter((conversation) => !conversation.archived).map((conversation) => (
                <div key={conversation.id} className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-3 py-2">
                  <button type="button" onClick={() => { onSelectConversation(conversation.id); setConversationDrawerOpen(false); }} className="min-w-0 flex-1 truncate py-1 text-left text-sm font-bold text-slate-700">{conversation.title || '临时聊天'}</button>
                  <button type="button" onClick={() => onRenameConversation(conversation.id)} className="shrink-0 text-xs font-bold text-slate-400 hover:text-slate-800">重命名</button>
                  <button type="button" onClick={() => onArchiveConversation(conversation.id, true)} className="shrink-0 text-xs font-bold text-slate-400 hover:text-slate-800">归档</button>
                  <button type="button" onClick={() => onDeleteConversation(conversation.id)} className="shrink-0 text-xs font-bold text-red-400 hover:text-red-600">删除</button>
                </div>
              ))}
              {temporaryConversations.some((conversation) => conversation.archived) && (
                <div className="mt-5 border-t border-black/[0.06] pt-4">
                  <p className="mb-2 text-xs font-black text-slate-400">已归档</p>
                  {temporaryConversations.filter((conversation) => conversation.archived).map((conversation) => (
                    <div key={conversation.id} className="mb-2 flex items-center gap-2 rounded-xl bg-[#fbfaf7] px-3 py-2">
                      <button type="button" onClick={() => { onSelectConversation(conversation.id); setConversationDrawerOpen(false); }} className="min-w-0 flex-1 truncate py-1 text-left text-sm font-bold text-slate-500">{conversation.title || '临时聊天'}</button>
                      <button type="button" onClick={() => onRenameConversation(conversation.id)} className="shrink-0 text-xs font-bold text-slate-400 hover:text-slate-800">重命名</button>
                      <button type="button" onClick={() => onArchiveConversation(conversation.id, false)} className="shrink-0 text-xs font-bold text-slate-400 hover:text-slate-800">恢复</button>
                      <button type="button" onClick={() => onDeleteConversation(conversation.id)} className="shrink-0 text-xs font-bold text-red-400 hover:text-red-600">删除</button>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => { onCreateTemporaryConversation(); setConversationDrawerOpen(false); }} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-black/[0.12] px-4 py-3 text-sm font-black text-slate-600"><MessageSquarePlus size={16} />新建临时聊天</button>
            </div>
          </div>
        </div>
  );
  const memoryGroups = [
    { title: '偏好与约定', items: agentMemories.filter((memory) => ['preference', 'rule'].includes(memory.category)) },
    { title: '已知事实与背景', items: agentMemories.filter((memory) => !['preference', 'rule', 'skill'].includes(memory.category)) },
  ];
  const renderAgentMemory = (memory: AgentMemoryItem) => (
    <div
      key={memory.id}
      className={cn(
        'group rounded-2xl border p-3.5 transition',
        memory.status === 'ACTIVE'
          ? 'border-black/[0.06] bg-[#fbfaf7] hover:border-slate-300'
          : 'border-dashed border-slate-200 bg-slate-50/60 opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={memory.status === 'ACTIVE' ? 'min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700' : 'min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-400 line-through'}>
          {memory.content}
        </p>
        <span className="shrink-0 rounded-md bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
          {AGENT_MEMORY_CATEGORY_LABELS[memory.category] || '已知事实'}
        </span>
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-black/[0.04] pt-2 text-xs font-bold text-slate-400">
        <span className="text-[11px] font-medium text-slate-400">
          {memory.category !== 'skill' && <span className={memory.status === 'ACTIVE' ? 'mr-2 text-emerald-600' : 'mr-2 text-slate-400'}>{memory.status === 'ACTIVE' ? '已启用' : '已停用'}</span>}
          更新于 {new Date(memory.updatedAt || memory.createdAt).toLocaleDateString('zh-CN')}
        </span>
        <div className="flex gap-3">
          <button type="button" onClick={() => renameAgentMemory(memory)} className="hover:text-slate-900 cursor-pointer">修改</button>
          {memory.category !== 'skill' && <button type="button" onClick={() => toggleAgentMemory(memory)} className="hover:text-slate-900 cursor-pointer">{memory.status === 'ACTIVE' ? '停用' : '启用'}</button>}
          <button type="button" onClick={() => deleteAgentMemory(memory)} className="text-rose-500 hover:text-rose-700 cursor-pointer">删除</button>
        </div>
      </div>
    </div>
  );
  const memoryDrawer = memoryEnabled && memoryDrawerOpen && (
    <div className="fixed inset-0 z-[60] bg-slate-950/25" onClick={() => setMemoryDrawerOpen(false)}>
      <div className="absolute inset-y-0 right-0 flex w-[min(480px,92vw)] flex-col bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-white shadow-2xs">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="relative flex items-center gap-1">
                <h2 className="text-lg font-black text-slate-950">{displayAgent.name}的{memoryTab === 'memories' ? '个人记忆' : '活动记录'}</h2>
                {memoryTab === 'memories' && (
                  <div
                    className="shrink-0"
                    onMouseEnter={() => setMemoryHelpOpen(true)}
                    onMouseLeave={() => setMemoryHelpOpen(false)}
                  >
                    <button
                      type="button"
                      onClick={() => setMemoryHelpOpen(true)}
                      onFocus={() => setMemoryHelpOpen(true)}
                      onBlur={() => setMemoryHelpOpen(false)}
                      onKeyDown={(event) => { if (event.key === 'Escape') setMemoryHelpOpen(false); }}
                      aria-label="个人记忆说明与统计"
                      aria-describedby={memoryHelpOpen ? 'agent-memory-help' : undefined}
                      className="flex h-7 w-5 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
                    >
                      <Info size={14} />
                    </button>
                    {memoryHelpOpen && (
                      <div className="absolute left-0 top-full z-20 w-64 max-w-[calc(100vw-4rem)] pt-1">
                        <div id="agent-memory-help" role="tooltip" className="rounded-xl bg-slate-800 px-3 py-2 text-[11px] leading-5 text-white shadow-lg">
                          <p className="font-bold">你希望我记住的事</p>
                          <p>已启用 {personalMemories.filter((memory) => memory.status === 'ACTIVE').length} 条 · 已停用 {personalMemories.filter((memory) => memory.status === 'DISABLED').length} 条</p>
                          <p className="mt-1 text-slate-300">你确认的偏好、约定和背景；可修改，停用或删除后不再用于对话。</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-0.5 text-xs font-semibold text-slate-400">{memoryTab === 'memories' ? '保存你确认过的偏好、约定和背景' : '回顾做过的事，以及有依据的判断与反思'}</p>
            </div>
          </div>
          <button type="button" onClick={() => setMemoryDrawerOpen(false)} className="rounded-full bg-[#fbfaf7] p-2 text-slate-500 hover:bg-slate-100 cursor-pointer">
            <X size={18} />
          </button>
        </div>
        {memoryTab !== 'memories' && (
          <div className="mt-4 flex gap-1 rounded-2xl bg-slate-100 p-1">
            {([
              {
                key: 'experiences', label: '活动', title: '学过什么，做过什么',
                stats: `已启用 ${activityExperiences.filter((experience) => experience.status !== 'DISABLED').length} 条 · 已停用 ${activityExperiences.filter((experience) => experience.status === 'DISABLED').length} 条 · 最近最多 50 条`,
                description: '自动记录学习与活动；知识看「知识库」，认知变化看「判断与反思」。',
              },
              {
                key: 'growthEvents', label: '判断与反思', title: '经历带来的判断与变化',
                stats: `共 ${agentGrowthEvents.length} 条 · 最近最多 50 条`,
                description: '只读的判断、修正与反思，含旧版记录；学习和任务记录看「活动」。',
              },
              {
                key: 'archives', label: '对话归档', title: '过去聊过的事',
                stats: `已启用 ${chatArchives.filter((experience) => experience.status !== 'DISABLED').length} 条 · 已停用 ${chatArchives.filter((experience) => experience.status === 'DISABLED').length} 条 · 最近最多 50 条`,
                description: '用于延续早期聊天，可纠正、停用或遗忘；清空聊天不会移除归档。',
              },
            ] as const).map((tab) => (
              <div
                key={tab.key}
                className={cn('relative flex min-w-0 flex-1 items-center justify-center rounded-xl transition', memoryTab === tab.key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800')}
              >
                <button
                  type="button"
                  onClick={() => { setMemoryTab(tab.key); setActivityHelpTab(null); }}
                  className="py-2 text-xs font-black cursor-pointer"
                >
                  {tab.label}
                </button>
                <div
                  className="shrink-0"
                  onMouseEnter={() => setActivityHelpTab(tab.key)}
                  onMouseLeave={() => setActivityHelpTab(null)}
                >
                  <button
                    type="button"
                    onClick={() => setActivityHelpTab(tab.key)}
                    onFocus={() => setActivityHelpTab(tab.key)}
                    onBlur={() => setActivityHelpTab(null)}
                    onKeyDown={(event) => { if (event.key === 'Escape') setActivityHelpTab(null); }}
                    aria-label={`${tab.label}说明与统计`}
                    aria-describedby={activityHelpTab === tab.key ? `agent-${tab.key}-help` : undefined}
                    className="flex h-7 w-5 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
                  >
                    <Info size={14} />
                  </button>
                  {activityHelpTab === tab.key && (
                    <div className={cn('absolute top-full z-20 w-64 max-w-[calc(100vw-4rem)] pt-1', tab.key === 'experiences' ? 'left-0' : tab.key === 'archives' ? 'right-0' : 'left-1/2 -translate-x-1/2')}>
                      <div id={`agent-${tab.key}-help`} role="tooltip" className="rounded-xl bg-slate-800 px-3 py-2 text-[11px] leading-5 text-white shadow-lg">
                        <p className="font-bold">{tab.title}</p>
                        <p>{tab.stats}</p>
                        <p className="mt-1 text-slate-300">{tab.description}</p>
                      </div>
                      </div>
                    )}
                  </div>
              </div>
            ))}
          </div>
        )}

        {memoryError && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{memoryError}</p>}

        {memoryTab === 'memories' ? (
          <>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => { setRenameMemoryTarget(null); setMemoryEditorOpen(true); }} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-black text-white hover:bg-slate-800">
                <Plus size={14} />新增记忆
              </button>
            </div>
            {memoryNotice && <p role="status" className="mt-3 text-xs font-semibold text-emerald-700">{memoryNotice}</p>}

            <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
              {memoryLoading ? (
                <p className="py-8 text-center text-sm font-semibold text-slate-400">加载中...</p>
              ) : personalMemories.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-bold text-slate-500">还没有 Agent 记忆</p>
                  <p className="mt-1 text-xs text-slate-400">点击“新增记忆”填写，或在主聊天中提出并确认要记住的内容。</p>
                </div>
              ) : (
                <>
                  {memoryGroups.filter((group) => group.items.length > 0).map((group) => (
                    <section key={group.title}>
                      <div className="mb-2 text-[11px] font-black text-slate-500">{group.title} · {group.items.length}</div>
                      <div className="space-y-3">{group.items.map(renderAgentMemory)}</div>
                    </section>
                  ))}
                </>
              )}
            </div>
          </>
        ) : memoryTab !== 'growthEvents' ? (
          <>
            {activityNotice?.tab === memoryTab && <p role="status" className="mt-3 text-xs leading-5 text-emerald-700">{activityNotice.message}</p>}

            <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
              {memoryLoading ? (
                <p className="py-8 text-center text-sm font-semibold text-slate-400">加载中...</p>
              ) : visibleExperiences.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-bold text-slate-500">{memoryTab === 'archives' ? '还没有对话归档' : '还没有活动记录'}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{memoryTab === 'archives' ? '主聊天积累较多消息后，会自动归档较早的内容。' : '开启每日学习，或参与任务与空间活动后，这里会自动留下记录。'}</p>
                </div>
              ) : (
                visibleExperiences.map((experience) => (
                    <article
                      key={experience.id}
                      className={cn(
                        'rounded-2xl border p-3.5 transition',
                        experience.status === 'DISABLED'
                          ? 'border-dashed border-slate-200 bg-slate-50/60'
                          : 'border-black/[0.06] bg-[#fbfaf7]'
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
                        <span className="rounded-md bg-slate-200/60 px-2 py-0.5 text-slate-600">
                          {ACTIVITY_SOURCE_LABELS[experience.sourceType || 'TASK'] || '空间活动'}
                        </span>
                        <span className={experience.status === 'DISABLED' ? 'text-slate-400' : 'text-emerald-600'}>{experience.status === 'DISABLED' ? '已停用' : '已启用'}</span>
                        {experience.edited && <span className="text-indigo-600">已纠正</span>}
                      </div>
                      <h3 className="mt-2 break-words text-sm font-bold leading-6 text-slate-800">{experience.title}</h3>
                      <ActivityText content={experience.summary} />
                      <div className="mt-3 border-t border-black/[0.04] pt-2.5 text-[11px] text-slate-400">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <time dateTime={experience.createdAt}>{new Date(experience.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                          {experience.spaceId && <a href={`/spaces/${encodeURIComponent(experience.spaceId)}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">查看来源空间 ↗</a>}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                          <button type="button" onClick={() => setEditExperience(experience)} disabled={savingExperience} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-slate-300 disabled:opacity-40">纠正内容</button>
                          <button type="button" onClick={() => openExperienceAction(experience, experience.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED')} disabled={savingExperience} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-slate-300 disabled:opacity-40">{experience.status === 'DISABLED' ? '重新启用' : '暂停使用'}</button>
                          <button type="button" onClick={() => openExperienceAction(experience, 'DELETED')} disabled={savingExperience} className="rounded-lg px-3 py-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-40">遗忘记录</button>
                        </div>
                      </div>
                    </article>
                  ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
              {memoryLoading ? (
                <p className="py-8 text-center text-sm font-semibold text-slate-400">加载中...</p>
              ) : agentGrowthEvents.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-bold text-slate-500">还没有成长事件</p>
                  <p className="mt-1 text-xs text-slate-400">Agent 形成值得保留的观察、判断或反思后，会自动记录在这里。</p>
                </div>
              ) : (
                agentGrowthEvents.map((event) => {
                  const labels: Record<string, string> = { OBSERVATION: '观察', BELIEF: '形成判断', REVISION: '修正判断', REFLECTION: '自我反思', REFUSAL: '拒绝', DIARY: '日记', STUDY: '旧版学习流水' };
                  const payload = event.payload || {};
                  const label = event.sourceType === 'TASK' && event.type === 'REFLECTION' && payload.outcome === 'ACCEPTED' && payload.taskId ? '旧版任务记录' : labels[event.type] || event.type;
                  return (
                    <article key={event.id} className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="min-w-0 break-words text-sm font-bold text-slate-800">{String(payload.title || labels[event.type] || event.type)}</h3>
                        <span className="shrink-0 rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">{label}</span>
                      </div>
                      <ActivityText content={String(payload.content || payload.summary || payload.thoughts || '')} />
                      {typeof payload.previousBelief === 'string' && payload.previousBelief && <div className="mt-3 rounded-xl bg-white/75 p-3 text-xs leading-5 text-slate-500"><p className="mb-1 font-bold text-slate-600">原有判断</p><p className="whitespace-pre-wrap break-words">{payload.previousBelief}</p></div>}
                      {typeof payload.evidence === 'string' && payload.evidence && (
                        <details className="mt-2 text-[11px] leading-5 text-slate-500">
                          <summary className="cursor-pointer font-bold">查看判断依据</summary>
                          <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-indigo-200 pl-3">{payload.evidence}</blockquote>
                        </details>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-indigo-100 pt-2.5 text-[11px] text-slate-400">
                        <span>{ACTIVITY_SOURCE_LABELS[event.sourceType || 'CHAT'] || '活动'} · {event.scope === 'SPACE' ? '空间记录' : '个人记录'}</span>
                        <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                        {typeof payload.sourceName === 'string' && payload.sourceName && <span>来源：{payload.sourceName}</span>}
                        {typeof payload.url === 'string' && /^https?:\/\//i.test(payload.url) && <a href={payload.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">查看原资料 ↗</a>}
                        {event.spaceId && <a href={`/spaces/${encodeURIComponent(event.spaceId)}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">查看来源空间 ↗</a>}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
  return (
    <>
      {editExperience && memoryEnabled && <AgentExperienceEditor key={editExperience.id} experience={editExperience} sourceLabel={ACTIVITY_SOURCE_LABELS[editExperience.sourceType || 'TASK'] || '空间活动'} onCancel={() => setEditExperience(null)} onSave={summary => updateExperience(editExperience, { summary })} />}
      <ConfirmDialog
        open={Boolean(experienceAction)}
        title={experienceAction?.status === 'DELETED' ? '遗忘这条记录？' : experienceAction?.status === 'ACTIVE' ? '重新启用这条记录？' : '暂停使用这条记录？'}
        description={<>
          <p className="mb-3 break-words rounded-xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">{experienceAction?.experience.title}</p>
          <p>{experienceAction?.status === 'DELETED' ? '这条记录将从列表移除，不再参与回忆，重复同步也不会恢复。原始聊天、任务结果、知识笔记和独立的判断记录仍保留；遗忘本条记录不会一并清除这些内容。' : experienceAction?.status === 'ACTIVE' ? '重新启用后，Agent 会按相关性使用这条记录回忆过去的经历。' : '暂停后，这条记录仍保留在列表，但不再用于后续回忆。你可以随时重新启用。'}</p>
          {experienceActionError && <p role="alert" className="mt-3 text-xs font-semibold text-rose-600">{experienceActionError}</p>}
        </>}
        confirmText={experienceAction?.status === 'DELETED' ? '确认遗忘' : experienceAction?.status === 'ACTIVE' ? '重新启用' : '暂停使用'}
        cancelText="取消"
        destructive={experienceAction?.status === 'DELETED'}
        loading={savingExperience}
        onCancel={() => { setExperienceAction(null); setExperienceActionError(''); }}
        onConfirm={confirmExperienceAction}
      />
      {memoryEditorOpen && memoryEnabled && (
        <AgentMemoryEditor
          key={renameMemoryTarget?.id || 'new'}
          agentName={displayAgent.name}
          memory={renameMemoryTarget}
          onCancel={() => { setMemoryEditorOpen(false); setRenameMemoryTarget(null); }}
          onSave={saveAgentMemory}
        />
      )}
      <ConfirmDialog
        open={Boolean(toggleMemoryTarget)}
        title={toggleMemoryTarget?.nextStatus === 'ACTIVE' ? '启用这条 Agent 记忆？' : '停用这条 Agent 记忆？'}
        description={toggleMemoryTarget?.nextStatus === 'ACTIVE' ? '启用后，这条记忆会重新参与该 Agent 的后续对话。' : '停用后，这条记忆会暂时不参与该 Agent 的后续对话。'}
        cancelText="取消"
        confirmText={toggleMemoryTarget?.nextStatus === 'ACTIVE' ? '确认启用' : '确认停用'}
        loading={togglingMemory}
        onCancel={() => setToggleMemoryTarget(null)}
        onConfirm={confirmToggleAgentMemory}
      />
      <ConfirmDialog
        open={Boolean(deleteMemoryTarget)}
        title="删除这条 Agent 记忆？"
        description="删除后，这条记忆将不再参与该 Agent 的后续对话。"
        cancelText="取消"
        confirmText="确认删除"
        destructive
        onCancel={() => setDeleteMemoryTarget(null)}
        onConfirm={confirmDeleteAgentMemory}
      />
      {conversationDrawer}
      {memoryDrawer}
      {studyDrawer}
      <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-r border-black/[0.06] bg-white/80 p-5 backdrop-blur lg:flex lg:flex-col">
        <div className="mb-6 flex items-center justify-between gap-2">
          <button
            onClick={onBack}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm hover:text-slate-950"
          >
            <ArrowLeft size={16} />
            返回
          </button>

          {displayAgent.companionCharacterId && onToggleCompanionView && (
            <button
              type="button"
              onClick={onToggleCompanionView}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-300/60 bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-orange-500/15 px-3 py-2 text-xs font-black text-amber-950 transition hover:shadow-xs hover:border-amber-400 active:scale-[0.99] cursor-pointer"
              title={viewMode === 'companion' ? '切换回标准文字聊天界面' : '进入全屏 3D/Live2D 面对面陪伴模式'}
            >
              <Sparkles size={14} className="text-amber-600" />
              <span>{viewMode === 'companion' ? '文字模式' : '陪伴模式'}</span>
            </button>
          )}
        </div>

        <div className="shrink-0 overflow-hidden rounded-[32px] border border-black/[0.06] bg-[#fbfaf7] shadow-sm">
          <div className="h-2" style={{ backgroundColor: categoryColor }} />
          <div className="p-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-white shadow-sm">
              <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="lg" />
            </div>
            <h1 className="mt-3 line-clamp-2 text-xl font-black leading-tight text-slate-950">{displayAgent.name}</h1>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ backgroundColor: categoryColor }}>
                {displayAgent.category || 'Agent'}
              </span>
              {displayAgent.tone && (
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
                  {displayAgent.tone}
                </span>
              )}
            </div>
            <p className="mx-auto mt-3 line-clamp-2 max-w-[240px] text-sm leading-6 text-slate-600">
              {displayAgent.description}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm">
          <div className="mb-5 border-b border-black/[0.06] pb-5">
            {conversationSwitcher}
            {studyWidget}
            {modelWidget}
            {memoryWidget}
            {activityWidget}
            {knowledgeWidget}
          </div>

          <button onClick={onToggleDetails} className="flex w-full items-center justify-between text-left">
            <div>
              <h2 className="text-lg font-black text-slate-950">Agent 详情</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">查看它的开场白、行为设定和适用场景。</p>
            </div>
            <div className="rounded-full bg-[#fbfaf7] p-2 text-slate-500">
              {detailsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
          </button>

          {detailsOpen && (
            <div className="mt-5 max-h-[calc(100vh-430px)] min-h-0 space-y-4 overflow-y-auto border-t border-black/[0.06] pt-5 pr-1">
              <AgentDetailBody displayAgent={displayAgent} />
            </div>
          )}
        </div>
      </aside>

      <header className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] bg-white/86 px-4 py-3 backdrop-blur lg:hidden">
        <button onClick={onBack} className="rounded-full p-2 hover:bg-slate-100">
          <ArrowLeft size={20} />
        </button>
        <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-black text-slate-950">{displayAgent.name}</h1>
          <p className="text-xs font-medium text-slate-400">{displayAgent.category} · {displayAgent.tone}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {displayAgent.companionCharacterId && onToggleCompanionView && (
            <button
              type="button"
              onClick={onToggleCompanionView}
              className="inline-flex items-center gap-1 rounded-full border border-rose-300/80 bg-rose-50/90 px-2.5 py-1.5 text-xs font-black text-rose-800 shadow-2xs active:scale-95 cursor-pointer"
              title={viewMode === 'companion' ? '切换为文字模式' : '切换至陪伴模式'}
            >
              <span>{viewMode === 'companion' ? '💬 对话' : '🌸 陪伴'}</span>
            </button>
          )}
          {memoryEnabled && <button
            type="button"
            onClick={() => openMemoryDrawer()}
            className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50/80 px-2.5 py-1.5 text-xs font-black text-amber-800 shadow-2xs cursor-pointer"
            title="查看与管理个人记忆"
          >
            <Sparkles size={12} className="text-amber-600 fill-amber-600" />
            <span>{agentMemories.length}</span>
          </button>}
          <button
            onClick={onOpenMobileDetails}
            className="rounded-full border border-black/[0.06] bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm cursor-pointer"
          >
            详情
          </button>
        </div>
      </header>

      {mobileDetailsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-sm lg:hidden">
          <div className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-hidden rounded-t-[32px] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" />
                <div className="min-w-0">
                  <h2 className="truncate text-base font-black text-slate-950">{displayAgent.name}</h2>
                  <p className="text-xs font-bold text-slate-400">
                    {displayAgent.category || 'Agent'} · {displayAgent.tone || '默认语气'}
                  </p>
                </div>
              </div>
              <button onClick={onCloseMobileDetails} className="rounded-full bg-[#fbfaf7] p-2 text-slate-500">
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[calc(82dvh-73px)] space-y-4 overflow-y-auto p-5">
              <div className="border-b border-black/[0.06] pb-4">
                {conversationSwitcher}
                {studyWidget}
                {modelWidget}
                {memoryWidget}
                {activityWidget}
                {knowledgeWidget}
              </div>
              <p className="rounded-2xl bg-[#fbfaf7] p-4 text-sm leading-6 text-slate-600">
                {displayAgent.description || '这个 Agent 会根据你的问题给出清晰、具体、可执行的帮助。'}
              </p>
              <AgentDetailBody displayAgent={displayAgent} />
            </div>
          </div>
        </div>
      )}
      <SpaceMemberModelDialog
        open={modelDialogOpen}
        scope="agent"
        member={null}
        agent={displayAgent}
        onClose={() => setModelDialogOpen(false)}
        onSave={async data => {
          const result = await agentsApi.updateModelSettings(displayAgent.id, data);
          setModelProfile(result);
        }}
      />
      {knowledgeModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <KnowledgeManager
              agentId={displayAgent.id}
              agentName={displayAgent.name}
              legacyReferences={legacyStudyReferences.length > 0 ? (
                <details className="mb-5 rounded-2xl border border-slate-200 p-4">
                  <summary className="cursor-pointer text-sm font-bold text-slate-600">旧版研习参考 · {legacyStudyReferences.length}</summary>
                  <p className="my-3 text-xs leading-5 text-slate-500">旧版技能卡保留在这里供查看，不再作为个人记忆参与对话。后续学习的方法统一保存在知识笔记中，按问题检索。</p>
                  <div className="space-y-3">{legacyStudyReferences.map(renderAgentMemory)}</div>
                </details>
              ) : null}
              onClose={() => {
                setKnowledgeModalOpen(false);
                if (displayAgent.id) {
                  agentsApi.knowledge(displayAgent.id).then((res) => {
                    setKnowledgeDocCount(res.documents?.length || 0);
                  }).catch(() => {});
                }
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
