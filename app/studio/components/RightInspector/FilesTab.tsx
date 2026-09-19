import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import CodeMirror from '@uiw/react-codemirror';
import {
  FilePlus,
  RefreshCw,
  Loader2,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileText,
  Trash2,
  X,
  ChevronsUpDown,
  ChevronsDownUp,
  Edit3,
  Eye,
  EyeOff,
  Save,
  Check,
  Copy,
  Maximize2,
  Minimize2,
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
  handleSaveFile: (path: string, content: string) => Promise<boolean>;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) return '';
  const units = ['B', 'KB', 'MB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Recognizes built-in agent systems, dotfiles, IDE configs, and caches.
 */
function isSystemOrHiddenFile(name: string, path: string): boolean {
  if (name.startsWith('.')) return true;
  if (name === '__pycache__' || name === 'venv' || name === '.venv') return true;
  if (name === 'AGENTS.md' || name === 'CLAUDE.md') return true;
  return false;
}

/**
 * Returns a friendly badge label and theme color for built-in/system items.
 */
function getSystemFileBadge(name: string, path: string): { label: string; color: string } | null {
  if (name === '.pi' || path.startsWith('.pi/')) {
    return { label: '内置Agent', color: 'bg-amber-50 text-amber-700 border-amber-200/60' };
  }
  if (name.startsWith('.env')) {
    return { label: '环境配置', color: 'bg-rose-50 text-rose-700 border-rose-200/60' };
  }
  if (name === 'AGENTS.md' || name === 'CLAUDE.md') {
    return { label: 'Agent规范', color: 'bg-indigo-50 text-indigo-700 border-indigo-200/60' };
  }
  if (name === '.vscode' || name === '.idea' || name.startsWith('.git')) {
    return { label: 'IDE配置', color: 'bg-slate-100 text-slate-600 border-black/[0.06]' };
  }
  if (name === '__pycache__' || name.endsWith('_cache')) {
    return { label: '运行缓存', color: 'bg-slate-100 text-slate-500 border-black/[0.06]' };
  }
  if (name.startsWith('.')) {
    return { label: '系统项', color: 'bg-slate-100 text-slate-500 border-black/[0.06]' };
  }
  return null;
}

function filterTree(nodes: FileNode[], showHidden: boolean): FileNode[] {
  if (showHidden) return nodes;
  return nodes
    .filter((node) => !isSystemOrHiddenFile(node.name, node.path))
    .map((node) => {
      if (node.isDirectory && node.children) {
        return {
          ...node,
          children: filterTree(node.children, showHidden),
        };
      }
      return node;
    });
}

function getAllDirectoryPaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  function traverse(list: FileNode[]) {
    for (const node of list) {
      if (node.isDirectory) {
        paths.push(node.path);
        if (node.children) traverse(node.children);
      }
    }
  }
  traverse(nodes);
  return paths;
}

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  expandedPaths: Set<string>;
  toggleFolder: (path: string) => void;
  onSelectFile: (node: FileNode) => void;
  onDeleteFile: (path: string, e: React.MouseEvent) => void;
  previewFilePath?: string;
  showHiddenFiles: boolean;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({
  node,
  depth,
  expandedPaths,
  toggleFolder,
  onSelectFile,
  onDeleteFile,
  previewFilePath,
  showHiddenFiles,
}) => {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = !node.isDirectory && previewFilePath === node.path;
  const paddingLeft = depth * 14 + 6;
  const systemBadge = showHiddenFiles ? getSystemFileBadge(node.name, node.path) : null;

  const handleDeleteWithWarning = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (systemBadge) {
      if (
        !confirm(
          `⚠️ 警告：[${node.path}] 属于系统/环境关键项（${systemBadge.label}）！\n\n删除可能导致技能失效或环境配置丢失，确认继续删除？`
        )
      ) {
        return;
      }
    }
    onDeleteFile(node.path, e);
  };

  if (node.isDirectory) {
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const childCount = node.children ? node.children.length : 0;

    return (
      <div className="select-none">
        <div
          onClick={() => toggleFolder(node.path)}
          style={{ paddingLeft: `${paddingLeft}px` }}
          className="flex items-center justify-between py-1.5 pr-2 rounded-lg hover:bg-black/[0.04] cursor-pointer group transition-colors"
          title={`${node.path} (${childCount} 项)`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-slate-400 p-0.5 hover:text-slate-600 transition-colors flex-shrink-0">
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            {isExpanded ? (
              <FolderOpen size={14} className={systemBadge ? 'text-slate-400 flex-shrink-0' : 'text-amber-500 flex-shrink-0'} />
            ) : (
              <Folder size={14} className={systemBadge ? 'text-slate-400 flex-shrink-0' : 'text-amber-500 flex-shrink-0'} />
            )}
            <span
              className={`truncate font-medium group-hover:text-slate-900 ${
                systemBadge ? 'text-slate-500' : 'text-slate-700'
              }`}
            >
              {node.name}
            </span>
            {systemBadge && (
              <span
                className={`text-[9px] font-sans px-1 py-0.2 rounded border font-normal flex-shrink-0 ${systemBadge.color}`}
              >
                {systemBadge.label}
              </span>
            )}
            {childCount > 0 && (
              <span className="text-[10px] text-slate-400 font-normal">
                ({childCount})
              </span>
            )}
          </div>

          <button
            onClick={handleDeleteWithWarning}
            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 transition-opacity cursor-pointer rounded"
            title="删除目录"
          >
            <Trash2 size={12} />
          </button>
        </div>

        {isExpanded && (
          <div>
            {hasChildren ? (
              node.children!.map((child) => (
                <FileTreeItem
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  expandedPaths={expandedPaths}
                  toggleFolder={toggleFolder}
                  onSelectFile={onSelectFile}
                  onDeleteFile={onDeleteFile}
                  previewFilePath={previewFilePath}
                  showHiddenFiles={showHiddenFiles}
                />
              ))
            ) : (
              <div
                style={{ paddingLeft: `${(depth + 1) * 14 + 20}px` }}
                className="py-1 text-[10px] text-slate-400 italic"
              >
                (空目录)
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelectFile(node)}
      style={{ paddingLeft: `${paddingLeft + 16}px` }}
      className={`flex items-center justify-between py-1.5 pr-2 rounded-lg cursor-pointer group transition-colors ${
        isSelected
          ? 'bg-amber-50 text-amber-950 font-medium border border-amber-200/60 shadow-2xs'
          : 'hover:bg-black/[0.04] text-slate-700 hover:text-slate-900'
      }`}
      title={`${node.path}${node.size ? ` (${formatFileSize(node.size)})` : ''}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <FileText
          size={14}
          className={
            isSelected
              ? 'text-amber-600 flex-shrink-0'
              : systemBadge
              ? 'text-slate-400 flex-shrink-0'
              : 'text-slate-400 flex-shrink-0'
          }
        />
        <span className={`truncate ${systemBadge ? 'text-slate-500' : ''}`}>{node.name}</span>
        {systemBadge && (
          <span
            className={`text-[9px] font-sans px-1 py-0.2 rounded border font-normal flex-shrink-0 ${systemBadge.color}`}
          >
            {systemBadge.label}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        {node.size ? (
          <span className="text-[10px] text-slate-400 font-sans group-hover:hidden">
            {formatFileSize(node.size)}
          </span>
        ) : null}
        <button
          onClick={handleDeleteWithWarning}
          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 transition-opacity cursor-pointer rounded"
          title="删除文件"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};

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
  handleSaveFile,
}) => {
  const [mounted, setMounted] = useState<boolean>(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Show/Hide hidden & system items (.pi, .env, .vscode, etc.)
  const [showHiddenFiles, setShowHiddenFiles] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('almaren_studio_show_hidden') === 'true';
    }
    return false;
  });

  // Editor states
  const [editContent, setEditContent] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleShowHidden = () => {
    setShowHiddenFiles((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('almaren_studio_show_hidden', String(next));
      } catch {
        // Ignore
      }
      return next;
    });
  };

  // Filter tree based on showHiddenFiles
  const visibleFileTree = useMemo(() => {
    return filterTree(fileTree, showHiddenFiles);
  }, [fileTree, showHiddenFiles]);

  // Sync editContent when previewFile changes
  useEffect(() => {
    if (previewFile) {
      setEditContent(previewFile.content || '');
      setSaveSuccess(false);
      setCopied(false);
    } else {
      setEditContent('');
      setIsFullScreen(false);
    }
  }, [previewFile?.path, previewFile?.content]);

  // Lock background scroll when full-screen modal is open
  useEffect(() => {
    if (!isFullScreen || typeof document === 'undefined') return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isFullScreen]);

  // Global Escape key listener to exit full screen
  useEffect(() => {
    if (!isFullScreen) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isFullScreen]);

  // Check if content has unsaved changes
  const isDirty = useMemo(() => {
    if (!previewFile) return false;
    return editContent !== (previewFile.content || '');
  }, [editContent, previewFile?.content]);

  // File extension
  const fileExt = useMemo(() => {
    if (!previewFile?.path) return '';
    const parts = previewFile.path.split('.');
    return parts.length > 1 ? `.${parts.pop()}` : '';
  }, [previewFile?.path]);

  // Directory paths
  const allDirPaths = useMemo(() => getAllDirectoryPaths(visibleFileTree), [visibleFileTree]);

  // Reveal active preview file in directory tree by expanding its parent folders
  useEffect(() => {
    if (previewFile?.path) {
      const parts = previewFile.path.split('/');
      if (parts.length > 1) {
        const ancestors: string[] = [];
        let current = '';
        for (let i = 0; i < parts.length - 1; i++) {
          current = current ? `${current}/${parts[i]}` : parts[i];
          ancestors.push(current);
        }
        setExpandedPaths((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const p of ancestors) {
            if (!next.has(p)) {
              next.add(p);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    }
  }, [previewFile?.path]);

  const toggleFolder = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (expandedPaths.size > 0) {
      setExpandedPaths(new Set());
    } else {
      setExpandedPaths(new Set(allDirPaths));
    }
  };

  // Save handler
  const onSave = async () => {
    if (!previewFile || isSaving) return;
    setIsSaving(true);
    const ok = await handleSaveFile(previewFile.path, editContent);
    setIsSaving(false);
    if (ok) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  };

  // Copy handler
  const onCopy = async () => {
    if (!editContent) return;
    try {
      await navigator.clipboard.writeText(editContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore
    }
  };

  // Close preview with unsaved confirmation
  const handleClosePreview = () => {
    if (isDirty && !confirm('检测到有未保存的代码修改，确认关闭？')) {
      return;
    }
    setIsFullScreen(false);
    setPreviewFile(null);
  };

  // Textarea keydown for shortcuts (Ctrl+S)
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onSave();
    }
  };

  // Line count for viewer
  const lineCount = useMemo(() => {
    return editContent ? editContent.split('\n').length : 0;
  }, [editContent]);

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-2 border-b border-black/[0.06]">
        <span className="text-xs font-medium text-slate-600 truncate mr-1">
          沙箱文件 ({activeWorkspaceName})
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Toggle Hidden/System files (.pi, .env, etc.) */}
          <button
            onClick={toggleShowHidden}
            className={`p-1 rounded cursor-pointer transition-colors ${
              showHiddenFiles
                ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                : 'text-slate-400 hover:text-slate-700 hover:bg-black/[0.05]'
            }`}
            title={
              showHiddenFiles
                ? '隐藏系统内置与点文件 (.pi, .env, .vscode 等)'
                : '显示全部文件 (包含 .pi, .env, .vscode 等系统内置项)'
            }
          >
            {showHiddenFiles ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>

          {allDirPaths.length > 0 && (
            <button
              onClick={toggleAll}
              className="p-1 rounded hover:bg-black/[0.05] text-slate-400 hover:text-slate-700 cursor-pointer transition-colors"
              title={expandedPaths.size > 0 ? '全部折叠' : '全部展开'}
            >
              {expandedPaths.size > 0 ? (
                <ChevronsDownUp size={13} />
              ) : (
                <ChevronsUpDown size={13} />
              )}
            </button>
          )}
          <button
            onClick={() => setIsCreatingFile(!isCreatingFile)}
            className="p-1 rounded hover:bg-black/[0.05] text-slate-400 hover:text-slate-700 cursor-pointer transition-colors"
            title="新建文件 (支持带路径，如 src/main.ts)"
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={() => fetchWorkspaceTree()}
            className="p-1 rounded hover:bg-black/[0.05] text-slate-400 hover:text-slate-700 cursor-pointer transition-colors"
            title="刷新文件树"
          >
            <RefreshCw size={13} className={isLoadingFiles ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* New file input form */}
      {isCreatingFile && (
        <div className="flex items-center gap-1.5 p-2 bg-[#fbfaf7] rounded-lg border border-black/[0.08]">
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFile();
              if (e.key === 'Escape') setIsCreatingFile(false);
            }}
            placeholder="文件名 (支持目录 如 src/app.ts)"
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
      <div className="space-y-0.5 text-xs font-mono">
        {isLoadingFiles ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={18} className="text-slate-400 animate-spin" />
          </div>
        ) : visibleFileTree.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-xs">
            {fileTree.length > 0 && !showHiddenFiles
              ? '当前目录仅包含系统/点文件，点击上方眼睛图标可展开查看'
              : '工作区当前为空，让智能体写入文件或点击上方新建'}
          </div>
        ) : (
          visibleFileTree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              depth={0}
              expandedPaths={expandedPaths}
              toggleFolder={toggleFolder}
              onSelectFile={handleSelectFile}
              onDeleteFile={handleDeleteFile}
              previewFilePath={previewFile?.path}
              showHiddenFiles={showHiddenFiles}
            />
          ))
        )}
      </div>

      {/* Inline File Preview & Editor with CodeMirror (Shown in sidebar when not in full-screen) */}
      {previewFile && !isFullScreen && (
        <div className="mt-4 border-t border-black/[0.06] pt-3 space-y-2 select-text">
          {/* File Action Bar */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="text-xs font-mono text-slate-800 font-medium truncate"
                title={previewFile.path}
              >
                {previewFile.path}
              </span>
              {isDirty && (
                <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200/60 font-sans flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  已修改
                </span>
              )}
              {saveSuccess && (
                <span className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200/60 font-sans flex-shrink-0">
                  <Check size={10} />
                  已保存
                </span>
              )}
            </div>

            <div className="flex items-center gap-0.5 flex-shrink-0">
              {/* Toggle Mode */}
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={`p-1 rounded cursor-pointer transition-colors ${
                  isEditing
                    ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    : 'text-slate-400 hover:text-slate-700 hover:bg-black/[0.04]'
                }`}
                title={isEditing ? '切换为只读查看' : '编辑文件'}
              >
                {isEditing ? <Eye size={13} /> : <Edit3 size={13} />}
              </button>

              {/* Save Button */}
              {isEditing && (
                <button
                  onClick={onSave}
                  disabled={isSaving || !isDirty}
                  className={`p-1 rounded cursor-pointer transition-colors ${
                    isDirty
                      ? 'bg-slate-900 text-white hover:bg-slate-800 shadow-2xs'
                      : 'text-slate-300 hover:text-slate-400 cursor-not-allowed'
                  }`}
                  title="保存 (Ctrl+S)"
                >
                  {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                </button>
              )}

              {/* Copy Button */}
              <button
                onClick={onCopy}
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-black/[0.04] cursor-pointer transition-colors"
                title={copied ? '已复制！' : '复制代码'}
              >
                {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              </button>

              {/* Maximize Button */}
              <button
                onClick={() => setIsFullScreen(true)}
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-black/[0.04] cursor-pointer transition-colors"
                title="全屏大窗口查看与编辑"
              >
                <Maximize2 size={13} />
              </button>

              {/* Close Preview */}
              <button
                onClick={handleClosePreview}
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-black/[0.04] cursor-pointer transition-colors"
                title="关闭"
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Professional CodeMirror Editor & Viewer */}
          <div className="rounded-xl border border-black/[0.08] overflow-hidden bg-white shadow-2xs">
            {mounted ? (
              <CodeMirror
                value={editContent}
                height="260px"
                maxHeight="260px"
                readOnly={!isEditing}
                editable={isEditing}
                onChange={(val) => setEditContent(val)}
                onKeyDown={handleEditorKeyDown}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: isEditing,
                  highlightActiveLineGutter: isEditing,
                  dropCursor: true,
                  allowMultipleSelections: true,
                  indentOnInput: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  tabSize: 2,
                }}
                className="text-xs font-mono"
              />
            ) : (
              <div className="p-3 text-xs text-slate-400 font-mono">加载中...</div>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 font-mono">
            <span>{lineCount} 行 · {editContent.length} 字符</span>
            <span>{isEditing ? 'Ctrl+S 保存 · Tab 缩进' : '只读查看中'}</span>
          </div>
        </div>
      )}

      {/* Full-Screen CodeMirror Editor & Viewer Modal (Portaled directly to document.body) */}
      {mounted && previewFile && isFullScreen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-fadeIn select-text"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              if (isDirty && !confirm('检测到有未保存的代码修改，确认退出全屏？')) return;
              setIsFullScreen(false);
            }
          }}
        >
          <div className="bg-white rounded-2xl border border-black/[0.1] shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="h-14 px-4 sm:px-6 border-b border-black/[0.06] bg-[#fbfaf7] flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-amber-50 border border-amber-200/60 text-amber-700 flex-shrink-0">
                  <FileText size={16} />
                </div>
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-mono text-xs sm:text-sm font-semibold text-slate-900 truncate">
                    {previewFile.path}
                  </span>
                  {fileExt && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-black/[0.06] font-medium hidden sm:inline">
                      {fileExt}
                    </span>
                  )}
                </div>

                {isDirty && (
                  <span className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 font-sans font-medium flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    未保存修改
                  </span>
                )}
                {saveSuccess && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 font-sans font-medium flex-shrink-0">
                    <Check size={12} />
                    已成功保存
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Mode Switcher */}
                <div className="flex items-center bg-slate-100/80 rounded-xl p-1 border border-black/[0.04]">
                  <button
                    onClick={() => setIsEditing(false)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                      !isEditing ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Eye size={13} />
                    <span>查看</span>
                  </button>
                  <button
                    onClick={() => setIsEditing(true)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                      isEditing ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Edit3 size={13} />
                    <span>编辑</span>
                  </button>
                </div>

                {/* Save Button */}
                <button
                  onClick={onSave}
                  disabled={isSaving || !isDirty}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-all ${
                    isDirty
                      ? 'bg-slate-950 text-white hover:bg-slate-800 shadow-xs'
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-black/[0.04]'
                  }`}
                  title="保存文件 (Ctrl+S)"
                >
                  {isSaving ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Save size={13} />
                  )}
                  <span>保存</span>
                </button>

                {/* Copy Button */}
                <button
                  onClick={onCopy}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs text-slate-600 hover:text-slate-900 hover:bg-black/[0.04] border border-black/[0.06] cursor-pointer transition-colors"
                  title="复制代码"
                >
                  {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>

                <div className="h-4 w-px bg-black/[0.08] mx-0.5" />

                {/* Minimize / Back to sidebar */}
                <button
                  onClick={() => setIsFullScreen(false)}
                  className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-black/[0.04] cursor-pointer transition-colors"
                  title="退出全屏 (Esc)"
                >
                  <Minimize2 size={16} />
                </button>

                {/* Close file */}
                <button
                  onClick={handleClosePreview}
                  className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-black/[0.04] cursor-pointer transition-colors"
                  title="关闭文件"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body: 100% Full-height CodeMirror */}
            <div className="flex-1 min-h-0 overflow-hidden bg-white">
              <CodeMirror
                value={editContent}
                height="100%"
                readOnly={!isEditing}
                editable={isEditing}
                onChange={(val) => setEditContent(val)}
                onKeyDown={handleEditorKeyDown}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: isEditing,
                  highlightActiveLineGutter: isEditing,
                  dropCursor: true,
                  allowMultipleSelections: true,
                  indentOnInput: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  tabSize: 2,
                }}
                className="h-full text-xs sm:text-sm font-mono [&_.cm-editor]:h-full [&_.cm-scroller]:h-full [&_.cm-scroller]:overflow-auto"
              />
            </div>

            {/* Modal Footer */}
            <div className="h-10 px-4 sm:px-6 border-t border-black/[0.06] bg-[#fbfaf7] flex items-center justify-between text-[11px] font-mono text-slate-400 flex-shrink-0 select-none">
              <div className="flex items-center gap-3">
                <span>{lineCount} 行</span>
                <span>·</span>
                <span>{editContent.length} 字符</span>
                <span>·</span>
                <span>{formatFileSize(editContent.length)}</span>
              </div>
              <div className="flex items-center gap-3 hidden sm:flex">
                <span>快捷键: <kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">Ctrl+S</kbd> 保存</span>
                <span>·</span>
                <span><kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">Tab</kbd> 缩进 (2空格)</span>
                <span>·</span>
                <span><kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">Esc</kbd> 退出全屏</span>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
