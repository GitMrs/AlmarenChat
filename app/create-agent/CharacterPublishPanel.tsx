import { Check, Eye, Lock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AVATAR_OPTIONS } from './constants';

type CharacterPublishPanelProps = {
  name: string;
  description: string;
  tone: string;
  selectedAvatar: string;
  isPublic: boolean;
  characterIdentity: string;
  characterSpeakingStyle: string;
  characterWorldNotes: string[];
  characterSkillCards: any[];
  roleplayStoryTitle: string;
  roleplayPlayerRole: string;
  roleplayObjective: string;
  finalGreeting: string;
  canCreate: boolean;
  submitting: boolean;
  editingAgentId: string | null;
  onAvatarChange: (avatar: string) => void;
  onPublicChange: (value: boolean) => void;
  onOpenTestChat: () => void;
  onSubmit: () => void;
};

export default function CharacterPublishPanel({
  name,
  description,
  tone,
  selectedAvatar,
  isPublic,
  characterIdentity,
  characterSpeakingStyle,
  characterWorldNotes,
  characterSkillCards,
  roleplayStoryTitle,
  roleplayPlayerRole,
  roleplayObjective,
  finalGreeting,
  canCreate,
  submitting,
  editingAgentId,
  onAvatarChange,
  onPublicChange,
  onOpenTestChat,
  onSubmit,
}: CharacterPublishPanelProps) {
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#242039]">
        <div className="h-2 bg-[#8b5cf6]" />
        <div className="p-6">
          <div className="mb-5 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/64">
              <Eye size={14} />
              角色预览
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

          <div className="rounded-[28px] bg-white/[0.06] p-5">
            <div className="mb-5 flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.08] text-4xl">
                {selectedAvatar}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-xl font-black text-white">{name || '未命名角色'}</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-[#8b5cf6] px-2.5 py-1 text-xs font-bold text-white">
                    角色扮演
                  </span>
                  <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-bold text-white/64">
                    {tone}
                  </span>
                </div>
              </div>
            </div>
            <p className="line-clamp-2 text-sm leading-6 text-white/64">
              {description || characterIdentity || '填写角色简介后，这里会展示给玩家。'}
            </p>
            {(roleplayStoryTitle || roleplayPlayerRole || roleplayObjective) && (
              <div className="mt-3 rounded-2xl bg-white/[0.08] p-3">
                <div className="mb-1 text-xs font-bold text-white/40">故事入口</div>
                <p className="truncate text-sm font-bold text-white/78">{roleplayStoryTitle || '未命名故事'}</p>
                {roleplayPlayerRole && (
                  <p className="mt-1 truncate text-xs leading-5 text-white/52">玩家：{roleplayPlayerRole}</p>
                )}
                {roleplayObjective && (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/52">目标：{roleplayObjective}</p>
                )}
              </div>
            )}
            {characterSpeakingStyle && (
              <div className="mt-3 rounded-2xl bg-white/[0.08] p-3">
                <div className="mb-1 text-xs font-bold text-white/40">说话方式</div>
                <p className="line-clamp-2 text-sm leading-6 text-white/68">{characterSpeakingStyle}</p>
              </div>
            )}
            {(characterWorldNotes.length > 0 || characterSkillCards.length > 0) && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white/[0.08] px-3 py-2">
                  <div className="text-xs font-bold text-white/40">世界资料</div>
                  <div className="mt-1 text-lg font-black text-white">{characterWorldNotes.length}</div>
                </div>
                <div className="rounded-2xl bg-white/[0.08] px-3 py-2">
                  <div className="text-xs font-bold text-white/40">技能卡</div>
                  <div className="mt-1 text-lg font-black text-white">{characterSkillCards.length}</div>
                </div>
              </div>
            )}
            <div className="mt-3 rounded-2xl bg-white/[0.08] p-3">
              <div className="mb-1 text-xs font-bold text-white/40">开场白</div>
              <p className="line-clamp-3 text-sm leading-6 text-white/68">{finalGreeting}</p>
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-2 text-sm font-bold text-white/70">头像</div>
            <div className="grid grid-cols-8 gap-2">
              {AVATAR_OPTIONS.slice(0, 8).map((avatar) => (
                <button
                  key={avatar}
                  onClick={() => onAvatarChange(avatar)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-xl text-lg transition',
                    selectedAvatar === avatar ? 'bg-white text-[#19172a]' : 'bg-white/[0.08] hover:bg-white/[0.12]'
                  )}
                >
                  {avatar}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenTestChat}
              className="flex h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.08] text-sm font-black text-white/72 transition hover:-translate-y-0.5 hover:bg-white/[0.12]"
            >
              <Eye size={16} />
              测试
            </button>
            <button
              onClick={onSubmit}
              disabled={!canCreate || submitting}
              className={cn(
                'flex h-11 items-center justify-center gap-2 rounded-full text-sm font-black transition',
                canCreate && !submitting
                  ? 'bg-white text-[#19172a] shadow-sm hover:-translate-y-0.5 hover:shadow-lg'
                  : 'bg-white/[0.08] text-white/30'
              )}
            >
              <Sparkles size={16} />
              {submitting ? '保存中' : editingAgentId ? '保存' : '创建'}
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-white/38">测试对话不会保存</p>
          {!canCreate && (
            <p className="mt-2 text-center text-xs text-white/40">
              请至少填写名称、简介、身份、性格和说话方式
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
