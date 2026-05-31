'use client';

import { ArrowRight, Heart, MapPin, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import Avatar from '@/components/shared/Avatar';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS, DIFFICULTY_LABELS } from '@/types';
import type { Agent } from '@/types';

interface AgentCardProps {
  agent: Agent;
  onChat?: (agent: Agent) => void;
  onView?: (agent: Agent) => void;
  onFavorite?: (agent: Agent) => void;
  isFavorited?: boolean;
  variant?: 'default' | 'featured' | 'compact';
  className?: string;
  showFavorite?: boolean;
}

const categoryIntents: Record<string, string> = {
  悬疑推理: '一桩谜案等你来破解',
  浪漫言情: '一段心跳加速的邂逅',
  奇幻冒险: '踏入未知的魔法世界',
  都市剧情: '都市里的人生百态',
  社交推理: '谁在说谎？找出真相',
  心理博弈: '一场心理层面的较量',
  喜剧搞笑: '轻松一刻，笑到停不下来',
  恐怖惊悚: '你敢踏入这片黑暗吗？',
  科幻探索: '探索宇宙的未知角落',
};

export default function AgentCard({
  agent,
  onChat,
  onView,
  onFavorite,
  isFavorited = false,
  variant = 'default',
  className,
  showFavorite = true,
}: AgentCardProps) {
  const category = agent.category || '都市剧情';
  const color = CATEGORY_COLORS[category] || '#6366f1';
  const intent = categoryIntents[category] || '一段等你开启的故事';

  if (variant === 'compact') {
    return (
      <button
        onClick={() => onChat?.(agent)}
        className={cn(
          'flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.08]',
          className
        )}
      >
        <Avatar src={agent.avatar} alt={agent.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{agent.name}</p>
          <p className="truncate text-xs text-white/54">{intent}</p>
        </div>
        <ArrowRight size={16} className="text-white/30" />
      </button>
    );
  }

  const isFeatured = variant === 'featured';

  return (
    <motion.article
      transition={{ duration: 0.2 }}
      className={cn(
        'relative flex min-h-[265px] cursor-default flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#242039] p-5 text-left shadow-sm',
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
          <div className="rounded-3xl bg-white/[0.08] p-2 ring-1 ring-white/[0.06]">
            <Avatar src={agent.avatar} alt={agent.name} size={isFeatured ? 'lg' : 'md'} />
          </div>
          <div className="min-w-0 flex-1">
            <button
              onClick={() => (onView || onChat)?.(agent)}
              className={cn(
                'inline-block max-w-full cursor-pointer truncate text-left font-black text-white transition hover:text-white/70 hover:underline hover:decoration-white/30 hover:underline-offset-4',
                isFeatured ? 'text-xl' : 'text-base'
              )}
            >
              {agent.name}
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-full px-2.5 py-1 text-xs font-bold text-white"
                style={{ backgroundColor: color }}
              >
                {category}
              </span>
              {agent.tone && (
                <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-semibold text-white/64">
                  {agent.tone}
                </span>
              )}
              {agent.difficulty && (
                <span className="rounded-full bg-[#d89022]/20 px-2.5 py-1 text-xs font-semibold text-[#d89022]">
                  {DIFFICULTY_LABELS[agent.difficulty] || agent.difficulty}
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
              'shrink-0 cursor-pointer rounded-full p-2 transition',
              isFavorited ? 'bg-rose-500/20 text-rose-400' : 'bg-white/[0.08] text-white/30 hover:text-rose-400'
            )}
            aria-label="收藏"
          >
            <Heart size={18} fill={isFavorited ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      <p className={cn('relative mt-5 text-sm leading-6 text-white/58', isFeatured ? 'line-clamp-3' : 'line-clamp-2')}>
        {agent.description}
      </p>

      <div className="relative mt-5 rounded-2xl bg-white/[0.06] px-4 py-3 text-sm text-white/70">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-white/40">
          <MapPin size={13} />
          故事入口
        </div>
        <p className="line-clamp-2">"{intent}"</p>
      </div>

      <div className="relative mt-auto flex items-center justify-between gap-3 pt-5">
        <div className="min-w-0 text-xs font-semibold leading-tight text-white/40">
          {category}
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onChat?.(agent);
          }}
          className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-bold text-[#19172a] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <Sparkles size={16} />
          开始冒险
        </button>
      </div>
    </motion.article>
  );
}
