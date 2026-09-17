import React from 'react';
import { BookOpen, CheckCircle, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SkillPreset, WorkspaceSkill } from '../../types';

interface InstallSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillModalTab: 'presets' | 'custom';
  setSkillModalTab: (tab: 'presets' | 'custom') => void;
  skillPresets: SkillPreset[];
  workspaceSkills: WorkspaceSkill[];
  isSubmittingSkill: boolean;
  handleInstallPreset: (presetId: string) => void;
  newSkillName: string;
  setNewSkillName: (v: string) => void;
  newSkillDesc: string;
  setNewSkillDesc: (v: string) => void;
  newSkillContent: string;
  setNewSkillContent: (v: string) => void;
  handleCreateCustomSkill: () => void;
}

export const InstallSkillModal: React.FC<InstallSkillModalProps> = ({
  isOpen,
  onClose,
  skillModalTab,
  setSkillModalTab,
  skillPresets,
  workspaceSkills,
  isSubmittingSkill,
  handleInstallPreset,
  newSkillName,
  setNewSkillName,
  newSkillDesc,
  setNewSkillDesc,
  newSkillContent,
  setNewSkillContent,
  handleCreateCustomSkill,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-white border border-black/[0.08] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 text-slate-900">
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-amber-500" />
            <h3 className="text-base font-bold text-slate-900">安装与创建工作区技能</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xs cursor-pointer"
          >
            关闭
          </button>
        </div>

        {/* Tab switch: Presets vs Custom */}
        <div className="flex items-center gap-2 border-b border-black/[0.06] pb-2">
          <button
            type="button"
            onClick={() => setSkillModalTab('presets')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
              skillModalTab === 'presets'
                ? 'bg-amber-50 text-amber-800 border border-amber-200/80 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800 hover:bg-black/[0.03]'
            )}
          >
            官方推荐预设库
          </button>
          <button
            type="button"
            onClick={() => setSkillModalTab('custom')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
              skillModalTab === 'custom'
                ? 'bg-amber-50 text-amber-800 border border-amber-200/80 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800 hover:bg-black/[0.03]'
            )}
          >
            自定义编写技能
          </button>
        </div>

        {skillModalTab === 'presets' ? (
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {skillPresets.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">加载中...</div>
            ) : (
              skillPresets.map((preset) => {
                const isInstalled = workspaceSkills.some((s) => s.id === preset.id);
                return (
                  <div
                    key={preset.id}
                    className="p-3 rounded-xl bg-[#fbfaf7] border border-black/[0.06] hover:border-black/[0.12] transition-all flex items-start justify-between gap-3 shadow-2xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900 font-mono">
                          {preset.id}
                        </span>
                        <span className="text-[10px] text-slate-500 truncate">{preset.name}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        {preset.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleInstallPreset(preset.id)}
                      disabled={isInstalled || isSubmittingSkill}
                      className={cn(
                        'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 cursor-pointer flex items-center gap-1',
                        isInstalled
                          ? 'bg-slate-100 text-slate-400 border border-black/[0.06] cursor-not-allowed'
                          : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 border border-amber-500/25 shadow-2xs font-semibold'
                      )}
                    >
                      {isInstalled ? (
                        <>
                          <CheckCircle size={11} className="text-emerald-600" />
                          <span>已安装</span>
                        </>
                      ) : (
                        <>
                          <Download size={11} />
                          <span>一键安装</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateCustomSkill();
            }}
            className="space-y-3 text-xs"
          >
            <div className="space-y-1">
              <label className="font-semibold text-slate-800">技能目录英文标识 (ID)</label>
              <input
                type="text"
                value={newSkillName}
                onChange={(e) => setNewSkillName(e.target.value)}
                placeholder="如: custom-parser, doc-generator"
                className="w-full bg-[#fbfaf7] border border-black/[0.1] rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white font-mono shadow-2xs"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-800">功能简述</label>
              <input
                type="text"
                value={newSkillDesc}
                onChange={(e) => setNewSkillDesc(e.target.value)}
                placeholder="简要说明该技能的作用与触发场景..."
                className="w-full bg-[#fbfaf7] border border-black/[0.1] rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white shadow-2xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-800">SKILL.md 提示词与实现内容</label>
              <textarea
                value={newSkillContent}
                onChange={(e) => setNewSkillContent(e.target.value)}
                placeholder="输入技能规范说明、调用指令与步骤要求（遵循标准 Agent Skills 规范）..."
                rows={6}
                className="w-full bg-[#fbfaf7] border border-black/[0.1] rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white font-mono text-[11px] leading-relaxed resize-none shadow-2xs"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!newSkillName.trim() || isSubmittingSkill}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {isSubmittingSkill && <Loader2 size={12} className="animate-spin" />}
                <span>创建技能并加载</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
