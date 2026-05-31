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
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-white/[0.06] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-xs font-black text-white/54">
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
          className="h-8 w-16 rounded-xl border border-white/10 bg-white/[0.08] px-2 text-center text-sm font-black text-white outline-none focus:border-white/20"
        />
        <div className="whitespace-nowrap text-xs font-semibold text-white/40">/ {max} 条</div>
      </div>
    </div>
  );
}

function WorldDetailBody({ displayAgent }: { displayAgent: DisplayAgent }) {
  return (
    <>
      <div>
        <p className="text-xs font-bold text-white/40">开场白</p>
        <p className="mt-2 rounded-2xl bg-white/[0.06] p-4 text-sm leading-6 text-white/64">
          {displayAgent.greeting || `欢迎来到${displayAgent.name}。你的冒险从这里开始。`}
        </p>
      </div>
      <div>
        <p className="text-xs font-bold text-white/40">世界设定</p>
        <div className="markdown-body mt-2 rounded-2xl bg-white/[0.06] p-4 text-xs leading-5 text-white/54">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {'这个世界等待你来探索和定义。'}
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
      <aside className="hidden w-[340px] shrink-0 border-r border-white/10 bg-[#19172a]/80 p-5 backdrop-blur lg:flex lg:flex-col">
        <button
          onClick={onBack}
          className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70 hover:text-white"
        >
          <ArrowLeft size={16} />
          返回
        </button>

        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#242039]">
          <div className="h-2" style={{ backgroundColor: categoryColor }} />
          <div className="p-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-white/[0.08]">
              <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="lg" />
            </div>
            <h1 className="mt-3 line-clamp-2 text-xl font-black leading-tight text-white">{displayAgent.name}</h1>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ backgroundColor: categoryColor }}>
                {displayAgent.category || '世界'}
              </span>
              {displayAgent.tone && (
                <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-bold text-white/64">
                  {displayAgent.tone}
                </span>
              )}
            </div>
            <p className="mx-auto mt-3 line-clamp-2 max-w-[240px] text-sm leading-6 text-white/58">
              {displayAgent.description}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-[28px] border border-white/10 bg-[#242039] p-5">
          {isLoggedIn && (
            <ContextLimitControl
              value={contextMessageLimit}
              max={maxContextMessageLimit}
              onChange={onContextMessageLimitChange}
            />
          )}

          <button onClick={onToggleDetails} className="flex w-full items-center justify-between text-left">
            <div>
              <h2 className="text-lg font-black text-white">世界详情</h2>
              <p className="mt-1 text-sm leading-6 text-white/54">查看开场白、世界设定和故事规则。</p>
            </div>
            <div className="rounded-full bg-white/[0.08] p-2 text-white/54">
              {detailsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </div>
          </button>

          {detailsOpen && (
            <div className="mt-5 max-h-[calc(100vh-430px)] min-h-0 space-y-4 overflow-y-auto border-t border-white/10 pt-5 pr-1">
              <WorldDetailBody displayAgent={displayAgent} />
            </div>
          )}
        </div>
      </aside>

      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-[#19172a]/86 px-4 py-3 backdrop-blur lg:hidden">
        <button onClick={onBack} className="rounded-full p-2 hover:bg-white/[0.08]">
          <ArrowLeft size={20} />
        </button>
        <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-black text-white">{displayAgent.name}</h1>
          <p className="text-xs font-medium text-white/40">{displayAgent.category} · {displayAgent.tone}</p>
        </div>
        <button
          onClick={onOpenMobileDetails}
          className="rounded-full border border-white/10 bg-white/[0.08] px-3 py-2 text-xs font-black text-white/70"
        >
          详情
        </button>
      </header>

      {mobileDetailsOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden">
          <div className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-hidden rounded-t-[32px] bg-[#242039]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar src={displayAgent.avatar} alt={displayAgent.name} size="sm" />
                <div className="min-w-0">
                  <h2 className="truncate text-base font-black text-white">{displayAgent.name}</h2>
                  <p className="text-xs font-bold text-white/40">
                    {displayAgent.category || '世界'} · {displayAgent.tone || '默认氛围'}
                  </p>
                </div>
              </div>
              <button onClick={onCloseMobileDetails} className="rounded-full bg-white/[0.08] p-2 text-white/54">
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
              <p className="rounded-2xl bg-white/[0.06] p-4 text-sm leading-6 text-white/64">
                {displayAgent.description || '一个等待你探索的故事世界。'}
              </p>
              <WorldDetailBody displayAgent={displayAgent} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
