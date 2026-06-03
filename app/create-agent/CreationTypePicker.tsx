import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CREATION_TYPES } from './constants';
import type { CreationType } from './types';

type CreationTypePickerProps = {
  creationType: CreationType | null;
  onSelect: (type: CreationType) => void;
};

export default function CreationTypePicker({
  creationType,
  onSelect,
}: CreationTypePickerProps) {
  if (creationType) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-6 text-2xl font-black text-white">选择创作类型</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CREATION_TYPES.map((type) => {
          const enabled = type.id === 'mystery' || type.id === 'character';

          return (
            <button
              key={type.id}
              disabled={!enabled}
              onClick={() => {
                if (!enabled) return;
                onSelect(type.id);
              }}
              className={cn(
                'group rounded-[28px] border border-white/10 bg-[#242039] p-6 text-left transition',
                enabled
                  ? 'hover:-translate-y-1 hover:border-white/20 hover:shadow-xl'
                  : 'cursor-not-allowed opacity-45'
              )}
            >
              <div
                className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-3xl"
                style={{ backgroundColor: `${type.color}20` }}
              >
                {type.icon}
              </div>
              <h3 className="mb-2 text-lg font-black text-white">{type.name}</h3>
              <p className="text-sm leading-6 text-white/54">{type.description}</p>
              <div className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-white/40 transition group-hover:text-white/70">
                {enabled ? '开始创作' : '即将开放'}
                <ChevronRight size={14} />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
