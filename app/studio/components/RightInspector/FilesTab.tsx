import React from 'react';
import {
  FilePlus,
  RefreshCw,
  Loader2,
  Folder,
  FileText,
  Trash2,
  X,
} from 'lucide-react';
import { FileNode } from '../../types';

interface FilesTabProps {
  activeWorkspaceName: string;
  isCreatingFile: boolean;
  setIsCreatingFile: (v: boolean) => void;
  newFileName: string;
  setNewFileName: (v: string) => void;
  handleCreateFile: () => void;
  fetchWorkspaceTree: () => void;
  isLoadingFiles: boolean;
  fileTree: FileNode[];
  handleSelectFile: (node: FileNode) => void;
  handleDeleteFile: (path: string, e: React.MouseEvent) => void;
  previewFile: { path: string; content: string } | null;
  setPreviewFile: (v: { path: string; content: string } | null) => void;
}

export const FilesTab: React.FC<FilesTabProps> = ({
  activeWorkspaceName,
  isCreatingFile,
  setIsCreatingFile,
  newFileName,
  setNewFileName,
  handleCreateFile,
  fetchWorkspaceTree,
  isLoadingFiles,
  fileTree,
  handleSelectFile,
  handleDeleteFile,
  previewFile,
  setPreviewFile,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-black/[0.06]">
        <span className="text-xs font-medium text-slate-600">
          沙箱文件列表 ({activeWorkspaceName})
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsCreatingFile(!isCreatingFile)}
            className="p-1 rounded hover:bg-black/[0.05] text-slate-400 hover:text-slate-700 cursor-pointer"
            title="新建文件"
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={() => fetchWorkspaceTree()}
            className="p-1 rounded hover:bg-black/[0.05] text-slate-400 hover:text-slate-700 cursor-pointer"
            title="刷新文件树"
          >
            <RefreshCw size={13} className={isLoadingFiles ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isCreatingFile && (
        <div className="flex items-center gap-1.5 p-2 bg-[#fbfaf7] rounded-lg border border-black/[0.08]">
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="文件名 (如 src/app.ts)"
            className="flex-1 bg-white border border-black/[0.08] rounded px-2 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 font-mono shadow-2xs"
            autoFocus
          />
          <button
            onClick={handleCreateFile}
            className="px-2 py-1 rounded bg-slate-950 text-white text-xs hover:bg-slate-800 cursor-pointer shadow-xs"
          >
            创建
          </button>
          <button
            onClick={() => setIsCreatingFile(false)}
            className="px-2 py-1 rounded bg-white border border-black/[0.08] text-slate-600 text-xs hover:bg-slate-50 cursor-pointer"
          >
            取消
          </button>
        </div>
      )}

      {/* Tree Area */}
      <div className="space-y-1 text-xs font-mono">
        {isLoadingFiles ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={18} className="text-slate-400 animate-spin" />
          </div>
        ) : fileTree.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-xs">
            工作区当前为空，让智能体写入文件或点击上方新建
          </div>
        ) : (
          fileTree.map((node) => (
            <div
              key={node.path}
              onClick={() => handleSelectFile(node)}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-black/[0.04] cursor-pointer group transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {node.isDirectory ? (
                  <Folder size={14} className="text-amber-500 flex-shrink-0" />
                ) : (
                  <FileText size={14} className="text-slate-400 flex-shrink-0" />
                )}
                <span className="text-slate-700 group-hover:text-slate-900 truncate">
                  {node.name}
                </span>
              </div>

              {!node.isDirectory && (
                <button
                  onClick={(e) => handleDeleteFile(node.path, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 transition-opacity cursor-pointer"
                  title="删除文件"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* File Preview */}
      {previewFile && (
        <div className="mt-4 border-t border-black/[0.06] pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-700 font-medium truncate">
              {previewFile.path}
            </span>
            <button
              onClick={() => setPreviewFile(null)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
          <pre className="p-2.5 rounded-lg bg-slate-50 border border-black/[0.06] text-[11px] font-mono text-slate-800 overflow-x-auto max-h-56 leading-relaxed whitespace-pre-wrap shadow-2xs">
            {previewFile.content || '(空文件)'}
          </pre>
        </div>
      )}
    </div>
  );
};
