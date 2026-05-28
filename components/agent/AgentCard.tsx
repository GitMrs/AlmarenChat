'use client';

import { ArrowRight, Heart, MessageCircle, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import Avatar from '@/components/shared/Avatar';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS } from '@/types';
import type { Agent } from '@/types';

interface AgentCardProps {
  agent: Agent;
  onChat?: (agent: Agent) => void;
  onFavorite?: (agent: Agent) => void;
  isFavorited?: boolean;
  variant?: 'default' | 'featured' | 'compact';
  className?: string;
  showFavorite?: boolean;
}

const categoryIntents: Record<string, string> = {
  写作: '帮你把想法变成能发布的内容',
  编程: '一起拆问题、看代码、做方案',
  学习: '把复杂知识讲到你听懂为止',
  心理: '陪你慢慢梳理情绪和选择',
  创意: '给灵感一点火花和方向',
  生活: '处理日常里的小麻烦',
  工具: '把重复工作变简单',
  娱乐: '轻松一点，玩点不一样的',
};

export default function AgentCard({
  agent,
  onChat,
  onFavorite,
  isFavorited = false,
  variant = 'default',
  className,
  showFavorite = true,
}: AgentCardProps) {
  const category = agent.category || '工具';
  const color = CATEGORY_COLORS[category] || '#2563eb';
  const intent = categoryIntents[category] || '随时准备帮你处理问题';

  if (variant === 'compact') {
    return (
      <button
        onClick={() => onChat?.(agent)}
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl border border-black/[0.06] bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
          className
        )}
      >
        <Avatar src={agent.avatar} alt={agent.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-950">{agent.name}</p>
          <p className="truncate text-xs text-slate-500">{intent}</p>
        </div>
        <ArrowRight size={16} className="text-slate-300" />
      </button>
    );
  }

  const isFeatured = variant === 'featured';

  return (
    <motion.article
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      onClick={() => onChat?.(agent)}
      className={cn(
        'group relative flex min-h-[265px] cursor-pointer flex-col overflow-hidden rounded-[24px] border border-black/[0.07] bg-white p-5 text-left shadow-sm transition hover:shadow-xl',
        isFeatured && 'min-h-[300px] p-6',
        className
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ backgroundColor: color }}
      />
      <div
        className="absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-10 blur-2xl"
        style={{ backgroundColor: color }}
      />
      <div
        className="absolute bottom-0 left-0 h-24 w-24 rounded-full opacity-[0.06] blur-2xl"
        style={{ backgroundColor: color }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="rounded-3xl bg-slate-50 p-2 ring-1 ring-black/[0.04]">
            <Avatar src={agent.avatar} alt={agent.name} size={isFeatured ? 'lg' : 'md'} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={cn('truncate font-black text-slate-950', isFeatured ? 'text-xl' : 'text-base')}>
              {agent.name}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full px-2.5 py-1 text-xs font-bold text-white"
                style={{ backgroundColor: color }}
              >
                {category}
              </span>
              {agent.tone && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {agent.tone}
                </span>
              )}
            </div>
          </div>
        </div>

        {showFavorite && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onFavorite?.(agent);
            }}
            className={cn(
              'shrink-0 rounded-full p-2 transition',
              isFavorited ? 'bg-rose-50 text-rose-500' : 'bg-white/80 text-slate-300 hover:text-rose-400'
            )}
            aria-label="收藏 Agent"
          >
            <Heart size={18} fill={isFavorited ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      <p className={cn('relative mt-5 text-sm leading-6 text-slate-600', isFeatured ? 'line-clamp-3' : 'line-clamp-2')}>
        {agent.description}
      </p>

      <div className="relative mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-400">
          <Sparkles size={13} />
          适合这样开始
        </div>
        <p className="line-clamp-2">“{intent}”</p>
      </div>

      <div className="relative mt-auto flex items-center justify-between gap-3 pt-5">
        <div className="min-w-0 text-xs font-semibold leading-tight text-slate-400">
          Agent<br className="sm:hidden" /> 身份卡
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onChat?.(agent);
          }}
          className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm transition group-hover:translate-x-0.5"
        >
          <MessageCircle size={16} />
          开始聊天
        </button>
      </div>
    </motion.article>
  );
}
