'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  Sparkles,
  PanelLeft,
  PanelRightClose,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WorkspaceSkill,
  SkillPreset,
  ToolInvocation,
  ChatMessage,
  StudioWorkspaceItem,
  FileNode,
  StudioConfig,
  StudioApprovalMode,
  DEFAULT_CONFIG,
} from './types';
import { LeftSidebar } from './components/LeftSidebar';
import { MessageList } from './components/MiddleChat/MessageList';
import { Composer } from './components/MiddleChat/Composer';
import { RightInspector } from './components/RightInspector/RightInspector';
import { AccountModelModal } from './components/modals/AccountModelModal';
import { WorkspaceRulesModal } from './components/modals/WorkspaceRulesModal';
import { CreateWorkspaceModal } from './components/modals/CreateWorkspaceModal';
import { EditWorkspaceModal } from './components/modals/EditWorkspaceModal';
import { InstallSkillModal } from './components/modals/InstallSkillModal';
import { SkillPreviewModal } from './components/modals/SkillPreviewModal';

export default function StudioPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Studio Workspaces state
  const [workspaces, setWorkspaces] = useState<StudioWorkspaceItem[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('');
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // 3-Column Layout & Dockable Inspector States (Knowe & Hermes Architecture)
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [searchWorkspaceQuery, setSearchWorkspaceQuery] = useState('');
  const [isRightInspectorOpen, setIsRightInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<'files' | 'roster'>('files');

  // Create Workspace Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [newWsDesc, setNewWsDesc] = useState('');
  const [newWsPrompt, setNewWsPrompt] = useState('');
  const [isCreatingWs, setIsCreatingWs] = useState(false);

  // Edit Workspace Modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [editWsName, setEditWsName] = useState('');
  const [editWsDesc, setEditWsDesc] = useState('');
  const [editWsPrompt, setEditWsPrompt] = useState('');
  const [isEditingWs, setIsEditingWs] = useState(false);

  // Token Usage State (Real-time tracking from API provider response.usage)
  const [totalTokens, setTotalTokens] = useState(0);
  const [contextLength, setContextLength] = useState(200000);
  const [remainingTokens, setRemainingTokens] = useState(200000);

  // Composer controls
  const [reasoningEffort, setReasoningEffort] = useState<'none' | 'low' | 'medium' | 'high'>('high');
  const [showReasoningMenu, setShowReasoningMenu] = useState(false);
  const [selectedModel, setSelectedModel] = useState('DeepSeek-V4');
  const [showModelMenu, setShowModelMenu] = useState(false);

  // Approval mode control
  const [approvalMode, setApprovalMode] = useState<'dangerous' | 'always' | 'never'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('almaren_studio_approval_mode') as any) || 'dangerous';
    }
    return 'dangerous';
  });
  const [showApprovalMenu, setShowApprovalMenu] = useState(false);
  const [approvingToolId, setApprovingToolId] = useState<string | null>(null);

  const handleSelectApprovalMode = (mode: 'dangerous' | 'always' | 'never') => {
    setApprovalMode(mode);
    setShowApprovalMenu(false);
    try {
      localStorage.setItem('almaren_studio_approval_mode', mode);
    } catch {
      // Ignore
    }
  };

  const handleDecisionTool = async (approvalId: string, action: 'approve' | 'deny', toolCallId: string, reason?: string) => {
    setApprovingToolId(approvalId);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/studio/approval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ approvalId, action, reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '审批提交失败');
      }

      // Optimistically update message tool state
      setMessages((prev) =>
        prev.map((m) => ({
          ...m,
          tools: (m.tools || []).map((t) => {
            if (t.id === toolCallId || t.approvalId === approvalId) {
              return {
                ...t,
                status: action === 'approve' ? 'running' : 'denied',
                result: action === 'deny' ? (reason || '用户已手动拒绝该操作') : t.result,
              };
            }
            return t;
          }),
        }))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(msg);
    } finally {
      setApprovingToolId(null);
    }
  };

  // Modals & Panels
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [studioConfig, setStudioConfig] = useState<StudioConfig>(DEFAULT_CONFIG);
  const [showApiKeySecrets, setShowApiKeySecrets] = useState<Record<string, boolean>>({});
  const [userProfile, setUserProfile] = useState<{
    name?: string;
    email?: string;
    modelName?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    modelContextWindow?: number;
    customModelEnabled?: boolean;
  } | null>(null);

  // Tool details & Live Terminal Modal
  const [inspectingTool, setInspectingTool] = useState<ToolInvocation | null>(null);
  const [liveTerminalLogs, setLiveTerminalLogs] = useState<string[]>([]);
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [subSessionStatus, setSubSessionStatus] = useState<string>('RUNNING');
  const [isKillingSession, setIsKillingSession] = useState(false);
  const [copiedToolResult, setCopiedToolResult] = useState(false);
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(new Set());

  // Workspace Skills Management
  const [workspaceSkills, setWorkspaceSkills] = useState<WorkspaceSkill[]>([]);
  const [skillPresets, setSkillPresets] = useState<any[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [skillModalTab, setSkillModalTab] = useState<'presets' | 'custom'>('presets');
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDesc, setNewSkillDesc] = useState('');
  const [newSkillContent, setNewSkillContent] = useState('');
  const [isSubmittingSkill, setIsSubmittingSkill] = useState(false);
  const [previewingSkill, setPreviewingSkill] = useState<WorkspaceSkill | null>(null);

  // Agent Fleet Drawer
  const [showAgentFleet, setShowAgentFleet] = useState(false);
  const [fleetAgents, setFleetAgents] = useState<any[]>([]);
  const [isLoadingFleet, setIsLoadingFleet] = useState(false);

  // Workspace File Explorer Drawer
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ path: string; content: string } | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const [isCreatingFile, setIsCreatingFile] = useState(false);

  const [copySuccess, setCopySuccess] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  const getAuthToken = () => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('token') || '';
  };

  // Sync active workspace to URL query (?workspace=...) without triggering a full page reload
  const syncWorkspaceToUrl = (wsId: string, replace = false) => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('workspace') === wsId) return;
      url.searchParams.set('workspace', wsId);
      if (replace) {
        window.history.replaceState({ workspaceId: wsId }, '', url.toString());
      } else {
        window.history.pushState({ workspaceId: wsId }, '', url.toString());
      }
    } catch {
      // Ignore
    }
  };

  // Left sidebar toggle with persistence
  const handleToggleLeftSidebar = (collapsed: boolean) => {
    setIsLeftSidebarCollapsed(collapsed);
    try {
      localStorage.setItem('almaren_studio_left_collapsed', collapsed ? 'true' : 'false');
    } catch {
      // Ignore
    }
  };

  // Right workstation toggle with persistence
  const handleToggleRightInspector = (open: boolean) => {
    setIsRightInspectorOpen(open);
    try {
      localStorage.setItem('almaren_studio_right_open', open ? 'true' : 'false');
    } catch {
      // Ignore
    }
  };

  // Toggle voice speech recognition (Web Speech API)
  const handleToggleVoice = () => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('您的浏览器暂不支持 Web Speech 语音识别，推荐使用最新版 Chrome 或 Edge 浏览器。');
      return;
    }

    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore
      }
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = true;

      let baseText = input;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(baseText ? `${baseText.trim()} ${transcript}` : transcript);
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition', err);
      setIsListening(false);
    }
  };

  // Load saved config
  useEffect(() => {
    try {
      const saved = localStorage.getItem('almaren_studio_config');
      if (saved) {
        setStudioConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
      }
    } catch {
      // Ignore
    }
  }, []);

  // Fetch logged in user profile & model configuration
  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const token = getAuthToken();
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUserProfile(data.user);
            if (data.user.modelName) {
              setSelectedModel(data.user.modelName);
            }
            if (data.user.modelContextWindow) {
              setContextLength(data.user.modelContextWindow);
              setRemainingTokens(Math.max(0, data.user.modelContextWindow - totalTokens));
            }
          }
        }
      } catch {
        // Ignore
      }
    };
    fetchUserProfile();
  }, []);

  // Restore sidebar collapse states from localStorage (or auto-collapse on mobile < 768px)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.innerWidth < 768) {
      setIsLeftSidebarCollapsed(true);
      setIsRightInspectorOpen(false);
      return;
    }

    try {
      const savedLeft = localStorage.getItem('almaren_studio_left_collapsed');
      if (savedLeft !== null) {
        setIsLeftSidebarCollapsed(savedLeft === 'true');
      }

      const savedRight = localStorage.getItem('almaren_studio_right_open');
      if (savedRight !== null) {
        setIsRightInspectorOpen(savedRight === 'true');
      }
    } catch {
      // Ignore
    }
  }, []);

  const saveConfig = (newConfig: StudioConfig) => {
    setStudioConfig(newConfig);
    try {
      localStorage.setItem('almaren_studio_config', JSON.stringify(newConfig));
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Load Messages for a Studio Workspace
  const loadWorkspaceMessages = async (wsId: string) => {
    if (!wsId) return;
    setIsLoadingMessages(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/workspaces/${wsId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const loaded: ChatMessage[] = (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant' | 'tool',
          content: m.content || '',
          tools: Array.isArray(m.tools) ? m.tools : [],
          tokens: m.tokens,
          timestamp: new Date(m.createdAt).getTime(),
        }));
        setMessages(loaded);

        // Compute total tokens used in this workspace
        const sumTokens = loaded.reduce((acc, cur) => acc + (cur.tokens || 0), 0);
        setTotalTokens(sumTokens);
        setRemainingTokens(Math.max(0, contextLength - sumTokens));
      }
    } catch (err) {
      console.error('Failed to load workspace messages:', err);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  // Fetch Studio Workspaces
  const fetchWorkspaces = async () => {
    setIsLoadingWorkspaces(true);
    try {
      const token = getAuthToken();
      const res = await fetch('/api/studio/workspaces', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const list: StudioWorkspaceItem[] = data.workspaces || [];
        setWorkspaces(list);

        if (list.length > 0) {
          // Priority 1: URL Query (?workspace=wsId)
          let targetId = '';
          if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            const queryWsId = urlParams.get('workspace');
            if (queryWsId && list.some((w) => w.id === queryWsId)) {
              targetId = queryWsId;
            }
          }

          // Priority 2: localStorage (Last visited workspace)
          if (!targetId) {
            const savedId = localStorage.getItem('almaren_studio_active_workspace');
            const matched = list.find((w) => w.id === savedId);
            if (matched) {
              targetId = matched.id;
            }
          }

          // Priority 3: First default workspace in the list
          if (!targetId) {
            targetId = list[0].id;
          }

          setActiveWorkspaceId(targetId);
          localStorage.setItem('almaren_studio_active_workspace', targetId);
          // Sync to URL silently (replaceState so we don't mess up browser back history on first load)
          syncWorkspaceToUrl(targetId, true);

          await loadWorkspaceMessages(targetId);
          fetchWorkspaceSkills(targetId);
        }
      }
    } catch (err) {
      console.error('Failed to fetch workspaces:', err);
    } finally {
      setIsLoadingWorkspaces(false);
    }
  };

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  // Listen for browser navigation (forward / backward buttons)
  useEffect(() => {
    const handlePopState = () => {
      if (typeof window === 'undefined') return;
      const urlParams = new URLSearchParams(window.location.search);
      const queryWsId = urlParams.get('workspace');
      if (queryWsId && queryWsId !== activeWorkspaceId && workspaces.some((w) => w.id === queryWsId)) {
        setActiveWorkspaceId(queryWsId);
        localStorage.setItem('almaren_studio_active_workspace', queryWsId);
        setPreviewFile(null);
        loadWorkspaceMessages(queryWsId);
        fetchWorkspaceSkills(queryWsId);
        if (showFileExplorer) {
          fetchWorkspaceTree(queryWsId);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeWorkspaceId, workspaces, showFileExplorer]);

  const handleSwitchWorkspace = (wsId: string) => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsLeftSidebarCollapsed(true);
    }
    if (wsId === activeWorkspaceId) {
      setShowWorkspaceMenu(false);
      return;
    }
    setActiveWorkspaceId(wsId);
    setShowWorkspaceMenu(false);
    localStorage.setItem('almaren_studio_active_workspace', wsId);
    syncWorkspaceToUrl(wsId, false); // pushState so back button works!
    setPreviewFile(null);
    loadWorkspaceMessages(wsId);
    fetchWorkspaceSkills(wsId);
    if (showFileExplorer) {
      fetchWorkspaceTree(wsId);
    }
  };

  const handleCreateWorkspace = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newWsName.trim() || isCreatingWs) return;
    setIsCreatingWs(true);
    try {
      const token = getAuthToken();
      const res = await fetch('/api/studio/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newWsName.trim(),
          description: newWsDesc.trim() || undefined,
          systemPrompt: newWsPrompt.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const created: StudioWorkspaceItem = data.workspace;
        setWorkspaces((prev) => [...prev, created]);
        setActiveWorkspaceId(created.id);
        localStorage.setItem('almaren_studio_active_workspace', created.id);
        syncWorkspaceToUrl(created.id, false);
        setMessages([]);
        setTotalTokens(0);
        setRemainingTokens(contextLength);
        setShowCreateModal(false);
        setNewWsName('');
        setNewWsDesc('');
        setNewWsPrompt('');
        setShowWorkspaceMenu(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '创建工作区失败');
      }
    } catch (err) {
      alert('创建工作区出错: ' + String(err));
    } finally {
      setIsCreatingWs(false);
    }
  };

  const handleDeleteWorkspace = async (wsId: string, wsName: string) => {
    if (workspaces.length <= 1) {
      alert('必须保留至少一个工作空间，无法删除唯一的工作区。');
      return;
    }
    if (!confirm(`确定要删除工作区【${wsName}】吗？\n\n警告：该工作区下的所有历史聊天记录及独立沙箱文件将被永久删除！`)) {
      return;
    }
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/workspaces/${wsId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const remaining = workspaces.filter((w) => w.id !== wsId);
        setWorkspaces(remaining);
        if (activeWorkspaceId === wsId) {
          const nextWs = remaining[0];
          setActiveWorkspaceId(nextWs.id);
          localStorage.setItem('almaren_studio_active_workspace', nextWs.id);
          syncWorkspaceToUrl(nextWs.id, true);
          loadWorkspaceMessages(nextWs.id);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '删除工作区失败');
      }
    } catch (err) {
      alert('删除工作区出错: ' + String(err));
    }
  };

  const handleEditWorkspace = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editWsName.trim() || isEditingWs || !activeWorkspaceId) return;
    setIsEditingWs(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/workspaces/${activeWorkspaceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: editWsName.trim(),
          description: editWsDesc.trim() || undefined,
          systemPrompt: editWsPrompt.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated: StudioWorkspaceItem = data.workspace;
        setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
        setShowEditModal(false);
        setShowRulesModal(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || '修改工作区失败');
      }
    } catch (err) {
      alert('修改工作区出错: ' + String(err));
    } finally {
      setIsEditingWs(false);
    }
  };

  // Fetch Fleet Agents
  const fetchFleet = async () => {
    setIsLoadingFleet(true);
    try {
      const token = getAuthToken();
      const res = await fetch('/api/studio/coding-agents', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFleetAgents(data.agents || []);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoadingFleet(false);
    }
  };

  // Fetch Workspace Tree
  const fetchWorkspaceTree = async (wsId = activeWorkspaceId) => {
    if (!wsId) return;
    setIsLoadingFiles(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/workspace?workspaceId=${wsId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFileTree(data.tree || []);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleOpenFileExplorer = () => {
    handleToggleRightInspector(true);
    setInspectorTab('files');
    fetchWorkspaceTree();
  };

  const handleSelectFile = async (node: FileNode) => {
    if (node.isDirectory || !activeWorkspaceId) return;
    try {
      const token = getAuthToken();
      const res = await fetch(
        `/api/studio/workspace?workspaceId=${activeWorkspaceId}&file=${encodeURIComponent(node.path)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setPreviewFile(data);
      }
    } catch {
      // Ignore
    }
  };

  const handleSaveFile = async (filePath: string, content: string): Promise<boolean> => {
    if (!activeWorkspaceId || !filePath) return false;
    try {
      const token = getAuthToken();
      const res = await fetch('/api/studio/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          file: filePath,
          content,
        }),
      });
      if (res.ok) {
        setPreviewFile({ path: filePath, content });
        fetchWorkspaceTree();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim() || !activeWorkspaceId) return;
    try {
      const token = getAuthToken();
      const res = await fetch('/api/studio/workspace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          file: newFileName.trim(),
          content: '',
        }),
      });
      if (res.ok) {
        setNewFileName('');
        setIsCreatingFile(false);
        fetchWorkspaceTree();
      }
    } catch {
      // Ignore
    }
  };

  const handleDeleteFile = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`确认删除文件 ${path}？`) || !activeWorkspaceId) return;
    try {
      const token = getAuthToken();
      const res = await fetch(
        `/api/studio/workspace?workspaceId=${activeWorkspaceId}&file=${encodeURIComponent(path)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        if (previewFile?.path === path) setPreviewFile(null);
        fetchWorkspaceTree();
      }
    } catch {
      // Ignore
    }
  };

  const handleOpenFleet = () => {
    setIsRightInspectorOpen(true);
    setInspectorTab('roster');
    fetchFleet();
  };

  // Live Terminal Stream for Subagent Session
  useEffect(() => {
    if (!inspectingTool) {
      return;
    }

    if (!inspectingTool.sessionId) {
      if (inspectingTool.result) {
        setLiveTerminalLogs([inspectingTool.result]);
      } else {
        setLiveTerminalLogs([]);
      }
      setSubSessionStatus(
        inspectingTool.status === 'failed'
          ? 'FAILED'
          : inspectingTool.status === 'done' || inspectingTool.status === 'completed'
          ? 'COMPLETED'
          : inspectingTool.status === 'running'
          ? 'RUNNING'
          : 'COMPLETED'
      );
      setIsLiveStreaming(inspectingTool.status === 'running');
      return;
    }

    const sessionId = inspectingTool.sessionId;
    let eventSource: EventSource | null = null;
    let isCancelled = false;

    // Set initial fallback logs from snapshot
    if (inspectingTool.result) {
      setLiveTerminalLogs([inspectingTool.result]);
    } else {
      setLiveTerminalLogs(['[SYSTEM] 正在查询任务状态与日志...']);
    }

    const token = getAuthToken();

    // 1. Fetch real session details to get authoritative status and past logs
    fetch(`/api/studio/coding-agents/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isCancelled) return;
        if (data?.session) {
          const s = data.session;
          setSubSessionStatus(s.status);
          if (Array.isArray(s.logs) && s.logs.length > 0) {
            setLiveTerminalLogs(s.logs);
          }

          if (s.status === 'RUNNING') {
            setIsLiveStreaming(true);
            connectEventSource();
          } else {
            setIsLiveStreaming(false);
          }
        } else {
          // Session not in memory (finished previously or server restarted)
          const fallbackStatus =
            inspectingTool.status === 'failed'
              ? 'FAILED'
              : inspectingTool.status === 'done' || inspectingTool.status === 'completed'
              ? 'COMPLETED'
              : 'STOPPED';
          setSubSessionStatus(fallbackStatus);
          setIsLiveStreaming(false);
        }
      })
      .catch(() => {
        if (isCancelled) return;
        setSubSessionStatus(inspectingTool.status === 'failed' ? 'FAILED' : 'COMPLETED');
        setIsLiveStreaming(false);
      });

    function connectEventSource() {
      if (isCancelled) return;
      eventSource = new EventSource(
        `/api/studio/coding-agents/sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`
      );

      eventSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'stdout' || payload.type === 'stderr') {
            setLiveTerminalLogs((prev) => [...prev, payload.data]);
          } else if (payload.type === 'status') {
            let s = payload.status;
            try {
              const parsed = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
              if (parsed?.status) s = parsed.status;
            } catch {}
            if (s) setSubSessionStatus(s);
            if (s && s !== 'RUNNING') {
              setIsLiveStreaming(false);
            }
          } else if (payload.type === 'exit') {
            let s = 'COMPLETED';
            try {
              const parsed = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
              if (parsed?.status) s = parsed.status;
              else if (parsed?.code !== 0) s = 'FAILED';
            } catch {}
            setSubSessionStatus(s);
            setIsLiveStreaming(false);
            eventSource?.close();
          }
        } catch {
          setLiveTerminalLogs((prev) => [...prev, e.data]);
        }
        terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      };

      eventSource.onerror = () => {
        setIsLiveStreaming(false);
        if (inspectingTool.status === 'done' || inspectingTool.status === 'completed') {
          setSubSessionStatus('COMPLETED');
        } else if (inspectingTool.status === 'failed') {
          setSubSessionStatus('FAILED');
        }
        eventSource?.close();
      };
    }

    return () => {
      isCancelled = true;
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [inspectingTool]);

  // Kill Session Handler
  const handleKillSession = async (sessionId: string) => {
    if (!confirm('确认强制强杀此子进程？')) return;
    setIsKillingSession(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/coding-agents/sessions/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'stop' }),
      });
      if (res.ok) {
        setSubSessionStatus('STOPPED');
        setLiveTerminalLogs((prev) => [...prev, '[SYSTEM] ⚠️ 已向子进程树发送 SIGKILL 强杀信号。']);
      }
    } catch (err) {
      alert('强杀失败: ' + String(err));
    } finally {
      setIsKillingSession(false);
    }
  };

  const handleCopyChat = () => {
    const text = messages
      .map((m) => {
        const header = m.role === 'user' ? '### 👤 用户' : '### 🤖 协调智能体 (Coordinator)';
        const toolsText =
          m.tools
            ?.map((t) => `- [工具] ${t.name} (${t.agentId || ''}): ${t.preview} [状态: ${t.status}]`)
            .join('\n') || '';
        return `${header}\n${toolsText ? toolsText + '\n\n' : ''}${m.content || ''}`;
      })
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleCopyToolResult = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedToolResult(true);
    setTimeout(() => setCopiedToolResult(false), 2000);
  };

  const toggleToolExpand = (toolId: string) => {
    setExpandedToolIds((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const fetchWorkspaceSkills = async (wsId?: string) => {
    const targetId = wsId || activeWorkspaceId;
    if (!targetId) return;
    setIsLoadingSkills(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/workspaces/${targetId}/skills`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setWorkspaceSkills(data.skills || []);
        setSkillPresets(data.presets || []);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoadingSkills(false);
    }
  };

  const handleToggleSkill = async (skillId: string, currentEnabled: boolean) => {
    if (!activeWorkspaceId) return;
    const nextEnabled = !currentEnabled;
    setWorkspaceSkills((prev) =>
      prev.map((s) => (s.id === skillId ? { ...s, enabled: nextEnabled } : s))
    );
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/workspaces/${activeWorkspaceId}/skills`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ skillId, enabled: nextEnabled }),
      });
      if (!res.ok) {
        fetchWorkspaceSkills();
      }
    } catch {
      fetchWorkspaceSkills();
    }
  };

  const handleDeleteSkill = async (skillId: string, skillName: string) => {
    if (!activeWorkspaceId) return;
    if (!confirm(`确定彻底卸载技能【${skillName}】？该目录将从工作区沙箱中移除。`)) {
      return;
    }
    setWorkspaceSkills((prev) => prev.filter((s) => s.id !== skillId));
    try {
      const token = getAuthToken();
      await fetch(
        `/api/studio/workspaces/${activeWorkspaceId}/skills?skillId=${encodeURIComponent(skillId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      fetchWorkspaceTree();
    } catch {
      fetchWorkspaceSkills();
    }
  };

  const handleInstallPreset = async (presetId: string) => {
    if (!activeWorkspaceId) return;
    setIsSubmittingSkill(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/workspaces/${activeWorkspaceId}/skills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'preset', presetId }),
      });
      if (res.ok) {
        setShowSkillModal(false);
        fetchWorkspaceSkills();
        fetchWorkspaceTree();
      }
    } finally {
      setIsSubmittingSkill(false);
    }
  };

  const handleCreateCustomSkill = async () => {
    if (!activeWorkspaceId || !newSkillName.trim()) return;
    setIsSubmittingSkill(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/workspaces/${activeWorkspaceId}/skills`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'custom',
          name: newSkillName.trim(),
          description: newSkillDesc.trim(),
          content: newSkillContent.trim(),
        }),
      });
      if (res.ok) {
        setShowSkillModal(false);
        setNewSkillName('');
        setNewSkillDesc('');
        setNewSkillContent('');
        fetchWorkspaceSkills();
        fetchWorkspaceTree();
      }
    } finally {
      setIsSubmittingSkill(false);
    }
  };

  const handleResetChat = async () => {
    if (!activeWorkspaceId) return;
    if (!confirm(`确认清空当前工作区【${activeWorkspaceName}】的全部历史聊天记录？`)) {
      return;
    }
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/studio/workspaces/${activeWorkspaceId}/messages`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setMessages([]);
        setTotalTokens(0);
        setRemainingTokens(contextLength);
      }
    } catch (err) {
      alert('清空聊天记录失败: ' + String(err));
    }
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  };

  const usagePercent = Math.min(100, Math.round((totalTokens / contextLength) * 100));

  // Send Message & Stream Response
  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMessageId = `msg-user-${Date.now()}`;
    const assistantMessageId = `msg-asst-${Date.now()}`;

    // Add user message to state
    setMessages((prev) => [
      ...prev,
      {
        id: userMessageId,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        tools: [],
        timestamp: Date.now(),
      },
    ]);

    setIsStreaming(true);

    try {
      const token = getAuthToken();
      const res = await fetch('/api/studio/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          workspaceId: activeWorkspaceId,
          spaceId: activeWorkspaceId,
          reasoningEffort,
          approvalMode,
          modelName: studioConfig.coordinatorModel || selectedModel,
          apiBaseUrl: studioConfig.coordinatorBaseUrl || undefined,
          apiKey: studioConfig.coordinatorApiKey || undefined,
          agentKeys: {
            anthropicApiKey: studioConfig.anthropicApiKey || undefined,
            openaiApiKey: studioConfig.openaiApiKey || undefined,
            deepseekApiKey: studioConfig.deepseekApiKey || undefined,
          },
          history: messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role, content: m.content || '' })),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '请求失败');
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));

              if (event.type === 'tool.approval_requested') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          tools: [
                            ...(m.tools || []),
                            {
                              id: event.data.toolCallId,
                              approvalId: event.data.approvalId,
                              name: event.data.toolName,
                              preview: event.data.toolPreview,
                              args: event.data.args,
                              status: 'waiting_approval',
                            },
                          ],
                        }
                      : m
                  )
                );
                // Auto expand tool card when waiting approval
                if (event.data.toolCallId) {
                  setExpandedToolIds((prev) => new Set(prev).add(event.data.toolCallId));
                }
              } else if (event.type === 'tool.started') {
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantMessageId) return m;
                    const existingIndex = (m.tools || []).findIndex((t) => t.id === event.data.toolCallId);
                    if (existingIndex >= 0) {
                      const updatedTools = [...(m.tools || [])];
                      updatedTools[existingIndex] = {
                        ...updatedTools[existingIndex],
                        status: 'running',
                        preview: event.data.toolPreview || updatedTools[existingIndex].preview,
                        sessionId: event.data.sessionId,
                        agentId: event.data.agentId,
                      };
                      return { ...m, tools: updatedTools };
                    }
                    return {
                      ...m,
                      tools: [
                        ...(m.tools || []),
                        {
                          id: event.data.toolCallId,
                          name: event.data.toolName,
                          preview: event.data.toolPreview,
                          sessionId: event.data.sessionId,
                          agentId: event.data.agentId,
                          status: 'running',
                        },
                      ],
                    };
                  })
                );
              } else if (event.type === 'tool.completed') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          tools: (m.tools || []).map((t) =>
                            t.id === event.data.toolCallId
                              ? {
                                  ...t,
                                  status: 'done',
                                  result: event.data.result,
                                  sessionId: event.data.sessionId || t.sessionId,
                                  agentId: event.data.agentId || t.agentId,
                                }
                              : t
                          ),
                        }
                      : m
                  )
                );
                setInspectingTool((prev) =>
                  prev && prev.id === event.data.toolCallId
                    ? {
                        ...prev,
                        status: 'done',
                        result: event.data.result,
                        sessionId: event.data.sessionId || prev.sessionId,
                        agentId: event.data.agentId || prev.agentId,
                      }
                    : prev
                );
              } else if (event.type === 'tool.failed') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          tools: (m.tools || []).map((t) =>
                            t.id === event.data.toolCallId
                              ? {
                                  ...t,
                                  status: event.data?.isDenied ? 'denied' : 'failed',
                                  result: event.data.error,
                                  sessionId: event.data.sessionId || t.sessionId,
                                }
                              : t
                          ),
                        }
                      : m
                  )
                );
                setInspectingTool((prev) =>
                  prev && prev.id === event.data.toolCallId
                    ? {
                        ...prev,
                        status: 'failed',
                        result: event.data.error,
                        sessionId: event.data.sessionId || prev.sessionId,
                      }
                    : prev
                );
              } else if (event.type === 'terminal.chunk') {
                const chunkText = event.data?.text || '';
                if (chunkText) {
                  setLiveTerminalLogs((prev) => {
                    const clean = chunkText.endsWith('\n') ? chunkText.slice(0, -1) : chunkText;
                    return [...prev, clean].slice(-200);
                  });
                  terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                }
              } else if (event.type === 'message.delta') {
                const chunk = event.data?.delta ?? event.data?.text ?? '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, content: (m.content || '') + chunk }
                      : m
                  )
                );
              } else if (event.type === 'usage.updated') {
                setTotalTokens(event.data.totalTokens);
                setContextLength(event.data.contextLength);
                setRemainingTokens(event.data.remainingTokens);
              } else if (event.type === 'run.failed') {
                const failMsg = event.data?.error || '运行中断，请稍后重试';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? { ...m, content: (m.content || '') + `\n\n> ⚠️ 运行失败: ${failMsg}` }
                      : m
                  )
                );
              }
            } catch {
              // Ignore line parse error
            }
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantMessageId) return m;
          // Connection dropped while awaiting approval — the server-side run
          // was aborted too, so the pending buttons would 404 on click
          const tools = (m.tools || []).map((t) =>
            t.status === 'waiting_approval'
              ? { ...t, status: 'denied' as const, result: '连接中断，本次审批已自动取消' }
              : t
          );
          return { ...m, tools, content: (m.content || '') + `\n\n> ⚠️ 执行出错: ${errMsg}` };
        })
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0];
  const activeWorkspaceName = activeWorkspace?.name || '默认工作区';

  const filteredWorkspaces = workspaces.filter((ws) => {
    if (!searchWorkspaceQuery.trim()) return true;
    const q = searchWorkspaceQuery.toLowerCase();
    return ws.name.toLowerCase().includes(q) || (ws.description && ws.description.toLowerCase().includes(q));
  });

  return (
    <div className="flex h-full bg-[#fbfaf7] text-slate-900 font-sans selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      {/* ── 1. LEFT COLUMN: Workspace List Sidebar ── */}
      <LeftSidebar
        isLeftSidebarCollapsed={isLeftSidebarCollapsed}
        handleToggleLeftSidebar={handleToggleLeftSidebar}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        handleSwitchWorkspace={handleSwitchWorkspace}
        setShowCreateModal={setShowCreateModal}
        searchWorkspaceQuery={searchWorkspaceQuery}
        setSearchWorkspaceQuery={setSearchWorkspaceQuery}
        filteredWorkspaces={filteredWorkspaces}
        setEditWsName={setEditWsName}
        setEditWsDesc={setEditWsDesc}
        setEditWsPrompt={setEditWsPrompt}
        setShowEditModal={setShowEditModal}
        handleDeleteWorkspace={handleDeleteWorkspace}
        setShowSettingsModal={setShowSettingsModal}
        userProfile={userProfile}
      />

      {/* ── 2. MIDDLE COLUMN: Team Group Chat Stream & Composer ── */}
      <main className="flex-1 flex flex-col h-full bg-[#fbfaf7] min-w-0 relative">
        {/* Middle Header Bar */}
        <header className="h-14 border-b border-black/[0.06] bg-[#fbfaf7]/90 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between flex-shrink-0 z-20">
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            {/* Sidebar toggle button: shown ONLY when collapsed (Mode A) */}
            {isLeftSidebarCollapsed && (
              <button
                onClick={() => handleToggleLeftSidebar(false)}
                className="p-1.5 rounded-lg hover:bg-slate-200/70 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer flex-shrink-0"
                title="展开工作空间列表"
              >
                <PanelLeft size={16} />
              </button>
            )}

            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
              <Folder size={15} className="text-amber-500 flex-shrink-0" />
              <h1 className="text-xs sm:text-sm font-black text-slate-900 truncate tracking-tight max-w-[100px] xs:max-w-[150px] sm:max-w-none">
                {activeWorkspaceName}
              </h1>
              <span className="hidden md:inline-flex text-[10px] text-slate-500 font-mono px-2 py-0.5 rounded-full bg-white border border-black/[0.06] shadow-2xs flex-shrink-0">
                沙箱隔离
              </span>
            </div>

            {/* Workspace Rules Trigger */}
            <button
              onClick={() => {
                setEditWsName(activeWorkspace?.name || '');
                setEditWsDesc(activeWorkspace?.description || '');
                setEditWsPrompt(activeWorkspace?.systemPrompt || '');
                setShowRulesModal(true);
              }}
              className={cn(
                'flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border text-xs transition-all cursor-pointer font-bold shadow-2xs flex-shrink-0',
                activeWorkspace?.systemPrompt
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                  : 'bg-white text-slate-600 border-black/[0.08] hover:bg-slate-50 hover:text-slate-900'
              )}
              title={
                activeWorkspace?.systemPrompt
                  ? '当前工作区已配置专属提示词规范，点击查看或编辑'
                  : '为当前工作区设定专属提示词与项目规范'
              }
            >
              <Sparkles
                size={12}
                className={activeWorkspace?.systemPrompt ? 'text-indigo-600' : 'text-slate-400'}
              />
              <span className="text-[11px] hidden sm:inline">
                {activeWorkspace?.systemPrompt ? '空间规则 (已生效)' : '+ 空间规则'}
              </span>
              <span className="text-[11px] sm:hidden">
                {activeWorkspace?.systemPrompt ? '规则' : '+规则'}
              </span>
            </button>
          </div>

          {/* Right Controls: Workstation Panel Toggle (Shown only when inspector is closed) */}
          {!isRightInspectorOpen && (
            <div className="flex items-center flex-shrink-0 animate-in fade-in duration-150">
              <button
                onClick={() => handleToggleRightInspector(true)}
                className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer bg-white hover:bg-slate-50 text-slate-700 border-black/[0.08] shadow-xs"
                title="展开右侧工作台检视面板 (文件/团队)"
              >
                <PanelRightClose size={14} className="rotate-180 text-indigo-600" />
                <span className="text-[11px] sm:text-xs">工作台</span>
              </button>
            </div>
          )}
        </header>

        {/* 2. Message List Area */}
        <MessageList
          messages={messages}
          isLoadingMessages={isLoadingMessages}
          activeWorkspaceName={activeWorkspaceName}
          onQuickPrompt={(cmd) => setInput(cmd)}
          expandedToolIds={expandedToolIds}
          toggleToolExpand={toggleToolExpand}
          approvingToolId={approvingToolId}
          handleDecisionTool={handleDecisionTool}
          copiedToolResult={copiedToolResult}
          handleCopyToolResult={handleCopyToolResult}
          isStreaming={isStreaming}
          messagesEndRef={messagesEndRef}
        />

        {/* 3. Bottom Composer Box */}
        <div className="p-2 sm:p-4 flex-shrink-0 relative z-20">
          <Composer
            totalTokens={totalTokens}
            contextLength={contextLength}
            remainingTokens={remainingTokens}
            usagePercent={usagePercent}
            formatTokens={formatTokens}
            input={input}
            setInput={setInput}
            handleKeyDown={handleKeyDown}
            textareaRef={textareaRef}
            isStreaming={isStreaming}
            handleOpenFileExplorer={handleOpenFileExplorer}
            reasoningEffort={reasoningEffort}
            setReasoningEffort={setReasoningEffort}
            showReasoningMenu={showReasoningMenu}
            setShowReasoningMenu={setShowReasoningMenu}
            approvalMode={approvalMode}
            handleSelectApprovalMode={handleSelectApprovalMode}
            showApprovalMenu={showApprovalMenu}
            setShowApprovalMenu={setShowApprovalMenu}
            userProfile={userProfile}
            setShowSettingsModal={setShowSettingsModal}
            isListening={isListening}
            handleToggleVoice={handleToggleVoice}
            handleSend={handleSend}
          />
        </div>
      </main>

      {/* ── 3. RIGHT COLUMN: Dockable Workspace Inspector ── */}
      <RightInspector
        isOpen={isRightInspectorOpen}
        onToggleOpen={handleToggleRightInspector}
        inspectorTab={inspectorTab}
        setInspectorTab={setInspectorTab}
        fileTree={fileTree}
        activeWorkspaceName={activeWorkspaceName}
        isCreatingFile={isCreatingFile}
        setIsCreatingFile={setIsCreatingFile}
        newFileName={newFileName}
        setNewFileName={setNewFileName}
        handleCreateFile={handleCreateFile}
        fetchWorkspaceTree={fetchWorkspaceTree}
        isLoadingFiles={isLoadingFiles}
        handleSelectFile={handleSelectFile}
        handleDeleteFile={handleDeleteFile}
        previewFile={previewFile}
        setPreviewFile={setPreviewFile}
        handleSaveFile={handleSaveFile}
        userProfile={userProfile}
        isStreaming={isStreaming}
        workspaceSkills={workspaceSkills}
        isLoadingSkills={isLoadingSkills}
        skillPresets={skillPresets}
        activeWorkspace={activeWorkspace}
        setShowSkillModal={setShowSkillModal}
        setSkillModalTab={setSkillModalTab}
        fetchWorkspaceSkills={fetchWorkspaceSkills}
        fetchFleet={fetchFleet}
        handleInstallPreset={handleInstallPreset}
        handleToggleSkill={handleToggleSkill}
        setPreviewingSkill={setPreviewingSkill}
        handleDeleteSkill={handleDeleteSkill}
        setEditWsName={setEditWsName}
        setEditWsDesc={setEditWsDesc}
        setEditWsPrompt={setEditWsPrompt}
        setShowRulesModal={setShowRulesModal}
      />

      {/* ── 4. Modals ── */}
      <AccountModelModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        userProfile={userProfile}
        contextLength={contextLength}
        formatTokens={formatTokens}
      />

      <WorkspaceRulesModal
        isOpen={showRulesModal}
        onClose={() => setShowRulesModal(false)}
        activeWorkspaceName={activeWorkspaceName}
        editWsPrompt={editWsPrompt}
        setEditWsPrompt={setEditWsPrompt}
        onSave={handleEditWorkspace}
        isEditingWs={isEditingWs}
      />

      <CreateWorkspaceModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        newWsName={newWsName}
        setNewWsName={setNewWsName}
        newWsDesc={newWsDesc}
        setNewWsDesc={setNewWsDesc}
        newWsPrompt={newWsPrompt}
        setNewWsPrompt={setNewWsPrompt}
        onCreate={handleCreateWorkspace}
        isCreatingWs={isCreatingWs}
      />

      <EditWorkspaceModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        editWsName={editWsName}
        setEditWsName={setEditWsName}
        editWsDesc={editWsDesc}
        setEditWsDesc={setEditWsDesc}
        editWsPrompt={editWsPrompt}
        setEditWsPrompt={setEditWsPrompt}
        onSave={handleEditWorkspace}
        isEditingWs={isEditingWs}
      />

      <InstallSkillModal
        isOpen={showSkillModal}
        onClose={() => setShowSkillModal(false)}
        skillModalTab={skillModalTab}
        setSkillModalTab={setSkillModalTab}
        skillPresets={skillPresets}
        workspaceSkills={workspaceSkills}
        isSubmittingSkill={isSubmittingSkill}
        handleInstallPreset={handleInstallPreset}
        newSkillName={newSkillName}
        setNewSkillName={setNewSkillName}
        newSkillDesc={newSkillDesc}
        setNewSkillDesc={setNewSkillDesc}
        newSkillContent={newSkillContent}
        setNewSkillContent={setNewSkillContent}
        handleCreateCustomSkill={handleCreateCustomSkill}
      />

      <SkillPreviewModal
        skill={previewingSkill}
        onClose={() => setPreviewingSkill(null)}
        onCopy={handleCopyToolResult}
      />
    </div>
  );
}

