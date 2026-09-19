import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import CodeMirror from '@uiw/react-codemirror';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  Image as ImageIcon,
  Globe,
  Code,
  Download,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { FileNode, PreviewFile } from '../../types';

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
  previewFile: PreviewFile | null;
  setPreviewFile: (v: PreviewFile | null) => void;
  handleSaveFile: (path: string, content: string) => Promise<boolean>;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) return '';
  const units = ['B', 'KB', 'MB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export type FilePreviewKind = 'image' | 'markdown' | 'html' | 'code';

export function getFilePreviewKind(filePath: string, isImage?: boolean): FilePreviewKind {
  if (isImage) return 'image';
  const lower = filePath.toLowerCase();
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.svg')
  ) {
    return 'image';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'markdown';
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return 'html';
  }
  return 'code';
}

function getFileIcon(name: string, isSelected: boolean) {
  const lower = name.toLowerCase();
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.ico') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.svg')
  ) {
    return <ImageIcon size={14} className={isSelected ? 'text-purple-600 flex-shrink-0' : 'text-purple-400 flex-shrink-0'} />;
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return <Globe size={14} className={isSelected ? 'text-emerald-600 flex-shrink-0' : 'text-emerald-400 flex-shrink-0'} />;
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return <BookOpen size={14} className={isSelected ? 'text-blue-600 flex-shrink-0' : 'text-blue-400 flex-shrink-0'} />;
  }
  if (lower.endsWith('.json') || lower.endsWith('.ts') || lower.endsWith('.js') || lower.endsWith('.py')) {
    return <Code size={14} className={isSelected ? 'text-amber-600 flex-shrink-0' : 'text-amber-500/70 flex-shrink-0'} />;
  }
  return (
    <FileText
      size={14}
      className={isSelected ? 'text-amber-600 flex-shrink-0' : 'text-slate-400 flex-shrink-0'}
    />
  );
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
        {getFileIcon(node.name, isSelected)}
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
  const [activeTabMode, setActiveTabMode] = useState<'code' | 'preview'>('preview');
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

  const previewKind = useMemo(() => {
    if (!previewFile) return 'code';
    return getFilePreviewKind(previewFile.path, previewFile.isImage);
  }, [previewFile]);

  const isSvg = useMemo(() => {
    return previewFile?.path?.toLowerCase().endsWith('.svg') || false;
  }, [previewFile?.path]);

  // Sync editContent and default active tab mode when previewFile changes
  // Check if content has unsaved changes
  const isDirty = useMemo(() => {
    if (!previewFile) return false;
    return editContent !== (previewFile.content || '');
  }, [editContent, previewFile?.content]);

  // Close preview modal with unsaved confirmation
  const handleClosePreview = () => {
    if (isDirty && !confirm('检测到有未保存的代码修改，确认关闭？')) {
      return;
    }
    setIsFullScreen(false);
    setPreviewFile(null);
  };

  // Sync editContent, default active tab mode, and auto-open full modal when previewFile changes
  useEffect(() => {
    if (previewFile) {
      setEditContent(previewFile.content || '');
      setSaveSuccess(false);
      setCopied(false);
      setIsFullScreen(true);
      const kind = getFilePreviewKind(previewFile.path, previewFile.isImage);
      if (kind === 'image' || kind === 'markdown' || kind === 'html') {
        setActiveTabMode('preview');
        setIsEditing(false);
      } else {
        setActiveTabMode('code');
        setIsEditing(false);
      }
    } else {
      setEditContent('');
      setIsFullScreen(false);
    }
  }, [previewFile?.path, previewFile?.content, previewFile?.isImage]);

  // Lock background scroll when modal is open
  useEffect(() => {
    if (!isFullScreen || typeof document === 'undefined') return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isFullScreen]);

  // Global Escape key listener to exit modal
  useEffect(() => {
    if (!isFullScreen) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClosePreview();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isFullScreen, isDirty]);

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

  // Open HTML in new browser tab
  const handleOpenHtmlNewTab = () => {
    if (!editContent) return;
    const blob = new Blob([editContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // Download image file
  const handleDownloadImage = () => {
    if (!previewFile?.dataUrl) return;
    const link = document.createElement('a');
    link.href = previewFile.dataUrl;
    link.download = previewFile.path.split('/').pop() || 'image';
    link.click();
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

      {/* Full-Screen CodeMirror Editor & Viewer Modal (Portaled directly to document.body) */}
      {mounted && previewFile && isFullScreen && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs flex items-center justify-center p-0 sm:p-6 animate-fadeIn select-text"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleClosePreview();
            }
          }}
        >
          <div className="bg-white rounded-none sm:rounded-2xl border-0 sm:border border-black/[0.1] shadow-2xl w-full max-w-6xl h-full sm:h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="h-13 sm:h-14 px-3 sm:px-6 border-b border-black/[0.06] bg-[#fbfaf7] flex items-center justify-between flex-shrink-0 gap-2">
              <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                <div className={`p-1.5 rounded-lg border flex-shrink-0 ${
                  previewKind === 'image'
                    ? 'bg-purple-50 border-purple-200/60 text-purple-700'
                    : previewKind === 'markdown'
                    ? 'bg-blue-50 border-blue-200/60 text-blue-700'
                    : previewKind === 'html'
                    ? 'bg-emerald-50 border-emerald-200/60 text-emerald-700'
                    : 'bg-amber-50 border-amber-200/60 text-amber-700'
                }`}>
                  {previewKind === 'image' && <ImageIcon size={16} />}
                  {previewKind === 'markdown' && <BookOpen size={16} />}
                  {previewKind === 'html' && <Globe size={16} />}
                  {previewKind === 'code' && <FileText size={16} />}
                </div>
                <div className="min-w-0 flex items-center gap-1.5 sm:gap-2">
                  <span
                    className="font-mono text-xs sm:text-sm font-semibold text-slate-900 truncate max-w-[130px] sm:max-w-md"
                    title={previewFile.path}
                  >
                    {previewFile.path}
                  </span>
                  {fileExt && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-black/[0.06] font-medium hidden sm:inline">
                      {fileExt}
                    </span>
                  )}
                </div>

                {isDirty && activeTabMode === 'code' && (
                  <span className="flex items-center gap-1 sm:gap-1.5 text-[11px] text-amber-800 bg-amber-50 px-1.5 sm:px-2 py-0.5 rounded-full border border-amber-200 font-sans font-medium flex-shrink-0" title="未保存修改">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    <span className="hidden sm:inline">未保存修改</span>
                  </span>
                )}
                {saveSuccess && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-1.5 sm:px-2 py-0.5 rounded-full border border-emerald-200 font-sans font-medium flex-shrink-0" title="已成功保存">
                    <Check size={12} />
                    <span className="hidden sm:inline">已成功保存</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                {/* Kind-specific Mode Switcher */}
                {previewKind === 'markdown' && (
                  <div className="flex items-center bg-slate-100/80 rounded-xl p-0.5 sm:p-1 border border-black/[0.04]">
                    <button
                      onClick={() => setActiveTabMode('preview')}
                      className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                        activeTabMode === 'preview' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                      }`}
                      title="渲染预览"
                    >
                      <BookOpen size={13} />
                      <span className="hidden sm:inline">渲染预览</span>
                    </button>
                    <button
                      onClick={() => {
                        setActiveTabMode('code');
                        setIsEditing(true);
                      }}
                      className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                        activeTabMode === 'code' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                      }`}
                      title="源码编辑"
                    >
                      <Code size={13} />
                      <span className="hidden sm:inline">源码编辑</span>
                    </button>
                  </div>
                )}

                {previewKind === 'html' && (
                  <>
                    <div className="flex items-center bg-slate-100/80 rounded-xl p-0.5 sm:p-1 border border-black/[0.04]">
                      <button
                        onClick={() => setActiveTabMode('preview')}
                        className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                          activeTabMode === 'preview' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="网页预览"
                      >
                        <Globe size={13} />
                        <span className="hidden sm:inline">网页预览</span>
                      </button>
                      <button
                        onClick={() => {
                          setActiveTabMode('code');
                          setIsEditing(true);
                        }}
                        className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                          activeTabMode === 'code' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                        }`}
                        title="HTML源码"
                      >
                        <Code size={13} />
                        <span className="hidden sm:inline">HTML源码</span>
                      </button>
                    </div>
                    <button
                      onClick={handleOpenHtmlNewTab}
                      className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-slate-600 hover:text-slate-900 hover:bg-black/[0.04] border border-black/[0.06] cursor-pointer transition-colors"
                      title="在浏览器独立标签页打开"
                    >
                      <ExternalLink size={13} />
                      <span>新标签页打开</span>
                    </button>
                  </>
                )}

                {previewKind === 'image' && (
                  <>
                    {isSvg && (
                      <div className="flex items-center bg-slate-100/80 rounded-xl p-0.5 sm:p-1 border border-black/[0.04]">
                        <button
                          onClick={() => setActiveTabMode('preview')}
                          className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                            activeTabMode === 'preview' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                          }`}
                          title="视觉预览"
                        >
                          <ImageIcon size={13} />
                          <span className="hidden sm:inline">视觉预览</span>
                        </button>
                        <button
                          onClick={() => {
                            setActiveTabMode('code');
                            setIsEditing(true);
                          }}
                          className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                            activeTabMode === 'code' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                          }`}
                          title="SVG源码"
                        >
                          <Code size={13} />
                          <span className="hidden sm:inline">SVG源码</span>
                        </button>
                      </div>
                    )}
                    {previewFile.dataUrl && (
                      <button
                        onClick={handleDownloadImage}
                        className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs text-slate-600 hover:text-slate-900 hover:bg-black/[0.04] border border-black/[0.06] cursor-pointer transition-colors"
                        title="下载原图"
                      >
                        <Download size={13} />
                        <span className="hidden sm:inline">下载原图</span>
                      </button>
                    )}
                  </>
                )}

                {previewKind === 'code' && (
                  <div className="flex items-center bg-slate-100/80 rounded-xl p-0.5 sm:p-1 border border-black/[0.04]">
                    <button
                      onClick={() => setIsEditing(false)}
                      className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                        !isEditing ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                      }`}
                      title="查看代码"
                    >
                      <Eye size={13} />
                      <span className="hidden sm:inline">查看</span>
                    </button>
                    <button
                      onClick={() => setIsEditing(true)}
                      className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                        isEditing ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'
                      }`}
                      title="编辑代码"
                    >
                      <Edit3 size={13} />
                      <span className="hidden sm:inline">编辑</span>
                    </button>
                  </div>
                )}

                {/* Save Button (when in code mode) */}
                {activeTabMode === 'code' && (
                  <button
                    onClick={onSave}
                    disabled={isSaving || !isDirty}
                    className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-all ${
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
                    <span className="hidden sm:inline">保存</span>
                  </button>
                )}

                {/* Copy Button (for text/code) */}
                {(previewKind !== 'image' || isSvg) && (
                  <button
                    onClick={onCopy}
                    className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs text-slate-600 hover:text-slate-900 hover:bg-black/[0.04] border border-black/[0.06] cursor-pointer transition-colors"
                    title="复制代码/内容"
                  >
                    {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                    <span className="hidden sm:inline">{copied ? '已复制' : '复制'}</span>
                  </button>
                )}

                <div className="h-4 w-px bg-black/[0.08] mx-0.5" />

                {/* Close modal */}
                <button
                  onClick={handleClosePreview}
                  className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs text-slate-600 hover:text-slate-900 hover:bg-black/[0.05] border border-black/[0.06] cursor-pointer transition-colors font-medium"
                  title="关闭窗口 (Esc)"
                >
                  <X size={15} />
                  <span className="hidden sm:inline">关闭</span>
                </button>
              </div>
            </div>

            {/* Modal Body: Multimodal Preview or CodeMirror */}
            {activeTabMode === 'preview' && previewKind === 'image' && (
              <div
                className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6 select-none"
                style={{
                  backgroundColor: '#f8fafc',
                  backgroundImage: `linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)`,
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                }}
              >
                {previewFile.dataUrl ? (
                  <img
                    src={previewFile.dataUrl}
                    alt={previewFile.path}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-md border border-black/10 bg-white"
                  />
                ) : (
                  <div className="text-sm text-slate-400">无法加载图片数据</div>
                )}
              </div>
            )}

            {activeTabMode === 'preview' && previewKind === 'markdown' && (
              <div className="flex-1 min-h-0 overflow-y-auto bg-white p-6 sm:p-12 select-text">
                <div className="markdown-body max-w-4xl mx-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {editContent || '*（空 Markdown 文档）*'}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {activeTabMode === 'preview' && previewKind === 'html' && (
              <div className="flex-1 min-h-0 overflow-hidden bg-white">
                <iframe
                  srcDoc={editContent}
                  title="HTML Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  className="w-full h-full border-0 bg-white"
                />
              </div>
            )}

            {activeTabMode === 'code' && (
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
            )}

            {/* Modal Footer */}
            {activeTabMode === 'preview' && previewKind === 'image' && (
              <div className="min-h-[38px] py-1.5 px-3 sm:px-6 border-t border-black/[0.06] bg-[#fbfaf7] flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-slate-400 flex-shrink-0 select-none pb-[max(0.375rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span>{previewFile.mimeType || '图片'}</span>
                  <span>·</span>
                  <span>{previewFile.size ? formatFileSize(previewFile.size) : '原图'}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <button onClick={handleDownloadImage} className="hover:text-slate-700 cursor-pointer transition-colors flex items-center gap-1 text-slate-500">
                    <Download size={12} />
                    <span>下载原图</span>
                  </button>
                  <span className="hidden sm:inline text-slate-300">·</span>
                  <span className="hidden sm:inline"><kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">Esc</kbd> 关闭窗口</span>
                </div>
              </div>
            )}

            {activeTabMode === 'preview' && previewKind === 'markdown' && (
              <div className="min-h-[38px] py-1.5 px-3 sm:px-6 border-t border-black/[0.06] bg-[#fbfaf7] flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-slate-400 flex-shrink-0 select-none pb-[max(0.375rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span>{lineCount} 行</span>
                  <span>·</span>
                  <span>{editContent.length} 字符</span>
                  <span className="hidden sm:inline">·</span>
                  <span className="hidden sm:inline">Markdown 渲染视图</span>
                </div>
                <div className="flex items-center gap-3 hidden sm:flex">
                  <span>切换到「源码编辑」可实时修改内容</span>
                  <span>·</span>
                  <span><kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">Esc</kbd> 关闭窗口</span>
                </div>
              </div>
            )}

            {activeTabMode === 'preview' && previewKind === 'html' && (
              <div className="min-h-[38px] py-1.5 px-3 sm:px-6 border-t border-black/[0.06] bg-[#fbfaf7] flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-slate-400 flex-shrink-0 select-none pb-[max(0.375rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span>HTML 沙箱网页</span>
                  <span>·</span>
                  <span>{formatFileSize(editContent.length)}</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <button onClick={handleOpenHtmlNewTab} className="hover:text-slate-700 cursor-pointer transition-colors flex items-center gap-1 text-slate-500">
                    <ExternalLink size={12} />
                    <span>新标签打开</span>
                  </button>
                  <span className="hidden sm:inline text-slate-300">·</span>
                  <span className="hidden sm:inline"><kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">Esc</kbd> 关闭窗口</span>
                </div>
              </div>
            )}

            {activeTabMode === 'code' && (
              <div className="min-h-[38px] py-1.5 px-3 sm:px-6 border-t border-black/[0.06] bg-[#fbfaf7] flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-slate-400 flex-shrink-0 select-none pb-[max(0.375rem,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-2 sm:gap-3">
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
                  <span><kbd className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700">Esc</kbd> 关闭窗口</span>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
