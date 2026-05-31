'use client';

import AgentCard from './AgentCard';
import type { Agent } from '@/types';

interface AgentGridProps {
  agents: Agent[];
  onChat?: (agent: Agent) => void;
  onView?: (agent: Agent) => void;
  onFavorite?: (agent: Agent) => void;
  favorites?: Set<string>;
  variant?: 'default' | 'featured' | 'compact';
}

export default function AgentGrid({
  agents,
  onChat,
  onView,
  onFavorite,
  favorites = new Set(),
  variant = 'default',
}: AgentGridProps) {
  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 text-sm">
        暂无世界
      </div>
    );
  }

  const gridClasses = {
    default: 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4',
    featured: 'grid grid-cols-1 md:grid-cols-2 gap-4',
    compact: 'flex flex-col gap-2',
  };

  return (
    <div className={gridClasses[variant]}>
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          onChat={onChat}
          onView={onView}
          onFavorite={onFavorite}
          isFavorited={favorites.has(agent.id)}
          variant={variant}
        />
      ))}
    </div>
  );
}
