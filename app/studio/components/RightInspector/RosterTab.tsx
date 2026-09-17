import React from 'react';
import {
  BookOpen,
  Plus,
  RefreshCw,
  Loader2,
  Power,
  Eye,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { WorkspaceSkill, SkillPreset, StudioWorkspaceItem } from '../../types';

interface RosterTabProps {
  userProfile: any;
  isStreaming: boolean;
  workspaceSkills: WorkspaceSkill[];
  isLoadingSkills: boolean;
  skillPresets: SkillPreset[];
  activeWorkspace?: StudioWorkspaceItem;
  setShowSkillModal: (v: boolean) => void;
  setSkillModalTab: (tab: 'presets' | 'custom') => void;
  fetchWorkspaceSkills: () => void;
  handleInstallPreset: (id: string) => void;
  handleToggleSkill: (id: string, currentEnabled: boolean) => void;
  setPreviewingSkill: (skill: WorkspaceSkill) => void;
  handleDeleteSkill: (id: string, name: string) => void;
  setEditWsName: (v: string) => void;
  setEditWsDesc: (v: string) => void;
  setEditWsPrompt: (v: string) => void;
  setShowRulesModal: (v: boolean) => void;
}

export const RosterTab: React.FC<RosterTabProps> = ({
  userProfile,
  isStreaming,
  workspaceSkills,
  isLoadingSkills,
  skillPresets,
  activeWorkspace,
  setShowSkillModal,
  setSkillModalTab,
  fetchWorkspaceSkills,
  handleInstallPreset,
  handleToggleSkill,
  setPreviewingSkill,
  handleDeleteSkill,
  setEditWsName,
  setEditWsDesc,
  setEditWsPrompt,
  setShowRulesModal,
}) => {
  return (
    <div className="space-y-4">
      {/* Coordinator Card */}
      <div className="bg-white border border-black/[0.06] rounded-xl p-3 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-base">
              🤖
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <span>Almaren 协调总指挥官</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 border border-indigo-200/60 font-mono font-medium">
                  Coordinator
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono">
                {userProfile?.modelName || '默认账号模型'}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{isStreaming ? '规划中' : '在线就绪'}</span>
          </span>
        </div>
        <p className="text-[11px] text-slate-600 leading-relaxed border-t border-black/[0.06] pt-2">
          负责感知当前沙箱项目、拆解架构任务、指派子 Agent 并把控全局交付。
        </p>
      </div>

      {/* Worker Agents: Pi */}
      <div className="bg-white border border-black/[0.06] rounded-xl p-3 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-base">
              ⚡
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <span>Pi 编码智能体</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-mono font-medium">
                  Worker
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono">Custom CLI Agent</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-black/[0.06] font-medium">
            <span>就绪</span>
          </span>
        </div>
        <p className="text-[11px] text-slate-600 leading-relaxed border-t border-black/[0.06] pt-2">
          负责写入代码、安装依赖、运行单元测试，自动索引{' '}
          <code className="text-emerald-700 font-mono bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200/60">
            .pi/skills/
          </code>{' '}
          技能。
        </p>
      </div>

      {/* Workspace Skills Management Pool */}
      <div className="bg-white border border-black/[0.06] rounded-xl p-3 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
            <BookOpen size={14} className="text-amber-500" />
            <span>工作区技能库 (Skills)</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-slate-100 text-slate-600 border border-black/[0.06]">
              {workspaceSkills.filter((s) => s.enabled).length}/{workspaceSkills.length} 启用
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setSkillModalTab('presets');
                setShowSkillModal(true);
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 border border-amber-500/25 text-[10px] font-medium transition-colors cursor-pointer"
              title="安装或创建技能"
            >
              <Plus size={11} />
              <span>安装技能</span>
            </button>
            <button
              onClick={() => fetchWorkspaceSkills()}
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-black/[0.04] transition-colors cursor-pointer"
              title="刷新技能列表"
            >
              <RefreshCw size={11} className={isLoadingSkills ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {isLoadingSkills && workspaceSkills.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-slate-400 text-xs">
            <Loader2 size={15} className="animate-spin text-amber-500 mr-2" />
            <span>正在扫描工作区技能...</span>
          </div>
        ) : workspaceSkills.length === 0 ? (
          <div className="p-3 rounded-lg bg-[#fbfaf7] border border-black/[0.06] text-center space-y-2">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              当前沙箱尚未安装扩展技能。智能体可自主在对话中安装，您也可以一键添加常用技能。
            </p>
            <div className="flex items-center justify-center gap-1.5 flex-wrap pt-1">
              {skillPresets.slice(0, 2).map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleInstallPreset(p.id)}
                  className="text-[10px] px-2 py-1 rounded bg-white hover:bg-slate-50 text-amber-700 border border-black/[0.08] shadow-2xs transition-colors cursor-pointer"
                >
                  + 安装 {p.id}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {workspaceSkills.map((skill) => (
              <div
                key={skill.id}
                className={cn(
                  'p-2.5 rounded-lg border transition-all space-y-1.5',
                  skill.enabled
                    ? 'bg-[#fbfaf7] border-black/[0.06]'
                    : 'bg-slate-50/50 border-black/[0.04] opacity-65'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-xs font-semibold text-slate-800 truncate">
                      {skill.name}
                    </span>
                    <span
                      className={cn(
                        'text-[9px] px-1.5 py-0.2 rounded font-mono font-medium',
                        skill.enabled
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                          : 'bg-slate-100 text-slate-500 border border-black/[0.06]'
                      )}
                    >
                      {skill.enabled ? '已启用' : '已禁用'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Enable / Disable toggle button */}
                    <button
                      onClick={() => handleToggleSkill(skill.id, skill.enabled)}
                      className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer flex items-center gap-1',
                        skill.enabled
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                          : 'bg-white hover:bg-slate-50 text-slate-500 border border-black/[0.08]'
                      )}
                      title={skill.enabled ? '点击禁用该技能' : '点击启用该技能'}
                    >
                      <Power size={10} />
                      <span>{skill.enabled ? '开' : '关'}</span>
                    </button>

                    {/* View detail button */}
                    <button
                      onClick={() => setPreviewingSkill(skill)}
                      className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-black/[0.04] transition-colors cursor-pointer"
                      title="查看技能定义"
                    >
                      <Eye size={12} />
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={() => handleDeleteSkill(skill.id, skill.name)}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="卸载技能"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                  {skill.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workspace Rules & AGENTS.md Info */}
      <div className="bg-white border border-black/[0.06] rounded-xl p-3 space-y-2.5 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
            <Sparkles size={13} className="text-indigo-600" />
            <span>空间规则 (AGENTS.md)</span>
          </div>
          <button
            onClick={() => {
              setEditWsName(activeWorkspace?.name || '');
              setEditWsDesc(activeWorkspace?.description || '');
              setEditWsPrompt(activeWorkspace?.systemPrompt || '');
              setShowRulesModal(true);
            }}
            className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium transition-colors cursor-pointer"
          >
            编辑规则
          </button>
        </div>
        {activeWorkspace?.systemPrompt ? (
          <div className="p-2.5 rounded-lg bg-[#fbfaf7] border border-black/[0.06] text-[11px] font-mono text-slate-700 max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {activeWorkspace.systemPrompt}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 italic">
            当前工作区未配置专属规则，智能体将采用系统默认行为。点击上方“编辑规则”可一键引入 Next.js、Python 等项目规范。
          </p>
        )}
      </div>
    </div>
  );
};
