'use client';

import { cn } from '@/lib/utils';
import { AGENT_CATEGORIES, CATEGORY_COLORS } from '@/types';

interface CategoryFilterProps {
  selected: string;
  onSelect: (category: string) => void;
  className?: string;
}

export default function CategoryFilter({ selected, onSelect, className }: CategoryFilterProps) {
  return (
    <div className={cn('flex gap-2 overflow-x-auto pb-2 scrollbar-hide', className)}>
      {AGENT_CATEGORIES.map((cat) => {
        const isActive = selected === cat;
        const color = CATEGORY_COLORS[cat];
        return (
          <button
            key={cat}
            onClick={() => onSelect(cat)}
            className={cn(
              'flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer',
              isActive
                ? 'text-white shadow-md'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200 hover:border-gray-300'
            )}
            style={isActive ? { backgroundColor: color || '#1e293b' } : undefined}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}
