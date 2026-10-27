'use client';

import { ArrowLeft, BookOpen, ChevronDown, ChevronUp, Cpu, Database, MessageSquarePlus, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import TextInputDialog from '@/components/shared/TextInputDialog';
import KnowledgeManager from '@/components/agent/KnowledgeManager';
import SpaceMemberModelDialog from '@/components/spaces/SpaceMemberModelDialog';
import AgentDailyStudyCard from '@/components/chat/AgentDailyStudyCard';
import { agentMemories as agentMemoryApi, agents as agentsApi } from '@/lib/client/api';
import { cn } from '@/lib/client/utils';
import type { DisplayAgent } from '@/components/chat/ChatMessageItem';
import type { AgentExperience, AgentGrowthEvent, AgentGrowthState, AgentMemoryItem } from '@/types';
import type { AgentModelSettingsResponse } from '@/types';
import type { AgentDailyStudyRecord, AgentStudyItem } from '@/lib/agent-study/types';

type AgentDetailsPanelProps = {
  displayAgent: DisplayAgent;
  categoryColor: string;
  detailsOpen: boolean;
  mobileDetailsOpen: boolean;
  isLoggedIn: boolean;
  contextMessageLimit: number;
  maxContextMessageLimit: number;
  onBack: () => void;
  onToggleDetails: () => void;
  onOpenMobileDetails: () => void;
  onCloseMobileDetails: () => void;
  onContextMessageLimitChange: (value: number) => void;
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

function ContextLimitControl({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-[#fbfaf7] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-xs font-black text-slate-500">
        <SlidersHorizontal size={15} />
        <span>近期上下文</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="number"
          min={1}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-8 w-16 rounded-xl border border-black/[0.06] bg-white px-2 text-center text-sm font-black text-slate-800 outline-none focus:border-slate-300"
        />
        <div className="whitespace-nowrap text-xs font-semibold text-slate-400">/ {max} 条</div>
      </div>
    </div>
  );
}

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
  contextMessageLimit,
  maxContextMessageLimit,
  onBack,
  onToggleDetails,
  onOpenMobileDetails,
  onCloseMobileDetails,
  onContextMessageLimitChange,
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
  const [memoryTab, setMemoryTab] = useState<'memories' | 'experiences'>('memories');
  const [renameMemoryTarget, setRenameMemoryTarget] = useState<AgentMemoryItem | null>(null);
  const [renamingMemory, setRenamingMemory] = useState(false);
  const [deleteMemoryTarget, setDeleteMemoryTarget] = useState<AgentMemoryItem | null>(null);
  const [toggleMemoryTarget, setToggleMemoryTarget] = useState<{ memory: AgentMemoryItem; nextStatus: 'ACTIVE' | 'DISABLED' } | null>(null);
  const [togglingMemory, setTogglingMemory] = useState(false);
  const [agentMemories, setAgentMemories] = useState<AgentMemoryItem[]>([]);
  const [agentExperiences, setAgentExperiences] = useState<AgentExperience[]>([]);
  const [agentGrowthEvents, setAgentGrowthEvents] = useState<AgentGrowthEvent[]>([]);
  const [agentGrowthState, setAgentGrowthState] = useState<AgentGrowthState | null>(null);
  const [editExperience, setEditExperience] = useState<AgentExperience | null>(null);
  const [experienceAction, setExperienceAction] = useState<{ experience: AgentExperience; status: 'ACTIVE' | 'DISABLED' | 'DELETED' } | null>(null);
  const [savingExperience, setSavingExperience] = useState(false);
  const activeAgentId = useRef(displayAgent.id);
  activeAgentId.current = displayAgent.id;
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [newMemory, setNewMemory] = useState('');
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);
  const [knowledgeDocCount, setKnowledgeDocCount] = useState<number | null>(null);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelProfile, setModelProfile] = useState<AgentModelSettingsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setModelProfile(null);
    setModelDialogOpen(false);
    if (isLoggedIn && displayAgent.id) {
      agentsApi.modelSettings(displayAgent.id).then(result => {
        if (!cancelled) setModelProfile(result);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [displayAgent.id, isLoggedIn]);

  useEffect(() => {
    let cancelled = false;
    setAgentMemories([]);
    setAgentExperiences([]);
    setAgentGrowthEvents([]);
    setAgentGrowthState(null);
    setMemoryDrawerOpen(false);
    setMemoryTab('memories');
    setNewMemory('');
    setRenameMemoryTarget(null);
    setDeleteMemoryTarget(null);
    setToggleMemoryTarget(null);
    setEditExperience(null);
    setExperienceAction(null);
    if (!displayAgent?.id) return;
    if (memoryEnabled) {
      agentMemoryApi.get(displayAgent.id).then((res) => {
        if (cancelled) return;
        setAgentMemories((res.memories || []).filter((m) => m.agentId === displayAgent.id));
        setAgentExperiences(res.experiences || []);
        setAgentGrowthEvents(res.growthEvents || []);
        setAgentGrowthState(res.growthState || null);
      }).catch(() => {});
    }
    agentsApi.knowledge(displayAgent.id).then((res) => {
      if (cancelled) return;
      setKnowledgeDocCount(res.documents?.length || 0);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [displayAgent?.id, isLoggedIn, memoryEnabled]);

  const openMemoryDrawer = async () => {
    if (!memoryEnabled) return;
    const agentId = displayAgent.id;
    setMemoryTab('memories');
    setMemoryDrawerOpen(true);
    setMemoryLoading(true);
    try {
      const memoryResult = await agentMemoryApi.get(displayAgent.id);
      if (activeAgentId.current !== agentId || !activeMemoryEnabled.current) return;
      setAgentMemories(memoryResult.memories.filter((memory) => memory.agentId === displayAgent.id));
      setAgentExperiences(memoryResult.experiences || []);
      setAgentGrowthEvents(memoryResult.growthEvents || []);
      setAgentGrowthState(memoryResult.growthState || null);
    } finally {
      setMemoryLoading(false);
    }
  };

  const addAgentMemory = async () => {
    const agentId = displayAgent.id;
    const content = newMemory.trim();
    if (!content) return;
    const result = await agentMemoryApi.add(displayAgent.id, { content });
    if (activeAgentId.current !== agentId) return;
    setAgentMemories((items) => [result.memory, ...items.filter(item => item.id !== result.memory.id)]);
    setNewMemory('');
  };

  const renameAgentMemory = async (memory: AgentMemoryItem) => {
    setRenameMemoryTarget(memory);
  };

  const submitMemoryRename = async (content: string) => {
    if (!renameMemoryTarget) return;
    if (content === renameMemoryTarget.content) {
      setRenameMemoryTarget(null);
      return;
    }
    if (renamingMemory) return;
    const memory = renameMemoryTarget;
    setRenamingMemory(true);
    try {
      const result = await agentMemoryApi.update(displayAgent.id, memory.id, { content });
      setAgentMemories((items) => items.map((item) => item.id === memory.id ? result.memory : item));
      setRenameMemoryTarget(null);
    } finally {
      setRenamingMemory(false);
    }
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
    if (savingExperience) return;
    const agentId = displayAgent.id;
    setSavingExperience(true);
    try {
      const result = await agentMemoryApi.updateExperience(agentId, experience.id, data);
      if (activeAgentId.current !== agentId) return;
      setAgentExperiences(items => data.status === 'DELETED'
        ? items.filter(item => item.id !== experience.id)
        : items.map(item => item.id === experience.id ? result.experience : item));
      setEditExperience(null);
      setExperienceAction(null);
    } finally {
      setSavingExperience(false);
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

  const memoryWidget = memoryEnabled && (
    <button
      type="button"
      onClick={openMemoryDrawer}
      className="mt-3 flex w-full items-center justify-between rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50/70 to-orange-50/40 p-2.5 text-left transition hover:border-amber-300 hover:shadow-xs group cursor-pointer"
      title="查看与管理这个 Agent 掌握的专属认知"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
          <Sparkles size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-black text-slate-900 group-hover:text-amber-950">
            Agent 记忆档案
          </div>
          <div className="text-[11px] font-semibold text-slate-500 truncate">
            {agentMemories.length > 0 ? `已建立 ${agentMemories.length} 条专属认知` : '点击查看或记录新偏好'}
          </div>
        </div>
      </div>
      <span className="flex shrink-0 items-center rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-amber-700 border border-amber-200/60 shadow-2xs">
        {agentMemories.length}
      </span>
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
            Agent 专属知识库
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
  const memoryDrawer = memoryEnabled && memoryDrawerOpen && (
    <div className="fixed inset-0 z-[60] bg-slate-950/25" onClick={() => setMemoryDrawerOpen(false)}>
      <div className="absolute inset-y-0 right-0 flex w-[min(480px,92vw)] flex-col bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-white shadow-2xs">
              <Sparkles size={16} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-950">{displayAgent.name}的记忆档案</h2>
              <p className="mt-0.5 text-xs font-semibold text-slate-400">只属于当前 Agent，会在对话中智能唤醒</p>
            </div>
          </div>
          <button type="button" onClick={() => setMemoryDrawerOpen(false)} className="rounded-full bg-[#fbfaf7] p-2 text-slate-500 hover:bg-slate-100 cursor-pointer">
            <X size={18} />
          </button>
        </div>
        {/* Tab 切换 */}
        <div className="mt-4 flex rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMemoryTab('memories')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-black transition-all cursor-pointer',
              memoryTab === 'memories'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <span>我的偏好与约定</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                memoryTab === 'memories' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200/70 text-slate-500'
              )}
            >
              {agentMemories.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMemoryTab('experiences')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-black transition-all cursor-pointer',
              memoryTab === 'experiences'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-800'
            )}
          >
            <span>成长经历流水</span>
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                memoryTab === 'experiences' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200/70 text-slate-500'
              )}
            >
              {agentExperiences.length + agentGrowthEvents.length}
            </span>
          </button>
        </div>

        {memoryTab === 'memories' ? (
          <>
            <div className="mt-3 flex gap-2">
              <input
                value={newMemory}
                onChange={(event) => setNewMemory(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addAgentMemory();
                }}
                placeholder="告诉 Agent 你的称呼、偏好或回答习惯..."
                className="min-w-0 flex-1 rounded-xl border border-black/[0.08] bg-[#fbfaf7] px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-200/60"
              />
              <button
                type="button"
                onClick={addAgentMemory}
                disabled={!newMemory.trim()}
                className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 transition cursor-pointer"
              >
                添加
              </button>
            </div>
            <p className="mt-1.5 text-[11px] font-medium text-slate-400">
              这些专属记忆只对当前 Agent 生效，主对话中可以随时修改或删除。
            </p>

            <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
              {memoryLoading ? (
                <p className="py-8 text-center text-sm font-semibold text-slate-400">加载中...</p>
              ) : agentMemories.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-bold text-slate-500">还没有专属偏好与约定</p>
                  <p className="mt-1 text-xs text-slate-400">在上方输入框或对话中即可随时告诉 Agent 记住你的习惯。</p>
                </div>
              ) : (
                agentMemories.map((memory) => (
                  <div
                    key={memory.id}
                    className={cn(
                      'group rounded-2xl border p-3.5 transition',
                      memory.status === 'ACTIVE'
                        ? 'border-black/[0.06] bg-[#fbfaf7] hover:border-slate-300'
                        : 'border-dashed border-slate-200 bg-slate-50/60 opacity-60'
                    )}
                  >
                    <p className={memory.status === 'ACTIVE' ? 'text-sm leading-6 text-slate-700' : 'text-sm leading-6 text-slate-400 line-through'}>
                      {memory.content}
                    </p>
                    <div className="mt-2.5 flex items-center justify-between border-t border-black/[0.04] pt-2 text-xs font-bold text-slate-400">
                      <span className="text-[11px] font-medium text-slate-400">
                        {new Date(memory.updatedAt || memory.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                      <div className="flex gap-3">
                        <button type="button" onClick={() => renameAgentMemory(memory)} className="hover:text-slate-900 cursor-pointer">修改</button>
                        <button type="button" onClick={() => toggleAgentMemory(memory)} className="hover:text-slate-900 cursor-pointer">{memory.status === 'ACTIVE' ? '停用' : '启用'}</button>
                        <button type="button" onClick={() => deleteAgentMemory(memory)} className="text-rose-500 hover:text-rose-700 cursor-pointer">删除</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            {agentGrowthState && agentGrowthState.eventCount > 0 && (
              <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-indigo-900">当前成长阶段</p>
                    <p className="mt-1 text-base font-black text-slate-900">第 {agentGrowthState.stage} 阶段 · {agentGrowthState.stageName}</p>
                  </div>
                  <Sparkles size={18} className="shrink-0 text-indigo-500" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-white/75 px-2 py-2"><p className="text-sm font-black text-slate-800">{agentGrowthState.days}</p><p className="text-[10px] font-bold text-slate-400">成长天数</p></div>
                  <div className="rounded-xl bg-white/75 px-2 py-2"><p className="text-sm font-black text-slate-800">{agentGrowthState.eventCount}</p><p className="text-[10px] font-bold text-slate-400">经历次数</p></div>
                  <div className="rounded-xl bg-white/75 px-2 py-2"><p className="text-sm font-black text-slate-800">{Number(agentGrowthState.counts?.BELIEF || 0) + Number(agentGrowthState.counts?.REVISION || 0)}</p><p className="text-[10px] font-bold text-slate-400">判断与修正</p></div>
                </div>
                <p className="mt-2 text-[11px] font-semibold text-indigo-700/70">
                  判断 {Number(agentGrowthState.counts?.BELIEF || 0)} · 修正 {Number(agentGrowthState.counts?.REVISION || 0)} · 反思 {Number(agentGrowthState.counts?.REFLECTION || 0)} · 拒绝 {Number(agentGrowthState.counts?.REFUSAL || 0)}
                </p>
              </div>
            )}
            <p className="mt-3 text-[11px] font-medium text-slate-400">
              Agent 在单聊、学习、空间任务与协作中沉淀的经历记录，用于背景认知。成长事件会作为历史保留，不能直接修改或删除。
            </p>

            <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
              {memoryLoading ? (
                <p className="py-8 text-center text-sm font-semibold text-slate-400">加载中...</p>
              ) : agentExperiences.length === 0 && agentGrowthEvents.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-bold text-slate-500">还没有已记录的成长经历</p>
                  <p className="mt-1 text-xs text-slate-400">当 Agent 在空间协作或完成任务后，会自动在这里沉淀要点。</p>
                </div>
              ) : (
                <>
                  {agentGrowthEvents.map((event) => {
                    const labels: Record<string, string> = { OBSERVATION: '观察', BELIEF: '形成判断', REVISION: '修正判断', REFLECTION: '自我反思', REFUSAL: '拒绝', DIARY: '日记', STUDY: '自主学习' };
                    const payload = event.payload || {};
                    return (
                      <article key={event.id} className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-slate-800">{String(payload.title || labels[event.type] || event.type)}</p>
                          <span className="shrink-0 rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">{labels[event.type] || event.type}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-600">{String(payload.content || payload.summary || payload.thoughts || '')}</p>
                        <div className="mt-2 border-t border-indigo-100 pt-2 text-[11px] font-semibold text-slate-400">
                          {event.scope === 'SPACE' ? '空间成长 · ' : '个人成长 · '}{new Date(event.createdAt).toLocaleDateString('zh-CN')}
                        </div>
                      </article>
                    );
                  })}
                  {agentExperiences.map((experience) => (
                    <article
                      key={experience.id}
                      className={cn(
                        'rounded-2xl border p-3.5 transition',
                        experience.status === 'DISABLED'
                          ? 'border-dashed border-slate-200 bg-slate-50/60 opacity-60'
                          : 'border-black/[0.06] bg-[#fbfaf7]'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-slate-800">{experience.title}</p>
                        <span className="shrink-0 rounded-md bg-slate-200/60 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          {({ CHAT: '单聊', TASK: '任务', DISCUSSION: '讨论', RELAY: '接力', GAME: '游戏', COORDINATION: '成员协作', STUDY: '自主研习' } as Record<string, string>)[experience.sourceType || 'TASK'] || '空间活动'}
                        </span>
                      </div>
                      <p className={experience.status === 'DISABLED' ? 'mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-400 line-through' : 'mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-600 font-normal'}>
                        {experience.summary}
                      </p>
                      <div className="mt-2.5 flex items-center justify-between border-t border-black/[0.04] pt-2 text-[11px] font-semibold text-slate-400">
                        <span className="truncate">{experience.spaceId ? '来源空间：' + experience.spaceId + ' · ' : ''}{new Date(experience.createdAt).toLocaleDateString('zh-CN')}{experience.edited ? ' · 已纠正' : ''}</span>
                        <div className="flex shrink-0 gap-3 text-xs font-bold text-slate-400">
                          <button type="button" onClick={() => setEditExperience(experience)} className="hover:text-slate-900 cursor-pointer">纠正</button>
                          <button type="button" onClick={() => setExperienceAction({ experience, status: experience.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' })} className="hover:text-slate-900 cursor-pointer">{experience.status === 'DISABLED' ? '启用' : '停用'}</button>
                          <button type="button" onClick={() => setExperienceAction({ experience, status: 'DELETED' })} className="text-rose-500 hover:text-rose-700 cursor-pointer">遗忘</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
  return (
    <>
      <TextInputDialog
        open={Boolean(editExperience)}
        title="纠正个人经历"
        label="经历内容（最多 2000 字）"
        defaultValue={editExperience?.summary || ''}
        loading={savingExperience}
        onCancel={() => setEditExperience(null)}
        onConfirm={summary => editExperience ? updateExperience(editExperience, { summary }) : undefined}
      />
      <ConfirmDialog
        open={Boolean(experienceAction)}
        title={experienceAction?.status === 'DELETED' ? '遗忘这段经历？' : experienceAction?.status === 'ACTIVE' ? '启用这段经历？' : '停用这段经历？'}
        description={experienceAction?.status === 'DELETED' ? '此经历将不再被读取，重复同步也不会恢复。原始聊天和空间记录仍然保留。' : '这只影响当前 Agent 后续是否读取这段经历。'}
        confirmText="确认"
        cancelText="取消"
        destructive={experienceAction?.status === 'DELETED'}
        loading={savingExperience}
        onCancel={() => setExperienceAction(null)}
        onConfirm={() => experienceAction ? updateExperience(experienceAction.experience, { status: experienceAction.status }) : undefined}
      />
      <TextInputDialog
        open={Boolean(renameMemoryTarget)}
        title="修改 Agent 记忆"
        label="记忆内容"
        defaultValue={renameMemoryTarget?.content || ''}
        placeholder="输入记忆内容"
        loading={renamingMemory}
        onCancel={() => setRenameMemoryTarget(null)}
        onConfirm={submitMemoryRename}
      />
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
            {knowledgeWidget}
          </div>
          {isLoggedIn && (
            <ContextLimitControl
              value={contextMessageLimit}
              max={maxContextMessageLimit}
              onChange={onContextMessageLimitChange}
            />
          )}

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
            onClick={openMemoryDrawer}
            className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50/80 px-2.5 py-1.5 text-xs font-black text-amber-800 shadow-2xs cursor-pointer"
            title="查看与管理记忆档案"
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
              {isLoggedIn && (
                <ContextLimitControl
                  value={contextMessageLimit}
                  max={maxContextMessageLimit}
                  onChange={onContextMessageLimitChange}
                />
              )}
              <div className="border-b border-black/[0.06] pb-4">
                {conversationSwitcher}
                {studyWidget}
                {modelWidget}
                {memoryWidget}
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
