'use client';

import Avatar from '@/components/shared/Avatar';
import { cn } from '@/lib/utils';
import { RefreshCw } from 'lucide-react';

interface AgentAvatarPickerProps {
  value: string;
  options: string[];
  agentName: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
}

export default function AgentAvatarPicker({
  value,
  options,
  agentName,
  onChange,
  onRefresh,
}: AgentAvatarPickerProps) {
  return (
    <div className="flex w-[136px] flex-col items-center gap-3">
      <div className="rounded-2xl bg-slate-50 p-2">
        <Avatar src={value} alt={agentName || 'Agent'} size="lg" />
      </div>
      <div className="grid grid-cols-3 gap-1">
        {options.map((avatar, index) => {
          const selected = value === avatar;
          return (
            <button
              key={avatar}
              type="button"
              onClick={() => onChange(avatar)}
              aria-label={`选择头像 ${index + 1}`}
              aria-pressed={selected}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-xl border bg-white transition',
                selected
                  ? 'border-slate-950 ring-2 ring-slate-950/15'
                  : 'border-black/[0.06] hover:border-slate-300 hover:bg-slate-50'
              )}
            >
              <Avatar src={avatar} alt={`Agent ${index + 1}`} size="sm" />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        title="换一批头像"
        className="inline-flex h-9 w-fit items-center justify-center gap-1.5 rounded-full border border-black/[0.06] bg-white px-4 text-xs font-bold text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
      >
        <RefreshCw size={13} />
        换一批
      </button>
    </div>
  );
}
