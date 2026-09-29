'use client';

import { ArrowLeft, ChevronDown, ChevronUp, MessageSquarePlus, SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import TextInputDialog from '@/components/shared/TextInputDialog';
import { assistant as assistantApi, agents as agentsApi } from '@/lib/api';
import type { DisplayAgent } from '@/components/chat/ChatMessageItem';
import type { AssistantMemoryItem } from '@/types';
import type { AgentExperience } from '@/types';

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
        <span>记忆</span>
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
}: AgentDetailsPanelProps) {
  const [conversationDrawerOpen, setConversationDrawerOpen] = useState(false);
  const [memoryDrawerOpen, setMemoryDrawerOpen] = useState(false);
  const [renameMemoryTarget, setRenameMemoryTarget] = useState<AssistantMemoryItem | null>(null);
  const [renamingMemory, setRenamingMemory] = useState(false);
  const [deleteMemoryTarget, setDeleteMemoryTarget] = useState<AssistantMemoryItem | null>(null);
  const [toggleMemoryTarget, setToggleMemoryTarget] = useState<{ memory: AssistantMemoryItem; nextStatus: 'ACTIVE' | 'DISABLED' } | null>(null);
  const [togglingMemory, setTogglingMemory] = useState(false);
  const [agentMemories, setAgentMemories] = useState<AssistantMemoryItem[]>([]);
  const [agentExperiences, setAgentExperiences] = useState<AgentExperience[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [newMemory, setNewMemory] = useState('');

  const openMemoryDrawer = async () => {
    setMemoryDrawerOpen(true);
    setMemoryLoading(true);
    try {
      const [memoryResult, growthResult] = await Promise.all([
        assistantApi.get(displayAgent.id),
        agentsApi.growth(displayAgent.id).catch(() => ({ rules: [], experiences: [] })),
      ]);
      setAgentMemories(memoryResult.memories.filter((memory) => memory.agentId === displayAgent.id));
      setAgentExperiences(growthResult.experiences.filter((experience) => experience.outcome === 'ACCEPTED'));
    } finally {
      setMemoryLoading(false);
    }
  };

  const addAgentMemory = async () => {
    const content = newMemory.trim();
    if (!content) return;
    const result = await assistantApi.addMemory({ content, agentId: displayAgent.id });
    setAgentMemories((items) => [result.memory, ...items]);
    setNewMemory('');
  };

  const renameAgentMemory = async (memory: AssistantMemoryItem) => {
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
      const result = await assistantApi.updateMemory(memory.id, { content });
      setAgentMemories((items) => items.map((item) => item.id === memory.id ? result.memory : item));
      setRenameMemoryTarget(null);
    } finally {
      setRenamingMemory(false);
    }
  };

  const toggleAgentMemory = async (memory: AssistantMemoryItem) => {
    setToggleMemoryTarget({ memory, nextStatus: memory.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
  };

  const confirmToggleAgentMemory = async () => {
    if (!toggleMemoryTarget || togglingMemory) return;
    setTogglingMemory(true);
    try {
      const { memory, nextStatus } = toggleMemoryTarget;
      const result = await assistantApi.updateMemory(memory.id, { status: nextStatus });
      setAgentMemories((items) => items.map((item) => item.id === memory.id ? result.memory : item));
      setToggleMemoryTarget(null);
    } finally {
      setTogglingMemory(false);
    }
  };

  const deleteAgentMemory = async (memory: AssistantMemoryItem) => {
    setDeleteMemoryTarget(memory);
  };

  const confirmDeleteAgentMemory = async () => {
    if (!deleteMemoryTarget) return;
    await assistantApi.deleteMemory(deleteMemoryTarget.id);
    setAgentMemories((items) => items.filter((item) => item.id !== deleteMemoryTarget.id));
    setDeleteMemoryTarget(null);
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
  const conversationDrawer = conversationDrawerOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/25" onClick={() => setConversationDrawerOpen(false)}>
          <div className="absolute inset-y-0 left-0 flex w-[min(360px,90vw)] flex-col bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
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
  const memoryDrawer = memoryDrawerOpen && (
    <div className="fixed inset-0 z-[60] bg-slate-950/25" onClick={() => setMemoryDrawerOpen(false)}>
      <div className="absolute inset-y-0 right-0 flex w-[min(420px,92vw)] flex-col bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-4"><div><h2 className="text-lg font-black text-slate-950">{displayAgent.name}的长期记忆</h2><p className="mt-1 text-xs font-semibold text-slate-400">只属于这个 Agent</p></div><button type="button" onClick={() => setMemoryDrawerOpen(false)} className="rounded-full bg-[#fbfaf7] p-2 text-slate-500"><X size={18} /></button></div>
        <div className="mt-4 flex gap-2"><input value={newMemory} onChange={(event) => setNewMemory(event.target.value)} placeholder="添加一条长期记忆" className="min-w-0 flex-1 rounded-xl border border-black/[0.08] px-3 py-2 text-sm outline-none" /><button type="button" onClick={addAgentMemory} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white">添加</button></div>
        <div className="mt-4 flex-1 space-y-5 overflow-y-auto">{memoryLoading && <p className="py-8 text-center text-sm font-semibold text-slate-400">加载中...</p>}{!memoryLoading && <><section><h3 className="mb-2 text-xs font-black text-slate-400">专属长期记忆</h3>{agentMemories.length === 0 ? <p className="py-4 text-center text-sm font-semibold text-slate-400">还没有专属长期记忆。</p> : <div className="space-y-2">{agentMemories.map((memory) => <div key={memory.id} className="rounded-xl border border-black/[0.06] bg-[#fbfaf7] p-3"><p className={memory.status === 'ACTIVE' ? 'text-sm leading-6 text-slate-700' : 'text-sm leading-6 text-slate-400 line-through'}>{memory.content}</p><div className="mt-2 flex gap-3 text-xs font-bold text-slate-400"><button type="button" onClick={() => renameAgentMemory(memory)}>修改</button><button type="button" onClick={() => toggleAgentMemory(memory)}>{memory.status === 'ACTIVE' ? '停用' : '启用'}</button><button type="button" onClick={() => deleteAgentMemory(memory)} className="text-red-400">删除</button></div></div>)}</div>}</section><section><h3 className="mb-2 text-xs font-black text-slate-400">工作经历</h3>{agentExperiences.length === 0 ? <p className="py-4 text-center text-sm font-semibold text-slate-400">还没有已完成的工作经历。</p> : <div className="space-y-2">{agentExperiences.map((experience) => <article key={experience.id} className="rounded-xl border border-black/[0.06] bg-[#fbfaf7] p-3"><p className="text-sm font-bold text-slate-700">{experience.title}</p><p className="mt-1 text-sm leading-6 text-slate-500">{experience.summary}</p><p className="mt-2 text-[11px] font-semibold text-slate-400">{new Date(experience.createdAt).toLocaleDateString('zh-CN')}</p></article>)}</div>}</section></>}</div>
      </div>
    </div>
  );
  return (
    <>
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
      <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-r border-black/[0.06] bg-white/80 p-5 backdrop-blur lg:flex lg:flex-col">
        <button
          onClick={onBack}
          className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm hover:text-slate-950"
        >
          <ArrowLeft size={16} />
          返回
        </button>

        <div className="overflow-hidden rounded-[32px] border border-black/[0.06] bg-[#fbfaf7] shadow-sm">
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
          <div className="mb-5 border-b border-black/[0.06] pb-5">{conversationSwitcher}<button type="button" onClick={openMemoryDrawer} className="mt-3 w-full text-left text-xs font-black text-slate-700">管理这个 Agent 的长期记忆</button></div>
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
        <button
          onClick={onOpenMobileDetails}
          className="rounded-full border border-black/[0.06] bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm"
        >
          详情
        </button>
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
              <div className="border-b border-black/[0.06] pb-4">{conversationSwitcher}<button type="button" onClick={openMemoryDrawer} className="mt-3 w-full text-left text-xs font-black text-slate-700">管理这个 Agent 的长期记忆</button></div>
              <p className="rounded-2xl bg-[#fbfaf7] p-4 text-sm leading-6 text-slate-600">
                {displayAgent.description || '这个 Agent 会根据你的问题给出清晰、具体、可执行的帮助。'}
              </p>
              <AgentDetailBody displayAgent={displayAgent} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
