import React from 'react';
import { FolderPlus, Loader2 } from 'lucide-react';

interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  newWsName: string;
  setNewWsName: (v: string) => void;
  newWsDesc: string;
  setNewWsDesc: (v: string) => void;
  newWsPrompt: string;
  setNewWsPrompt: (v: string) => void;
  onCreate: (e: React.FormEvent) => void;
  isCreatingWs: boolean;
}

export const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({
  isOpen,
  onClose,
  newWsName,
  setNewWsName,
  newWsDesc,
  setNewWsDesc,
  newWsPrompt,
  setNewWsPrompt,
  onCreate,
  isCreatingWs,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-black/[0.08] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 text-slate-900">
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
          <div className="flex items-center gap-2">
            <FolderPlus size={18} className="text-indigo-600" />
            <h3 className="text-base font-bold text-slate-900">新建 Studio 工作空间</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xs cursor-pointer"
          >
            取消
          </button>
        </div>

        <form onSubmit={onCreate} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-800">
              工作区名称 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              placeholder="例如：web-crawler、algo-sandbox、my-project"
              className="w-full bg-[#fbfaf7] border border-black/[0.1] rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white shadow-2xs"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-800">工作区简介（可选）</label>
            <textarea
              value={newWsDesc}
              onChange={(e) => setNewWsDesc(e.target.value)}
              placeholder="工作区的核心目标或业务背景..."
              rows={2}
              className="w-full bg-[#fbfaf7] border border-black/[0.1] rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white resize-none shadow-2xs"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800">空间提示词与项目规范（可选）</label>
              <span className="text-[10px] text-slate-500 font-mono">自动同步 AGENTS.md</span>
            </div>
            <textarea
              value={newWsPrompt}
              onChange={(e) => setNewWsPrompt(e.target.value)}
              placeholder="设定专属的角色要求、技术栈规范或开发约束，例如：使用 Next.js 15 App Router，代码必须加详细注释..."
              rows={3}
              className="w-full bg-[#fbfaf7] border border-black/[0.1] rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white resize-none font-mono text-[11px] shadow-2xs"
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
              disabled={!newWsName.trim() || isCreatingWs}
              className="px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {isCreatingWs && <Loader2 size={12} className="animate-spin" />}
              <span>立即创建并切换</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
