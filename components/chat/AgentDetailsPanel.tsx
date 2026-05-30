'use client';

import { ArrowLeft, ChevronDown, ChevronUp, SlidersHorizontal, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Avatar from '@/components/shared/Avatar';
import type { DisplayAgent } from '@/components/chat/ChatMessageItem';

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
}: AgentDetailsPanelProps) {
  return (
    <>
      <aside className="hidden w-[340px] shrink-0 border-r border-black/[0.06] bg-white/80 p-5 backdrop-blur lg:flex lg:flex-col">
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
