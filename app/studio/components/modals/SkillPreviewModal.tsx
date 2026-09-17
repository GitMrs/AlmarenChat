import React from 'react';
import { BookOpen, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WorkspaceSkill } from '../../types';

interface SkillPreviewModalProps {
  skill: WorkspaceSkill | null;
  onClose: () => void;
  onCopy: (content: string) => void;
}

export const SkillPreviewModal: React.FC<SkillPreviewModalProps> = ({ skill, onClose, onCopy }) => {
  if (!skill) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white border border-black/[0.08] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 text-slate-900">
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
          <div className="flex items-center gap-2">
            <BookOpen size={17} className="text-amber-500" />
            <h3 className="text-base font-bold text-slate-900">技能定义: {skill.name}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xs cursor-pointer"
          >
            关闭
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-mono text-[11px] text-slate-500">
              路径: .pi/skills/{skill.id}/SKILL.md
            </span>
            <span
              className={cn(
                'text-[10px] px-2 py-0.5 rounded-full font-mono font-medium',
                skill.enabled
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-slate-100 text-slate-500 border border-black/[0.06]'
              )}
            >
              {skill.enabled ? '已启用' : '已禁用'}
            </span>
          </div>

          <pre className="p-3 rounded-xl bg-slate-50 border border-black/[0.06] text-[11px] font-mono text-slate-800 overflow-x-auto max-h-80 leading-relaxed whitespace-pre-wrap select-text shadow-2xs">
            {skill.content || '(无定义内容)'}
          </pre>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/[0.06]">
          <button
            onClick={() => onCopy(skill.content || '')}
            className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-black/[0.08] text-xs text-slate-700 shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Copy size={12} />
            <span>复制技能源码</span>
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 transition-colors cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
