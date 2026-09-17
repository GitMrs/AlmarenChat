import React from 'react';
import {
  LayoutGrid,
  Plus,
  ChevronLeft,
  Search,
  X,
  Folder,
  Sparkles,
  Edit2,
  Trash2,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StudioWorkspaceItem } from '../types';

interface LeftSidebarProps {
  isLeftSidebarCollapsed: boolean;
  handleToggleLeftSidebar: (collapsed: boolean) => void;
  workspaces: StudioWorkspaceItem[];
  activeWorkspaceId: string;
  handleSwitchWorkspace: (id: string) => void;
  setShowCreateModal: (v: boolean) => void;
  searchWorkspaceQuery: string;
  setSearchWorkspaceQuery: (v: string) => void;
  filteredWorkspaces: StudioWorkspaceItem[];
  setEditWsName: (v: string) => void;
  setEditWsDesc: (v: string) => void;
  setEditWsPrompt: (v: string) => void;
  setShowEditModal: (v: boolean) => void;
  handleDeleteWorkspace: (id: string, name: string) => void;
  setShowSettingsModal: (v: boolean) => void;
  userProfile: any;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  isLeftSidebarCollapsed,
  handleToggleLeftSidebar,
  workspaces,
  activeWorkspaceId,
  handleSwitchWorkspace,
  setShowCreateModal,
  searchWorkspaceQuery,
  setSearchWorkspaceQuery,
  filteredWorkspaces,
  setEditWsName,
  setEditWsDesc,
  setEditWsPrompt,
  setShowEditModal,
  handleDeleteWorkspace,
  setShowSettingsModal,
  userProfile,
}) => {
  return (
    <>
      {/* Mobile Backdrop Overlay for Left Workspace Drawer */}
      {!isLeftSidebarCollapsed && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => handleToggleLeftSidebar(true)}
        />
      )}

      <aside
        className={cn(
          'flex flex-col bg-white/85 backdrop-blur-md border-r border-black/[0.06] transition-all duration-200 flex-shrink-0 select-none h-full shadow-xs',
          isLeftSidebarCollapsed
            ? 'hidden'
            : 'fixed md:relative inset-y-0 left-0 z-50 md:z-30 w-72 max-w-[85vw] md:w-64 shadow-xl md:shadow-none animate-in slide-in-from-left duration-200 md:animate-none'
        )}
      >
        {/* Sidebar Header */}
        <div className="h-14 border-b border-black/[0.06] px-3 flex items-center justify-between w-full bg-white/50">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-200/60 flex items-center justify-center text-indigo-600 flex-shrink-0">
              <LayoutGrid size={15} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-bold text-slate-900 truncate tracking-tight">
                项目工作空间
              </h2>
              <p className="text-[10px] text-slate-400 font-mono leading-none mt-0.5">
                {workspaces.length} 个沙箱
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-white shadow-xs transition-all cursor-pointer"
              title="新建工作空间"
            >
              <Plus size={13} />
            </button>
            <button
              onClick={() => handleToggleLeftSidebar(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="收起工作空间侧栏"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>

        {/* Search Input (Expanded Only) */}
        {!isLeftSidebarCollapsed && (
          <div className="px-3 pt-3 pb-1 w-full">
            <div className="relative flex items-center w-full">
              <Search
                size={13}
                className="absolute left-2.5 text-slate-400 pointer-events-none"
              />
              <input
                type="text"
                value={searchWorkspaceQuery}
                onChange={(e) => setSearchWorkspaceQuery(e.target.value)}
                placeholder="搜索空间..."
                className="w-full bg-[#fbfaf7] border border-black/[0.06] focus:border-indigo-500/60 focus:bg-white rounded-xl pl-8 pr-6 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none transition-all font-sans"
              />
              {searchWorkspaceQuery && (
                <button
                  onClick={() => setSearchWorkspaceQuery('')}
                  className="absolute right-2 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Workspace Items */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 custom-scrollbar w-full">
          {filteredWorkspaces.map((ws) => {
            const isSelected = ws.id === activeWorkspaceId;
            const hasRules = !!ws.systemPrompt;

            if (isLeftSidebarCollapsed) {
              return (
                <button
                  key={ws.id}
                  onClick={() => handleSwitchWorkspace(ws.id)}
                  title={`${ws.name}${hasRules ? ' (已配置规则)' : ''}`}
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center mx-auto transition-all cursor-pointer relative group',
                    isSelected
                      ? 'bg-slate-950 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  )}
                >
                  <Folder
                    size={17}
                    className={isSelected ? 'text-amber-300' : 'text-slate-400'}
                  />
                  {hasRules && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-500 ring-2 ring-white" />
                  )}
                </button>
              );
            }

            return (
              <div
                key={ws.id}
                onClick={() => handleSwitchWorkspace(ws.id)}
                className={cn(
                  'group/item relative flex items-start gap-2.5 px-2.5 py-2 rounded-xl transition-all cursor-pointer border',
                  isSelected
                    ? 'bg-white border-black/[0.08] shadow-xs text-slate-950 font-medium'
                    : 'border-transparent text-slate-600 hover:bg-white/60 hover:text-slate-900'
                )}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
                    isSelected
                      ? 'bg-amber-50 text-amber-600'
                      : 'bg-slate-100 text-slate-400 group-hover/item:text-slate-600'
                  )}
                >
                  <Folder size={14} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        'text-xs truncate',
                        isSelected ? 'font-bold text-slate-900' : 'font-medium'
                      )}
                    >
                      {ws.name}
                    </span>
                    {hasRules && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 border border-indigo-200/60 font-mono flex-shrink-0">
                        <Sparkles size={8} />
                        <span>规则</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 truncate mt-0.5">
                    {ws.description || '沙箱隔离环境'}
                  </p>
                </div>

                {/* Hover Actions */}
                <div className="absolute right-2 top-2 hidden group-hover/item:flex items-center gap-0.5 bg-white px-1 py-0.5 rounded-lg border border-black/[0.08] shadow-sm">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditWsName(ws.name);
                      setEditWsDesc(ws.description || '');
                      setEditWsPrompt(ws.systemPrompt || '');
                      setShowEditModal(true);
                    }}
                    className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-800 cursor-pointer"
                    title="编辑工作区"
                  >
                    <Edit2 size={11} />
                  </button>
                  {workspaces.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteWorkspace(ws.id, ws.name);
                      }}
                      className="p-1 hover:bg-rose-50 rounded text-slate-400 hover:text-rose-600 cursor-pointer"
                      title="删除工作区"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Sidebar Footer */}
        <div className="border-t border-black/[0.06] p-2 flex items-center justify-between w-full bg-white/40">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 text-xs transition-colors cursor-pointer w-full"
            title="Studio 配置与模型状态"
          >
            <Settings size={14} className="flex-shrink-0 text-slate-400" />
            <span className="text-[11px] truncate font-mono">
              {userProfile?.modelName || '默认模型'}
            </span>
          </button>
        </div>
      </aside>
    </>
  );
};
