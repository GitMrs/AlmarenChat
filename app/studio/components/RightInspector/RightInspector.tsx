import React from 'react';
import {
  FolderOpen,
  Users,
  PanelRightClose,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileNode, WorkspaceSkill, SkillPreset, StudioWorkspaceItem } from '../../types';
import { FilesTab } from './FilesTab';
import { RosterTab } from './RosterTab';

interface RightInspectorProps {
  isOpen: boolean;
  onToggleOpen: (open: boolean) => void;
  inspectorTab: 'files' | 'roster';
  setInspectorTab: (tab: 'files' | 'roster') => void;
  // Files tab props
  fileTree: FileNode[];
  activeWorkspaceName: string;
  isCreatingFile: boolean;
  setIsCreatingFile: (v: boolean) => void;
  newFileName: string;
  setNewFileName: (v: string) => void;
  handleCreateFile: () => void;
  fetchWorkspaceTree: () => void;
  isLoadingFiles: boolean;
  handleSelectFile: (node: FileNode) => void;
  handleDeleteFile: (path: string, e: React.MouseEvent) => void;
  previewFile: { path: string; content: string } | null;
  setPreviewFile: (v: { path: string; content: string } | null) => void;
  handleSaveFile: (path: string, content: string) => Promise<boolean>;
  // Roster tab props
  userProfile: any;
  isStreaming: boolean;
  workspaceSkills: WorkspaceSkill[];
  isLoadingSkills: boolean;
  skillPresets: SkillPreset[];
  activeWorkspace?: StudioWorkspaceItem;
  setShowSkillModal: (v: boolean) => void;
  setSkillModalTab: (tab: 'presets' | 'custom') => void;
  fetchWorkspaceSkills: () => void;
  fetchFleet: () => void;
  handleInstallPreset: (id: string) => void;
  handleToggleSkill: (id: string, currentEnabled: boolean) => void;
  setPreviewingSkill: (skill: WorkspaceSkill) => void;
  handleDeleteSkill: (id: string, name: string) => void;
  setEditWsName: (v: string) => void;
  setEditWsDesc: (v: string) => void;
  setEditWsPrompt: (v: string) => void;
  setShowRulesModal: (v: boolean) => void;
}

export const RightInspector: React.FC<RightInspectorProps> = ({
  isOpen,
  onToggleOpen,
  inspectorTab,
  setInspectorTab,
  fileTree,
  activeWorkspaceName,
  isCreatingFile,
  setIsCreatingFile,
  newFileName,
  setNewFileName,
  handleCreateFile,
  fetchWorkspaceTree,
  isLoadingFiles,
  handleSelectFile,
  handleDeleteFile,
  previewFile,
  setPreviewFile,
  handleSaveFile,
  userProfile,
  isStreaming,
  workspaceSkills,
  isLoadingSkills,
  skillPresets,
  activeWorkspace,
  setShowSkillModal,
  setSkillModalTab,
  fetchWorkspaceSkills,
  fetchFleet,
  handleInstallPreset,
  handleToggleSkill,
  setPreviewingSkill,
  handleDeleteSkill,
  setEditWsName,
  setEditWsDesc,
  setEditWsPrompt,
  setShowRulesModal,
}) => {
  if (!isOpen) return null;

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      <div
        className="md:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={() => onToggleOpen(false)}
      />

      <aside className="fixed md:relative inset-y-0 right-0 z-50 md:z-25 w-full sm:w-96 md:w-96 bg-white/85 backdrop-blur-md border-l border-black/[0.06] text-slate-900 flex flex-col flex-shrink-0 h-full select-none animate-in slide-in-from-right duration-200 shadow-2xl md:shadow-none">
        {/* Inspector Header Tabs (Sleek Segmented Switcher) */}
        <div className="h-14 border-b border-black/[0.06] px-3 flex items-center justify-between bg-[#fbfaf7]/70 flex-shrink-0">
          <div className="flex items-center gap-1 bg-black/[0.04] p-1 rounded-xl border border-black/[0.06]">
            <button
              onClick={() => {
                setInspectorTab('files');
                fetchWorkspaceTree();
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
                inspectorTab === 'files'
                  ? 'bg-white text-slate-900 shadow-xs border border-black/[0.08] font-semibold'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-black/[0.03]'
              )}
              title="工作区文件管理"
            >
              <FolderOpen
                size={13}
                className={inspectorTab === 'files' ? 'text-amber-500' : 'text-slate-400'}
              />
              <span>文件</span>
            </button>

            <button
              onClick={() => {
                setInspectorTab('roster');
                fetchFleet();
                fetchWorkspaceSkills();
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
                inspectorTab === 'roster'
                  ? 'bg-white text-indigo-600 shadow-xs border border-black/[0.08] font-semibold'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-black/[0.03]'
              )}
              title="智能体协同团队与技能库"
            >
              <Users
                size={13}
                className={inspectorTab === 'roster' ? 'text-indigo-600' : 'text-slate-400'}
              />
              <span>团队</span>
              {workspaceSkills.length > 0 && (
                <span
                  className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200/60 font-medium"
                  title={`已装配 ${workspaceSkills.length} 个工作区技能`}
                >
                  {workspaceSkills.length} 技能
                </span>
              )}
            </button>
          </div>

          <button
            onClick={() => onToggleOpen(false)}
            className="p-1.5 rounded-lg hover:bg-black/[0.05] text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            title="收起检视面板"
          >
            <PanelRightClose size={15} />
          </button>
        </div>

        {/* Inspector Body by Tab */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {inspectorTab === 'roster' ? (
            <RosterTab
              userProfile={userProfile}
              isStreaming={isStreaming}
              workspaceSkills={workspaceSkills}
              isLoadingSkills={isLoadingSkills}
              skillPresets={skillPresets}
              activeWorkspace={activeWorkspace}
              setShowSkillModal={setShowSkillModal}
              setSkillModalTab={setSkillModalTab}
              fetchWorkspaceSkills={fetchWorkspaceSkills}
              handleInstallPreset={handleInstallPreset}
              handleToggleSkill={handleToggleSkill}
              setPreviewingSkill={setPreviewingSkill}
              handleDeleteSkill={handleDeleteSkill}
              setEditWsName={setEditWsName}
              setEditWsDesc={setEditWsDesc}
              setEditWsPrompt={setEditWsPrompt}
              setShowRulesModal={setShowRulesModal}
            />
          ) : (
            <FilesTab
              activeWorkspaceName={activeWorkspaceName}
              isCreatingFile={isCreatingFile}
              setIsCreatingFile={setIsCreatingFile}
              newFileName={newFileName}
              setNewFileName={setNewFileName}
              handleCreateFile={handleCreateFile}
              fetchWorkspaceTree={fetchWorkspaceTree}
              isLoadingFiles={isLoadingFiles}
              fileTree={fileTree}
              handleSelectFile={handleSelectFile}
              handleDeleteFile={handleDeleteFile}
              previewFile={previewFile}
              setPreviewFile={setPreviewFile}
              handleSaveFile={handleSaveFile}
            />
          )}
        </div>
      </aside>
    </>
  );
};
