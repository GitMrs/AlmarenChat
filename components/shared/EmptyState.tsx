'use client';

import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export default function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-20 px-4', className)}>
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-5">
        <Icon size={28} className="text-gray-400" />
      </div>
      <h3 className="text-base font-semibold text-gray-800 mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 text-center max-w-xs mb-5 leading-relaxed">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors duration-200 cursor-pointer shadow-sm shadow-primary-200"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
