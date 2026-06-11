import { Check, Circle, LockKeyhole, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CreationStageStatus = 'draft' | 'approved' | 'revision' | 'locked';

export type CreationStage = {
  id: string;
  title: string;
  description: string;
  status: CreationStageStatus;
};

const statusMeta: Record<CreationStageStatus, { label: string; icon: React.ReactNode; className: string }> = {
  draft: {
    label: '草稿',
    icon: <Circle size={13} />,
    className: 'bg-white/[0.06] text-white/42',
  },
  approved: {
    label: '已确认',
    icon: <Check size={13} />,
    className: 'bg-emerald-500/14 text-emerald-300',
  },
  revision: {
    label: '需修改',
    icon: <RotateCcw size={13} />,
    className: 'bg-amber-500/14 text-amber-300',
  },
  locked: {
    label: '已锁定',
    icon: <LockKeyhole size={13} />,
    className: 'bg-sky-500/14 text-sky-300',
  },
};

export default function CreationStagePanel({
  title,
  stages,
  onStageStatusChange,
}: {
  title: string;
  stages: CreationStage[];
  onStageStatusChange?: (stageId: string, status: CreationStageStatus | null) => void;
}) {
  return (
    <div className="mb-4 rounded-[24px] bg-white/[0.06] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-black text-white">{title}</div>
        <div className="text-xs font-bold text-white/40">
          {stages.filter((stage) => stage.status === 'approved' || stage.status === 'locked').length}/{stages.length}
        </div>
      </div>
      <div className="space-y-2">
        {stages.map((stage) => {
          const meta = statusMeta[stage.status];

          return (
            <div key={stage.id} className="rounded-2xl bg-white/[0.05] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-black text-white/76">{stage.title}</div>
                  <div className="mt-0.5 truncate text-xs text-white/36">{stage.description}</div>
                </div>
                <div className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-black', meta.className)}>
                  {meta.icon}
                  {meta.label}
                </div>
              </div>
              {onStageStatusChange && (
                <div className="mt-2 flex gap-2">
                  {stage.status !== 'locked' && (
                    <button
                      type="button"
                      onClick={() => onStageStatusChange(stage.id, stage.status === 'approved' ? 'locked' : 'approved')}
                      className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-bold text-white/52 transition hover:bg-white/[0.12] hover:text-white/76"
                    >
                      {stage.status === 'approved' ? '锁定' : '确认'}
                    </button>
                  )}
                  {stage.status !== 'draft' && (
                    <button
                      type="button"
                      onClick={() => onStageStatusChange(stage.id, null)}
                      className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] font-bold text-white/34 transition hover:bg-white/[0.1] hover:text-white/60"
                    >
                      回草稿
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
