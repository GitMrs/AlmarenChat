import { Check, Eye, Lock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import CreationStagePanel, { type CreationStage } from './CreationStagePanel';

type PublishCheck = {
  label: string;
  done: boolean;
};

type MysteryPublishPanelProps = {
  name: string;
  description: string;
  category: string;
  tone: string;
  categoryColor: string;
  selectedAvatar: string;
  isPublic: boolean;
  completedSections: number;
  publishChecks: PublishCheck[];
  suspects: any[];
  clues: any[];
  truth: any;
  canCreate: boolean;
  publishBlockedReason?: string;
  submitting: boolean;
  editingAgentId: string | null;
  mysteryReady: boolean;
  stages: CreationStage[];
  onStageStatusChange: (stageId: string, status: CreationStage['status'] | null) => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPublicChange: (value: boolean) => void;
  onOpenTestChat: () => void;
  onSubmit: () => void;
};

export default function MysteryPublishPanel({
  name,
  description,
  category,
  tone,
  categoryColor,
  selectedAvatar,
  isPublic,
  completedSections,
  publishChecks,
  suspects,
  clues,
  truth,
  canCreate,
  publishBlockedReason,
  submitting,
  editingAgentId,
  mysteryReady,
  stages,
  onStageStatusChange,
  onNameChange,
  onDescriptionChange,
  onPublicChange,
  onOpenTestChat,
  onSubmit,
}: MysteryPublishPanelProps) {
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#242039]">
        <div className="h-2 bg-[#6366f1]" />
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/64">
              <Eye size={14} />
              创建检查
            </div>
            <button
              onClick={() => onPublicChange(!isPublic)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition',
                isPublic ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.08] text-white/64'
              )}
            >
              {isPublic ? <Check size={14} /> : <Lock size={14} />}
              {isPublic ? '公开' : '私有'}
            </button>
          </div>

          <CreationStagePanel title="创作阶段" stages={stages} onStageStatusChange={onStageStatusChange} />

          <div className="mb-4 rounded-[24px] bg-white/[0.06] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-black text-white">完成度</div>
              <div className="text-xs font-bold text-white/40">{completedSections}/4</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {publishChecks.map((item) => (
                <div
                  key={item.label}
                  className={cn(
                    'rounded-2xl px-3 py-2 text-xs font-bold',
                    item.done ? 'bg-emerald-500/14 text-emerald-300' : 'bg-white/[0.06] text-white/36'
                  )}
                >
                  {item.done ? '已完成' : '待补全'}
                  {item.label}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-white/[0.06] p-4">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.08] text-3xl">
                {selectedAvatar}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-xl font-black text-white">{name || '未命名体验'}</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ backgroundColor: categoryColor }}>
                    {category}
                  </span>
                  <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-bold text-white/64">
                    {tone}
                  </span>
                </div>
              </div>
            </div>

            <p className="min-h-[48px] text-sm leading-6 text-white/64">
              {description || '写一句话，吸引玩家进入这个体验。'}
            </p>

            {suspects.length > 0 && (
              <div className="mt-4 rounded-2xl bg-white/[0.08] p-4">
                <div className="mb-2 text-xs font-bold text-white/40">嫌疑人 ({suspects.length})</div>
                <div className="flex flex-wrap gap-1">
                  {suspects.map((suspect, index) => (
                    <span key={index} className="rounded-full bg-white/[0.08] px-2 py-0.5 text-xs text-white/64">
                      {suspect.name || '未命名'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {clues.length > 0 && (
              <div className="mt-3 rounded-2xl bg-white/[0.08] p-4">
                <div className="mb-1 text-xs font-bold text-white/40">线索 ({clues.length})</div>
              </div>
            )}

            {truth?.killer && (
              <div className="mt-3 rounded-2xl bg-white/[0.08] p-4">
                <div className="mb-1 text-xs font-bold text-white/40">凶手</div>
                <p className="text-sm text-white/70">{truth.killer}</p>
              </div>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-white/70">名称</span>
              <input
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="体验名称"
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-white/70">简介</span>
              <input
                value={description}
                onChange={(event) => onDescriptionChange(event.target.value)}
                placeholder="一句话简介"
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={onOpenTestChat}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.08] text-sm font-black text-white/72 transition hover:-translate-y-0.5 hover:bg-white/[0.12]"
          >
            <Eye size={16} />
            测试对话
          </button>
          <p className="mt-2 text-center text-xs text-white/38">临时测试，不保存聊天记录</p>

          <button
            onClick={onSubmit}
            disabled={!canCreate || submitting}
            className={cn(
              'mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-black transition',
              canCreate && !submitting
                ? 'bg-white text-[#19172a] shadow-sm hover:-translate-y-0.5 hover:shadow-lg'
                : 'bg-white/[0.08] text-white/30'
            )}
          >
            <Sparkles size={16} />
            {submitting ? '保存中...' : editingAgentId ? '保存修改' : '创建体验'}
          </button>
          {publishBlockedReason && (
            <p className="mt-2 text-center text-xs text-amber-300/80">
              {publishBlockedReason}
            </p>
          )}
          {!canCreate && !publishBlockedReason && !mysteryReady && (
            <p className="mt-2 text-center text-xs text-white/40">
              请完成上方 4 项检查后再创建
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
