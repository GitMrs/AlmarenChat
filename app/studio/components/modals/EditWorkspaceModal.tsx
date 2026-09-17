import React from 'react';
import { Edit2, Loader2 } from 'lucide-react';

interface EditWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  editWsName: string;
  setEditWsName: (v: string) => void;
  editWsDesc: string;
  setEditWsDesc: (v: string) => void;
  editWsPrompt: string;
  setEditWsPrompt: (v: string) => void;
  onSave: (e: React.FormEvent) => void;
  isEditingWs: boolean;
}

export const EditWorkspaceModal: React.FC<EditWorkspaceModalProps> = ({
  isOpen,
  onClose,
  editWsName,
  setEditWsName,
  editWsDesc,
  setEditWsDesc,
  editWsPrompt,
  setEditWsPrompt,
  onSave,
  isEditingWs,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white border border-black/[0.08] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 text-slate-900">
        <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
          <div className="flex items-center gap-2">
            <Edit2 size={16} className="text-indigo-600" />
            <h3 className="text-base font-bold text-slate-900">编辑工作区信息</h3>
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
            <label className="text-xs font-semibold text-slate-800">
              工作区名称 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={editWsName}
              onChange={(e) => setEditWsName(e.target.value)}
              className="w-full bg-[#fbfaf7] border border-black/[0.1] rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white shadow-2xs"
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-800">工作区简介</label>
            <textarea
              value={editWsDesc}
              onChange={(e) => setEditWsDesc(e.target.value)}
              placeholder="工作区的核心目标或业务背景..."
              rows={2}
              className="w-full bg-[#fbfaf7] border border-black/[0.1] rounded-xl px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white resize-none shadow-2xs"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800">空间提示词与项目规范</label>
              <span className="text-[10px] text-slate-500 font-mono">保存时自动同步至 AGENTS.md</span>
            </div>
            <textarea
              value={editWsPrompt}
              onChange={(e) => setEditWsPrompt(e.target.value)}
              placeholder="设定专属的角色要求、技术栈规范或开发约束..."
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
              disabled={!editWsName.trim() || isEditingWs}
              className="px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 disabled:opacity-50 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {isEditingWs && <Loader2 size={12} className="animate-spin" />}
              <span>保存修改</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
