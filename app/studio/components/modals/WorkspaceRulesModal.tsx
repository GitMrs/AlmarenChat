import React from 'react';
import { Sparkles, Loader2 } from 'lucide-react';

interface WorkspaceRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeWorkspaceName: string;
  editWsPrompt: string;
  setEditWsPrompt: (v: string) => void;
  onSave: (e: React.FormEvent) => void;
  isEditingWs: boolean;
}

const PRESET_RULES = [
  {
    label: 'Next.js 全栈规范',
    prompt:
      '【项目规范】：\n1. 技术栈：Next.js 15 (App Router) + TailwindCSS + TypeScript；\n2. 拒绝使用 any，所有数据接口和 Props 必须严格定义类型；\n3. 组件优先使用函数式组件，保持 UI 极简科技暗黑风格；\n4. 修改或新建文件前，先简要说明改动方案。',
  },
  {
    label: 'Python 算法与爬虫',
    prompt:
      '【项目规范】：\n1. 技术栈：Python 3.12，遵守 PEP8 代码规范；\n2. 网络请求与并发必须包含超时重试与异常捕获；\n3. 涉及数据分析时优先使用 Pandas，图表必须配置中文字体；\n4. 产出脚本需在代码顶部注明使用方式与参数说明。',
  },
  {
    label: '自媒体脚本创作',
    prompt:
      '【项目角色设定】：\n你是一位资深新媒体与短视频策划导师。在此空间中，请使用网感强、结构清晰的脚本分镜语言回复我；每次输出文案时，提供黄金前3秒钩子、核心干货展开以及结尾行动号召。',
  },
];

export const WorkspaceRulesModal: React.FC<WorkspaceRulesModalProps> = ({
  isOpen,
  onClose,
  activeWorkspaceName,
  editWsPrompt,
  setEditWsPrompt,
  onSave,
  isEditingWs,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white border border-black/[0.08] rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 text-slate-900">
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-indigo-600" />
            <h3 className="text-base font-bold text-slate-900">
              【{activeWorkspaceName}】空间提示词与规范
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xs cursor-pointer"
          >
            取消
          </button>
        </div>

        <form onSubmit={onSave} className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-800">
                空间专属指令 (System Instructions)
              </label>
              <span className="text-[10px] text-indigo-600 font-mono">自动同步沙箱 AGENTS.md</span>
            </div>
            <textarea
              value={editWsPrompt}
              onChange={(e) => setEditWsPrompt(e.target.value)}
              placeholder="在此输入当前工作空间的专属指令与规范。例如：&#10;1. 本项目采用 Next.js 15 App Router + TailwindCSS；&#10;2. 代码必须严格使用 TypeScript，拒绝 any 类型；&#10;3. 写代码或重构前必须先列出改动点；&#10;4. 保持代码精炼，所有模块加上简明 JSDoc 注释。"
              rows={8}
              className="w-full bg-[#fbfaf7] border border-black/[0.1] rounded-xl p-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white font-mono leading-relaxed resize-none shadow-2xs"
              autoFocus
            />
            <p className="text-[10px] text-slate-500 leading-snug">
              总指挥官在规划时将严格遵守该规范；保存后会在工作区根目录同步写入 AGENTS.md，Pi 等子智能体执行时亦会自动读取遵循。
            </p>
          </div>

          {/* Quick Preset Badges */}
          <div className="space-y-1.5">
            <div className="text-[11px] text-slate-600 font-medium">快捷填入预设模板：</div>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_RULES.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setEditWsPrompt(preset.prompt)}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-black/[0.08] shadow-2xs text-[11px] transition-colors cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-black/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isEditingWs}
              className="px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {isEditingWs && <Loader2 size={12} className="animate-spin" />}
              <span>保存并应用到当前空间</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
