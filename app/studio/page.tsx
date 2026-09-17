'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutGrid,
  Folder,
  ChevronDown,
  Wrench,
  Loader2,
  CheckCircle,
  Plus,
  Brain,
  Settings,
  Sun,
  Mic,
  Send,
  PanelRight,
  Menu,
  Copy,
  Terminal,
  FileText,
  Trash2,
  Square,
  RefreshCw,
  Eye,
  EyeOff,
  Save,
  FilePlus,
  AlertTriangle,
  ChevronRight,
  FolderOpen,
  Edit2,
  FolderPlus,
  Sparkles,
  Users,
  Search,
  PanelLeft,
  PanelRightClose,
  Code,
  Bot,
  ExternalLink,
  ChevronLeft,
  X,
  Shield,
  Layers,
  Cpu,
  BookOpen,
  Power,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  content?: string;
  updatedAt?: number;
}

interface ToolInvocation {
  id: string;
  name: string;
  preview: string;
  status: 'running' | 'done' | 'failed' | 'completed' | 'stopped';
  result?: string;
  sessionId?: string;
  agentId?: string;
  expanded?: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  tools?: ToolInvocation[];
  tokens?: number | null;
  timestamp: number;
}

interface StudioWorkspaceItem {
  id: string;
  name: string;
  description?: string | null;
  systemPrompt?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: number;
  children?: FileNode[];
}

interface StudioConfig {
  coordinatorBaseUrl: string;
  coordinatorApiKey: string;
  coordinatorModel: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  deepseekApiKey: string;
}

const DEFAULT_CONFIG: StudioConfig = {
  coordinatorBaseUrl: '',
  coordinatorApiKey: '',
  coordinatorModel: 'DeepSeek-V4',
  anthropicApiKey: '',
  openaiApiKey: '',
  deepseekApiKey: '',
};

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

              if (event.type === 'tool.started') {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? {
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
                        }
                      : m
                  )
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
                                  status: 'failed',
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
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: (m.content || '') + `\n\n> ⚠️ 执行出错: ${errMsg}` }
            : m
        )
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
    <div className="flex h-full bg-[#111114] text-gray-100 font-sans selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      {/* ── 1. LEFT COLUMN: Workspace List Sidebar (Knowe ConvList & Hermes Sidebar style) ── */}
      {/* Mobile Backdrop Overlay for Left Workspace Drawer */}
      {!isLeftSidebarCollapsed && (
        <div
          className="md:hidden fixed inset-0 bg-black/70 z-40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsLeftSidebarCollapsed(true)}
        />
      )}

      <aside
        className={cn(
          'flex flex-col bg-[#161619] border-r border-zinc-800/80 transition-all duration-200 flex-shrink-0 select-none h-full',
          isLeftSidebarCollapsed
            ? 'hidden'
            : 'fixed md:relative inset-y-0 left-0 z-50 md:z-30 w-72 max-w-[85vw] md:w-64 shadow-2xl md:shadow-none animate-in slide-in-from-left duration-200 md:animate-none'
        )}
      >
        {/* Sidebar Header */}
        <div className="h-14 border-b border-zinc-800/80 px-3 flex items-center justify-between w-full">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0">
              <LayoutGrid size={15} />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-bold text-zinc-100 truncate tracking-tight">项目工作空间</h2>
              <p className="text-[10px] text-zinc-500 font-mono leading-none mt-0.5">{workspaces.length} 个沙箱</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-200 border border-indigo-500/20 transition-all cursor-pointer"
              title="新建工作空间"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={() => handleToggleLeftSidebar(true)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
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
              <Search size={13} className="absolute left-2.5 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={searchWorkspaceQuery}
                onChange={(e) => setSearchWorkspaceQuery(e.target.value)}
                placeholder="搜索空间..."
                className="w-full bg-zinc-900/90 border border-zinc-800 focus:border-indigo-500/60 rounded-lg pl-8 pr-6 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none transition-colors font-sans"
              />
              {searchWorkspaceQuery && (
                <button
                  onClick={() => setSearchWorkspaceQuery('')}
                  className="absolute right-2 text-zinc-500 hover:text-zinc-300"
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
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/50 shadow-xs'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  )}
                >
                  <Folder size={17} className={isSelected ? 'text-indigo-400' : 'text-zinc-400'} />
                  {hasRules && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400 ring-2 ring-[#161619]" />
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
                    ? 'bg-indigo-600/15 border-indigo-500/35 text-white shadow-xs'
                    : 'border-transparent text-zinc-300 hover:bg-zinc-850 hover:text-zinc-100'
                )}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
                    isSelected
                      ? 'bg-indigo-600/25 text-indigo-400'
                      : 'bg-zinc-800 text-zinc-400 group-hover/item:text-zinc-200'
                  )}
                >
                  <Folder size={14} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={cn('text-xs font-medium truncate', isSelected && 'font-semibold text-indigo-200')}>
                      {ws.name}
                    </span>
                    {hasRules && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono flex-shrink-0">
                        <Sparkles size={8} />
                        <span>规则</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                    {ws.description || '沙箱隔离环境'}
                  </p>
                </div>

                {/* Hover Actions */}
                <div className="absolute right-2 top-2 hidden group-hover/item:flex items-center gap-0.5 bg-zinc-900/95 backdrop-blur-xs px-1 py-0.5 rounded-md border border-zinc-700/60 shadow-md">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditWsName(ws.name);
                      setEditWsDesc(ws.description || '');
                      setEditWsPrompt(ws.systemPrompt || '');
                      setShowEditModal(true);
                    }}
                    className="p-1 hover:bg-zinc-750 rounded text-zinc-400 hover:text-zinc-200 cursor-pointer"
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
                      className="p-1 hover:bg-rose-500/20 rounded text-zinc-500 hover:text-rose-400 cursor-pointer"
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
        <div className="border-t border-zinc-800/80 p-2 flex items-center justify-between w-full">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-xs transition-colors cursor-pointer w-full"
            title="Studio 配置与模型状态"
          >
            <Settings size={14} className="flex-shrink-0 text-zinc-500" />
            <span className="text-[11px] truncate font-mono">
              {userProfile?.modelName || '默认模型'}
            </span>
          </button>
        </div>
      </aside>

      {/* ── 2. MIDDLE COLUMN: Team Group Chat Stream & Composer ── */}
      <main className="flex-1 flex flex-col h-full bg-[#18181b] min-w-0 relative">
        {/* Middle Header Bar */}
        <header className="h-14 border-b border-zinc-800/80 bg-[#18181b]/95 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between flex-shrink-0 z-20">
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            {/* Sidebar toggle button: shown ONLY when collapsed (Mode A) */}
            {isLeftSidebarCollapsed && (
              <button
                onClick={() => handleToggleLeftSidebar(false)}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer flex-shrink-0"
                title="展开工作空间列表"
              >
                <PanelLeft size={16} />
              </button>
            )}

            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
              <Folder size={15} className="text-amber-400 flex-shrink-0" />
              <h1 className="text-xs sm:text-sm font-bold text-zinc-100 truncate tracking-tight max-w-[100px] xs:max-w-[150px] sm:max-w-none">
                {activeWorkspaceName}
              </h1>
              <span className="hidden md:inline-flex text-[10px] text-zinc-500 font-mono px-2 py-0.5 rounded-full bg-zinc-800/70 border border-zinc-700/50 flex-shrink-0">
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
                'flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border text-xs transition-all cursor-pointer font-medium shadow-2xs flex-shrink-0',
                activeWorkspace?.systemPrompt
                  ? 'bg-indigo-600/15 text-indigo-300 border-indigo-500/30 hover:bg-indigo-600/25'
                  : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/60 hover:bg-zinc-750 hover:text-zinc-200'
              )}
              title={
                activeWorkspace?.systemPrompt
                  ? '当前工作区已配置专属提示词规范，点击查看或编辑'
                  : '为当前工作区设定专属提示词与项目规范'
              }
            >
              <Sparkles size={12} className={activeWorkspace?.systemPrompt ? 'text-indigo-400' : 'text-zinc-500'} />
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
                className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer bg-zinc-800/80 hover:bg-zinc-750 text-zinc-300 border-zinc-700/60 shadow-xs"
                title="展开右侧工作台检视面板 (文件/终端/团队)"
              >
                <PanelRightClose size={14} className="rotate-180 text-indigo-400" />
                <span className="text-[11px] sm:text-xs">工作台</span>
              </button>
            </div>
          )}
        </header>

      {/* 2. Message List Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {isLoadingMessages ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
              <Loader2 size={24} className="text-indigo-400 animate-spin" />
              <div className="text-xs text-zinc-400 font-mono">
                正在从数据库加载工作区【{activeWorkspaceName}】历史对话记录...
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-5">
              <div className="w-14 h-14 rounded-2xl bg-zinc-800/80 border border-zinc-700 flex items-center justify-center shadow-lg">
                <LayoutGrid size={28} className="text-indigo-400" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-zinc-100">
                  协调智能体团队已就绪
                </h3>
                <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed">
                  总指挥官能自动感知沙箱工作区文件，拆解任务架构，并实时调度 Pi、Claude Code、Codex 等专业子 Agent 协同编码。
                </p>
              </div>

              {/* Quick Prompt Cards */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-md text-left pt-2">
                {[
                  {
                    title: '扫描当前项目结构',
                    desc: '感知工作区根目录与关键配置文件',
                    cmd: '请帮我扫描当前工作区目录结构并汇报。',
                  },
                  {
                    title: '调度 Pi 编写工具脚本',
                    desc: '在沙箱中由 Pi 编写并运行统计脚本',
                    cmd: '请让内置 Pi 智能体编写一个递归统计代码行数的脚本，输出到工作区。',
                  },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setInput(item.cmd);
                    }}
                    className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850 text-left transition-all cursor-pointer group"
                  >
                    <div className="text-xs font-semibold text-zinc-200 group-hover:text-indigo-400 transition-colors">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-1 leading-snug">
                      {item.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message, index) => {
            if (message.role === 'user') {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="bg-[#27272a] text-zinc-100 px-4 py-2.5 rounded-2xl max-w-[82%] text-sm leading-relaxed shadow-sm">
                    {message.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={message.id} className="space-y-3">
                {/* Embedded Tool Calls */}
                {message.tools && message.tools.length > 0 && (
                  <div className="space-y-2">
                    {message.tools.map((tool) => {
                      const isExpanded = expandedToolIds.has(tool.id);

                      return (
                        <div
                          key={tool.id}
                          className={cn(
                            'rounded-xl transition-all max-w-2xl border overflow-hidden',
                            isExpanded
                              ? 'border-zinc-700 bg-[#1e1e24] shadow-md shadow-black/30'
                              : 'border-zinc-800 bg-[#202024] hover:border-zinc-700 hover:bg-[#232328]'
                          )}
                        >
                          {/* Top Clickable Bar */}
                          <div
                            onClick={() => toggleToolExpand(tool.id)}
                            className="flex items-center justify-between px-3.5 py-2.5 cursor-pointer select-none group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {tool.name === 'delegate' ? (
                                <Terminal
                                  size={13}
                                  className={cn('flex-shrink-0', isExpanded ? 'text-indigo-400' : 'text-emerald-400')}
                                />
                              ) : (
                                <Wrench
                                  size={13}
                                  className={cn('flex-shrink-0', isExpanded ? 'text-indigo-300' : 'text-indigo-400')}
                                />
                              )}
                              <span
                                className={cn(
                                  'font-semibold font-mono text-xs',
                                  isExpanded ? 'text-indigo-200' : 'text-zinc-200'
                                )}
                              >
                                {tool.name}
                                {tool.agentId ? ` (${tool.agentId})` : ''}
                              </span>
                              <span className="text-zinc-400 text-xs truncate max-w-[260px] sm:max-w-md">
                                {tool.preview}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {tool.sessionId && (
                                <span className="text-[10px] text-zinc-400 font-mono bg-zinc-800 px-1.5 py-0.5 rounded">
                                  实时流
                                </span>
                              )}
                              {tool.status === 'running' && (
                                <span className="flex items-center gap-1 text-[11px] text-amber-400">
                                  <Loader2 size={12} className="animate-spin" />
                                  <span className="text-[10px]">运行中</span>
                                </span>
                              )}
                              {tool.status === 'done' && (
                                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                                  <CheckCircle size={12} />
                                </span>
                              )}
                              {tool.status === 'failed' && (
                                <span className="w-2 h-2 rounded-full bg-rose-500" />
                              )}
                              <ChevronDown
                                size={14}
                                className={cn(
                                  'text-zinc-500 group-hover:text-zinc-300 transition-transform duration-200',
                                  isExpanded && 'rotate-180 text-zinc-200'
                                )}
                              />
                            </div>
                          </div>

                          {/* Inline Expanded Dropdown Panel */}
                          {isExpanded && (
                            <div className="border-t border-zinc-800/80 bg-[#151518] p-3 space-y-2.5 animate-fadeIn text-xs">
                              {/* Parameters / Target */}
                              {tool.preview && (
                                <div className="space-y-1">
                                  <div className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                                    <Code size={11} className="text-zinc-500" />
                                    <span>调用参数与目标</span>
                                  </div>
                                  <div className="bg-zinc-950/80 border border-zinc-850 rounded-lg p-2.5 font-mono text-[11px] text-zinc-300 whitespace-pre-wrap break-all leading-relaxed max-h-24 overflow-y-auto">
                                    {tool.preview}
                                  </div>
                                </div>
                              )}

                              {/* Result / Output Console */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
                                  <span className="flex items-center gap-1.5">
                                    <Terminal size={11} className="text-emerald-400" />
                                    <span>执行结果与输出</span>
                                  </span>
                                  {tool.result && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCopyToolResult(tool.result!);
                                      }}
                                      className="px-2 py-0.5 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-300 text-[10px] transition-colors cursor-pointer flex items-center gap-1"
                                      title="复制结果"
                                    >
                                      {copiedToolResult ? (
                                        <>
                                          <CheckCircle size={10} className="text-emerald-400" />
                                          <span className="text-emerald-400">已复制</span>
                                        </>
                                      ) : (
                                        <>
                                          <Copy size={10} />
                                          <span>复制</span>
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>

                                <div className="bg-zinc-950 rounded-lg p-3 border border-zinc-850 font-mono text-xs max-h-60 overflow-y-auto">
                                  {tool.result ? (
                                    <div className="text-zinc-300 leading-relaxed whitespace-pre-wrap break-all text-[11px]">
                                      {tool.result}
                                    </div>
                                  ) : tool.status === 'running' ? (
                                    <div className="flex items-center justify-center py-6 gap-2 text-zinc-500 text-xs">
                                      <Loader2 size={14} className="animate-spin text-indigo-400" />
                                      <span>正在执行中，等待输出返回...</span>
                                    </div>
                                  ) : (
                                    <div className="text-zinc-600 text-center py-4 text-xs">
                                      该工具调用已执行完成，无控制台回显内容。
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Assistant Message Bubble */}
                {(message.content || (isStreaming && index === messages.length - 1 && (!message.tools || message.tools.length === 0))) && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-zinc-900 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 overflow-hidden shadow-sm">
                      <div className="w-full h-full flex items-center justify-center text-xs font-bold text-white bg-zinc-900/60">
                        👾
                      </div>
                    </div>

                    <div className="bg-[#27272a] text-zinc-200 px-4 py-3 rounded-2xl max-w-[85%] text-sm leading-relaxed shadow-sm">
                      {!message.content && isStreaming && (!message.tools || message.tools.length === 0) ? (
                        <div className="flex items-center gap-2.5 text-xs text-indigo-400 py-1">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                          <span className="font-medium animate-pulse">正在调度智能体，分析工作区并思考规划中...</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ children }) => <p className="mb-2.5 last:mb-0 leading-relaxed text-zinc-200">{children}</p>,
                              h1: ({ children }) => <h1 className="text-base font-bold text-zinc-100 mt-4 mb-2 first:mt-0">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-sm font-bold text-zinc-100 mt-3 mb-1.5 first:mt-0">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-xs font-bold text-zinc-200 mt-2.5 mb-1 first:mt-0">{children}</h3>,
                              ul: ({ children }) => <ul className="list-disc pl-5 mb-2.5 space-y-1 text-zinc-300">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal pl-5 mb-2.5 space-y-1 text-zinc-300">{children}</ol>,
                              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                              blockquote: ({ children }) => (
                                <blockquote className="border-l-2 border-indigo-500/60 pl-3 py-0.5 my-2 text-zinc-400 italic bg-indigo-500/5 rounded-r">
                                  {children}
                                </blockquote>
                              ),
                              code: ({ inline, className, children, ...props }: any) => {
                                if (inline) {
                                  return (
                                    <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-xs font-mono text-indigo-300 border border-zinc-700/50" {...props}>
                                      {children}
                                    </code>
                                  );
                                }
                                return (
                                  <pre className="overflow-x-auto rounded-xl bg-zinc-950/90 p-3.5 my-2.5 border border-zinc-800 text-xs font-mono text-zinc-200">
                                    <code {...props}>{children}</code>
                                  </pre>
                                );
                              },
                              a: ({ href, children }) => (
                                <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
                                  {children}
                                </a>
                              ),
                              table: ({ children }) => (
                                <div className="overflow-x-auto my-3">
                                  <table className="min-w-full divide-y divide-zinc-700 border border-zinc-700 text-xs">
                                    {children}
                                  </table>
                                </div>
                              ),
                              th: ({ children }) => <th className="bg-zinc-800/70 px-3 py-2 text-left font-semibold text-zinc-200 border-b border-zinc-700">{children}</th>,
                              td: ({ children }) => <td className="px-3 py-1.5 border-b border-zinc-800 text-zinc-300">{children}</td>,
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                          {isStreaming && index === messages.length - 1 && (
                            <span className="inline-block w-1.5 h-3.5 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 3. Bottom Composer Box (Dev Controls + Token Bar) */}
      <div className="p-2 sm:p-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto bg-[#27272a] border border-zinc-700/70 rounded-2xl p-2.5 sm:p-3 shadow-2xl transition-all duration-200 focus-within:border-zinc-500">
          {/* Token Usage Header Row */}
          <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-mono text-zinc-400 mb-2 px-1">
            <div className="flex items-center gap-1.5 sm:gap-2 truncate">
              <span>
                {totalTokens === 0 ? '0' : formatTokens(totalTokens)} / {formatTokens(contextLength)}
              </span>
              <span className="hidden xs:inline">·</span>
              <span className="hidden xs:inline">
                {totalTokens === 0
                  ? `剩余 ${formatTokens(contextLength)} (就绪)`
                  : `剩余 ${formatTokens(remainingTokens)}`}
              </span>
              {totalTokens > 0 && (
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded font-sans hidden sm:inline">
                  模型实际返回
                </span>
              )}
            </div>

            {/* Context progress bar */}
            <div className="w-16 sm:w-24 h-1.5 rounded-full bg-zinc-700/80 overflow-hidden flex-shrink-0">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  usagePercent > 80
                    ? 'bg-rose-500'
                    : usagePercent > 60
                    ? 'bg-amber-500'
                    : 'bg-zinc-400'
                )}
                style={{ width: `${Math.max(4, usagePercent)}%` }}
              />
            </div>
          </div>

          {/* Textarea Input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的工程任务或规划需求... (Enter 发送, Shift+Enter 换行)"
            rows={2}
            className="w-full bg-transparent border-0 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none resize-none leading-relaxed px-1"
          />

          {/* Bottom Toolbar Controls */}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-zinc-700/40 text-xs gap-1.5 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-1 sm:gap-2 min-w-0 overflow-x-auto no-scrollbar">
              {/* Attach Button */}
              <button
                type="button"
                onClick={handleOpenFileExplorer}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-750 transition-colors cursor-pointer flex-shrink-0"
                title="选择工作区文件作为上下文"
              >
                <Plus size={16} />
              </button>

              {/* Reasoning Effort (Thinking Level) */}
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowReasoningMenu(!showReasoningMenu)}
                  className="flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-md text-zinc-300 hover:bg-zinc-700/70 transition-colors cursor-pointer"
                >
                  <Brain size={14} className="text-zinc-400" />
                  <span className="font-medium capitalize">
                    {reasoningEffort === 'none'
                      ? '关闭思考'
                      : reasoningEffort === 'low'
                      ? '低思考'
                      : reasoningEffort === 'medium'
                      ? '中思考'
                      : '高思考'}
                  </span>
                  <ChevronDown size={11} className="text-zinc-500" />
                </button>

                {showReasoningMenu && (
                  <div className="absolute left-0 bottom-full mb-1.5 w-32 rounded-xl bg-zinc-900 border border-zinc-700 p-1 shadow-xl z-50 text-xs space-y-0.5">
                    {(['none', 'low', 'medium', 'high'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => {
                          setReasoningEffort(lvl);
                          setShowReasoningMenu(false);
                        }}
                        className={cn(
                          'w-full text-left px-2.5 py-1.5 rounded-lg transition-colors',
                          reasoningEffort === lvl
                            ? 'bg-indigo-600/30 text-indigo-400 font-semibold'
                            : 'text-zinc-300 hover:bg-zinc-800'
                        )}
                      >
                        {lvl === 'none'
                          ? '关闭思考'
                          : lvl === 'low'
                          ? '低思考'
                          : lvl === 'medium'
                          ? '中思考'
                          : '高思考'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Account Active Model Indicator */}
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg bg-zinc-800/90 hover:bg-zinc-750 border border-zinc-700/60 text-zinc-200 transition-colors cursor-pointer group shadow-xs flex-shrink-0 max-w-[120px] sm:max-w-none"
                title="已自动直连您的登录账号模型配置，点击查看环境与凭据状态"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                <span className="font-mono text-xs font-semibold text-zinc-200 tracking-tight truncate">
                  {userProfile?.modelName || '默认模型'}
                </span>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded font-sans ml-0.5 hidden sm:inline">
                  账号模型
                </span>
              </button>
            </div>

            {/* Right: Mic & Send Button */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 ml-auto sm:ml-0">
              <button
                type="button"
                onClick={handleToggleVoice}
                className={cn(
                  'p-1.5 transition-all cursor-pointer rounded-lg flex items-center justify-center',
                  isListening
                    ? 'text-rose-400 bg-rose-500/20 animate-pulse ring-1 ring-rose-500/50'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60'
                )}
                title={isListening ? '正在录音识别中，点击停止' : '语音输入 (点击开始讲话)'}
              >
                <Mic size={16} className={cn(isListening && 'text-rose-400')} />
              </button>

              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                  input.trim()
                    ? 'bg-white text-zinc-900 hover:bg-zinc-200'
                    : 'bg-zinc-600 text-zinc-400'
                )}
              >
                <Send size={13} className="translate-x-0.2" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>

      {/* ── 3. RIGHT COLUMN: Dockable Workspace Inspector (Knowe & Hermes Workspace Panel style) ── */}
      {isRightInspectorOpen && (
        <>
          {/* Mobile Backdrop Overlay */}
          <div
            className="md:hidden fixed inset-0 bg-black/70 z-40 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={() => handleToggleRightInspector(false)}
          />

          <aside className="fixed md:relative inset-y-0 right-0 z-50 md:z-25 w-full sm:w-96 md:w-96 bg-[#161619] border-l border-zinc-800/80 flex flex-col flex-shrink-0 h-full select-none animate-in slide-in-from-right duration-200 shadow-2xl md:shadow-none">
          {/* Inspector Header Tabs (Sleek Segmented Switcher) */}
          <div className="h-14 border-b border-zinc-800/80 px-3 flex items-center justify-between bg-zinc-900/50 flex-shrink-0">
            <div className="flex items-center gap-1 bg-zinc-950/70 p-1 rounded-xl border border-zinc-800/90 shadow-inner">
              <button
                onClick={() => {
                  setInspectorTab('files');
                  fetchWorkspaceTree();
                }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
                  inspectorTab === 'files'
                    ? 'bg-zinc-800 text-white shadow-xs border border-zinc-700/60 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/50'
                )}
              >
                <FolderOpen size={13} className={inspectorTab === 'files' ? 'text-amber-400' : 'text-zinc-400'} />
                <span>文件</span>
                {fileTree.length > 0 && (
                  <span className={cn(
                    'text-[10px] font-mono px-1 rounded',
                    inspectorTab === 'files' ? 'bg-zinc-700/60 text-zinc-200' : 'bg-zinc-850 text-zinc-500'
                  )}>
                    {fileTree.length}
                  </span>
                )}
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
                    ? 'bg-indigo-600/20 text-indigo-200 shadow-xs border border-indigo-500/40 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850/50'
                )}
              >
                <Users size={13} className={inspectorTab === 'roster' ? 'text-indigo-400' : 'text-zinc-400'} />
                <span>团队</span>
                {workspaceSkills.length > 0 ? (
                  <span className="text-[10px] text-amber-300 font-mono bg-amber-500/15 border border-amber-500/25 px-1 rounded">
                    {workspaceSkills.length}技能
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-500 font-mono">3</span>
                )}
              </button>
            </div>

            <button
              onClick={() => handleToggleRightInspector(false)}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              title="收起检视面板"
            >
              <PanelRightClose size={15} />
            </button>
          </div>

          {/* Inspector Body by Tab */}
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {inspectorTab === 'roster' && (
              <div className="space-y-4">
                {/* Coordinator Card */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-base">
                        🤖
                      </div>
                      <div>
                        <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                          <span>Almaren 协调总指挥官</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">Coordinator</span>
                        </div>
                        <p className="text-[10px] text-zinc-400 font-mono">{userProfile?.modelName || '默认账号模型'}</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{isStreaming ? '规划中' : '在线就绪'}</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed border-t border-zinc-800/80 pt-2">
                    负责感知当前沙箱项目、拆解架构任务、指派子 Agent 并把控全局交付。
                  </p>
                </div>

                {/* Worker Agents: Pi */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-base">
                        ⚡
                      </div>
                      <div>
                        <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                          <span>Pi 编码智能体</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">Worker</span>
                        </div>
                        <p className="text-[10px] text-zinc-400 font-mono">Custom CLI Agent</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                      <span>就绪</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed border-t border-zinc-800/80 pt-2">
                    负责写入代码、安装依赖、运行单元测试，自动索引 <code className="text-emerald-400 font-mono">.pi/skills/</code> 技能。
                  </p>
                </div>

                {/* Workspace Skills Management Pool */}
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                      <BookOpen size={14} className="text-amber-400" />
                      <span>工作区技能库 (Skills)</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-zinc-800 text-zinc-400">
                        {workspaceSkills.filter((s) => s.enabled).length}/{workspaceSkills.length} 启用
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setSkillModalTab('presets');
                          setShowSkillModal(true);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-medium transition-colors cursor-pointer"
                        title="安装或创建技能"
                      >
                        <Plus size={11} />
                        <span>安装技能</span>
                      </button>
                      <button
                        onClick={() => fetchWorkspaceSkills()}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="刷新技能列表"
                      >
                        <RefreshCw size={11} className={isLoadingSkills ? 'animate-spin' : ''} />
                      </button>
                    </div>
                  </div>

                  {isLoadingSkills && workspaceSkills.length === 0 ? (
                    <div className="flex items-center justify-center py-6 text-zinc-500 text-xs">
                      <Loader2 size={15} className="animate-spin text-amber-400 mr-2" />
                      <span>正在扫描工作区技能...</span>
                    </div>
                  ) : workspaceSkills.length === 0 ? (
                    <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-850 text-center space-y-2">
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        当前沙箱尚未安装扩展技能。智能体可自主在对话中安装，您也可以一键添加常用技能。
                      </p>
                      <div className="flex items-center justify-center gap-1.5 flex-wrap pt-1">
                        {skillPresets.slice(0, 2).map((p) => (
                          <button
                            key={p.id}
                            onClick={() => handleInstallPreset(p.id)}
                            className="text-[10px] px-2 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-amber-300/90 border border-zinc-700/60 transition-colors cursor-pointer"
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
                              ? 'bg-zinc-950/60 border-zinc-800'
                              : 'bg-zinc-950/30 border-zinc-850 opacity-65'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-mono text-xs font-semibold text-zinc-200 truncate">
                                {skill.name}
                              </span>
                              <span
                                className={cn(
                                  'text-[9px] px-1.5 py-0.2 rounded font-mono',
                                  skill.enabled
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-zinc-800 text-zinc-500'
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
                                    ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700'
                                )}
                                title={skill.enabled ? '点击禁用该技能' : '点击启用该技能'}
                              >
                                <Power size={10} />
                                <span>{skill.enabled ? '开' : '关'}</span>
                              </button>

                              {/* View detail button */}
                              <button
                                onClick={() => setPreviewingSkill(skill)}
                                className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                                title="查看技能定义"
                              >
                                <Eye size={12} />
                              </button>

                              {/* Delete button */}
                              <button
                                onClick={() => handleDeleteSkill(skill.id, skill.name)}
                                className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                title="卸载技能"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>

                          <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2">
                            {skill.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Workspace Rules & AGENTS.md Info */}
                <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                      <Sparkles size={13} className="text-indigo-400" />
                      <span>空间规则 (AGENTS.md)</span>
                    </div>
                    <button
                      onClick={() => {
                        setEditWsName(activeWorkspace?.name || '');
                        setEditWsDesc(activeWorkspace?.description || '');
                        setEditWsPrompt(activeWorkspace?.systemPrompt || '');
                        setShowRulesModal(true);
                      }}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                    >
                      编辑规则
                    </button>
                  </div>
                  {activeWorkspace?.systemPrompt ? (
                    <div className="p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/80 text-[11px] font-mono text-zinc-300 max-h-32 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                      {activeWorkspace.systemPrompt}
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500 italic">
                      当前工作区未配置专属规则，智能体将采用系统默认行为。点击上方“编辑规则”可一键引入 Next.js、Python 等项目规范。
                    </p>
                  )}
                </div>
              </div>
            )}

            {inspectorTab === 'files' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <span className="text-xs font-medium text-zinc-400">沙箱文件列表 ({activeWorkspaceName})</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setIsCreatingFile(!isCreatingFile)}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                      title="新建文件"
                    >
                      <FilePlus size={13} />
                    </button>
                    <button
                      onClick={() => fetchWorkspaceTree()}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                      title="刷新文件树"
                    >
                      <RefreshCw size={13} className={isLoadingFiles ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </div>

                {isCreatingFile && (
                  <div className="flex items-center gap-1.5 p-2 bg-zinc-900 rounded-lg border border-zinc-700">
                    <input
                      type="text"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      placeholder="文件名 (如 src/app.ts)"
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500 font-mono"
                      autoFocus
                    />
                    <button
                      onClick={handleCreateFile}
                      className="px-2 py-1 rounded bg-indigo-600 text-white text-xs hover:bg-indigo-500 cursor-pointer"
                    >
                      创建
                    </button>
                    <button
                      onClick={() => setIsCreatingFile(false)}
                      className="px-2 py-1 rounded bg-zinc-800 text-zinc-400 text-xs hover:bg-zinc-700 cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                )}

                {/* Tree Area */}
                <div className="space-y-1 text-xs font-mono">
                  {isLoadingFiles ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={18} className="text-zinc-500 animate-spin" />
                    </div>
                  ) : fileTree.length === 0 ? (
                    <div className="text-center py-10 text-zinc-500 text-xs">
                      工作区当前为空，让智能体写入文件或点击上方新建
                    </div>
                  ) : (
                    fileTree.map((node) => (
                      <div
                        key={node.path}
                        onClick={() => handleSelectFile(node)}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-zinc-800 cursor-pointer group transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {node.isDirectory ? (
                            <Folder size={14} className="text-amber-400 flex-shrink-0" />
                          ) : (
                            <FileText size={14} className="text-zinc-400 flex-shrink-0" />
                          )}
                          <span className="text-zinc-200 truncate">{node.name}</span>
                        </div>

                        {!node.isDirectory && (
                          <button
                            onClick={(e) => handleDeleteFile(node.path, e)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 transition-opacity cursor-pointer"
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
                  <div className="mt-4 border-t border-zinc-800 pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-zinc-300 font-medium truncate">{previewFile.path}</span>
                      <button onClick={() => setPreviewFile(null)} className="text-zinc-500 hover:text-zinc-300 cursor-pointer">
                        <X size={13} />
                      </button>
                    </div>
                    <pre className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800/80 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-56 leading-relaxed whitespace-pre-wrap">
                      {previewFile.content || '(空文件)'}
                    </pre>
                  </div>
                )}
              </div>
            )}


          </div>
        </aside>
      </>
    )}

      {/* 5. Account Model & Environment Overview Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Settings size={18} className="text-indigo-400" />
                <h3 className="text-base font-bold text-zinc-100">
                  当前环境与模型状态
                </h3>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-zinc-400 hover:text-zinc-100 text-xs font-medium cursor-pointer"
              >
                关闭
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="p-3.5 rounded-xl bg-zinc-800/60 border border-zinc-700/60 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-700/40">
                  <span className="text-zinc-400">登录账号</span>
                  <span className="font-mono text-zinc-200 font-medium">{userProfile?.email || '当前登录用户'}</span>
                </div>

                <div className="flex items-center justify-between pb-2 border-b border-zinc-700/40">
                  <span className="text-zinc-400">驱动大模型</span>
                  <span className="font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">
                    {userProfile?.modelName || '未指定 (系统默认)'}
                  </span>
                </div>

                <div className="flex items-center justify-between pb-2 border-b border-zinc-700/40">
                  <span className="text-zinc-400">接口 Base URL</span>
                  <span className="font-mono text-zinc-300 truncate max-w-[200px]" title={userProfile?.apiBaseUrl || '系统默认端点'}>
                    {userProfile?.apiBaseUrl || '系统官方接口'}
                  </span>
                </div>

                <div className="flex items-center justify-between pb-2 border-b border-zinc-700/40">
                  <span className="text-zinc-400">API 凭据状态</span>
                  <span className="flex items-center gap-1 text-emerald-400 font-medium">
                    <CheckCircle size={12} />
                    <span>{userProfile?.apiKey ? '已配置 (已就绪)' : '未设置'}</span>
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">上下文窗口</span>
                  <span className="font-mono text-zinc-200">{formatTokens(contextLength)} tokens</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-[11px] text-zinc-300 space-y-1">
                <div className="font-semibold text-indigo-300 flex items-center gap-1.5">
                  <Sparkles size={13} />
                  <span>统一账号模型与直连机制</span>
                </div>
                <div className="text-zinc-400 leading-relaxed">
                  Studio 总指挥官与后台 Pi Coding Agent 已直接打通并继承您的账号模型配置，无需在此重复填写任何密钥或代理地址。
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-zinc-800">
              <a
                href="/settings"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 font-medium"
              >
                <span>前往系统设置修改模型配置</span>
                <ChevronRight size={13} />
              </a>

              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5.5 Workspace System Rules Modal */}
      {showRulesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-400" />
                <h3 className="text-base font-bold text-zinc-100">
                  【{activeWorkspaceName}】空间提示词与规范
                </h3>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="text-zinc-400 hover:text-zinc-100 text-xs cursor-pointer"
              >
                取消
              </button>
            </div>

            <form onSubmit={handleEditWorkspace} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-semibold text-zinc-300">
                    空间专属指令 (System Instructions)
                  </label>
                  <span className="text-[10px] text-indigo-400 font-mono">自动同步沙箱 AGENTS.md</span>
                </div>
                <textarea
                  value={editWsPrompt}
                  onChange={(e) => setEditWsPrompt(e.target.value)}
                  placeholder="在此输入当前工作空间的专属指令与规范。例如：
1. 本项目采用 Next.js 15 App Router + TailwindCSS；
2. 代码必须严格使用 TypeScript，拒绝 any 类型；
3. 写代码或重构前必须先列出改动点；
4. 保持代码精炼，所有模块加上简明 JSDoc 注释。"
                  rows={8}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed resize-none"
                  autoFocus
                />
                <p className="text-[10px] text-zinc-500 leading-snug">
                  总指挥官在规划时将严格遵守该规范；保存后会在工作区根目录同步写入 AGENTS.md，Pi 等子智能体执行时亦会自动读取遵循。
                </p>
              </div>

              {/* Quick Preset Badges */}
              <div className="space-y-1.5">
                <div className="text-[11px] text-zinc-400 font-medium">快捷填入预设模板：</div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    {
                      label: 'Next.js 全栈规范',
                      prompt: '【项目规范】：\n1. 技术栈：Next.js 15 (App Router) + TailwindCSS + TypeScript；\n2. 拒绝使用 any，所有数据接口和 Props 必须严格定义类型；\n3. 组件优先使用函数式组件，保持 UI 极简科技暗黑风格；\n4. 修改或新建文件前，先简要说明改动方案。',
                    },
                    {
                      label: 'Python 算法与爬虫',
                      prompt: '【项目规范】：\n1. 技术栈：Python 3.12，遵守 PEP8 代码规范；\n2. 网络请求与并发必须包含超时重试与异常捕获；\n3. 涉及数据分析时优先使用 Pandas，图表必须配置中文字体；\n4. 产出脚本需在代码顶部注明使用方式与参数说明。',
                    },
                    {
                      label: '自媒体脚本创作',
                      prompt: '【项目角色设定】：\n你是一位资深新媒体与短视频策划导师。在此空间中，请使用网感强、结构清晰的脚本分镜语言回复我；每次输出文案时，提供黄金前3秒钩子、核心干货展开以及结尾行动号召。',
                    },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setEditWsPrompt(preset.prompt)}
                      className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 text-[11px] transition-colors cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowRulesModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isEditingWs}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {isEditingWs && <Loader2 size={12} className="animate-spin" />}
                  <span>保存并应用到当前空间</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* 8. Create Workspace Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <FolderPlus size={18} className="text-indigo-400" />
                <h3 className="text-base font-bold text-zinc-100">新建 Studio 工作空间</h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-400 hover:text-zinc-100 text-xs cursor-pointer"
              >
                取消
              </button>
            </div>

            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  工作区名称 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  placeholder="例如：web-crawler、algo-sandbox、my-project"
                  className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">工作区简介（可选）</label>
                <textarea
                  value={newWsDesc}
                  onChange={(e) => setNewWsDesc(e.target.value)}
                  placeholder="工作区的核心目标或业务背景..."
                  rows={2}
                  className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300">空间提示词与项目规范（可选）</label>
                  <span className="text-[10px] text-zinc-500 font-mono">自动同步 AGENTS.md</span>
                </div>
                <textarea
                  value={newWsPrompt}
                  onChange={(e) => setNewWsPrompt(e.target.value)}
                  placeholder="设定专属的角色要求、技术栈规范或开发约束，例如：使用 Next.js 15 App Router，代码必须加详细注释..."
                  rows={3}
                  className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none font-mono text-[11px]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!newWsName.trim() || isCreatingWs}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {isCreatingWs && <Loader2 size={12} className="animate-spin" />}
                  <span>立即创建并切换</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 9. Edit Workspace Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Edit2 size={16} className="text-indigo-400" />
                <h3 className="text-base font-bold text-zinc-100">编辑工作区信息</h3>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-zinc-400 hover:text-zinc-100 text-xs cursor-pointer"
              >
                取消
              </button>
            </div>

            <form onSubmit={handleEditWorkspace} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  工作区名称 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={editWsName}
                  onChange={(e) => setEditWsName(e.target.value)}
                  className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300">工作区简介</label>
                <textarea
                  value={editWsDesc}
                  onChange={(e) => setEditWsDesc(e.target.value)}
                  placeholder="工作区的核心目标或业务背景..."
                  rows={2}
                  className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-300">空间提示词与项目规范</label>
                  <span className="text-[10px] text-zinc-500 font-mono">保存时自动同步至 AGENTS.md</span>
                </div>
                <textarea
                  value={editWsPrompt}
                  onChange={(e) => setEditWsPrompt(e.target.value)}
                  placeholder="设定专属的角色要求、技术栈规范或开发约束..."
                  rows={3}
                  className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 resize-none font-mono text-[11px]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!editWsName.trim() || isEditingWs}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {isEditingWs && <Loader2 size={12} className="animate-spin" />}
                  <span>保存修改</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 9. Install / Create Workspace Skill Modal */}
      {showSkillModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <BookOpen size={18} className="text-amber-400" />
                <h3 className="text-base font-bold text-zinc-100">安装与创建工作区技能</h3>
              </div>
              <button
                onClick={() => setShowSkillModal(false)}
                className="text-zinc-400 hover:text-zinc-100 text-xs cursor-pointer"
              >
                关闭
              </button>
            </div>

            {/* Tab switch: Presets vs Custom */}
            <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
              <button
                type="button"
                onClick={() => setSkillModalTab('presets')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                  skillModalTab === 'presets'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                )}
              >
                官方推荐预设库
              </button>
              <button
                type="button"
                onClick={() => setSkillModalTab('custom')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                  skillModalTab === 'custom'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                )}
              >
                自定义编写技能
              </button>
            </div>

            {skillModalTab === 'presets' ? (
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {skillPresets.length === 0 ? (
                  <div className="text-center py-8 text-xs text-zinc-500">
                    加载中...
                  </div>
                ) : (
                  skillPresets.map((preset) => {
                    const isInstalled = workspaceSkills.some((s) => s.id === preset.id);
                    return (
                      <div
                        key={preset.id}
                        className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 hover:border-zinc-700/80 transition-all flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-200 font-mono">
                              {preset.id}
                            </span>
                            <span className="text-[10px] text-zinc-400 truncate">
                              {preset.name}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            {preset.description}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleInstallPreset(preset.id)}
                          disabled={isInstalled || isSubmittingSkill}
                          className={cn(
                            'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 cursor-pointer flex items-center gap-1',
                            isInstalled
                              ? 'bg-zinc-800 text-zinc-500 border border-zinc-700/50 cursor-not-allowed'
                              : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                          )}
                        >
                          {isInstalled ? (
                            <>
                              <CheckCircle size={11} className="text-emerald-400" />
                              <span>已安装</span>
                            </>
                          ) : (
                            <>
                              <Download size={11} />
                              <span>一键安装</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreateCustomSkill();
                }}
                className="space-y-3 text-xs"
              >
                <div className="space-y-1">
                  <label className="font-semibold text-zinc-300">技能目录英文标识 (ID)</label>
                  <input
                    type="text"
                    value={newSkillName}
                    onChange={(e) => setNewSkillName(e.target.value)}
                    placeholder="如: custom-parser, doc-generator"
                    className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-300">功能简述</label>
                  <input
                    type="text"
                    value={newSkillDesc}
                    onChange={(e) => setNewSkillDesc(e.target.value)}
                    placeholder="简要说明该技能的作用与触发场景..."
                    className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-zinc-300">SKILL.md 提示词与实现内容</label>
                  <textarea
                    value={newSkillContent}
                    onChange={(e) => setNewSkillContent(e.target.value)}
                    placeholder="输入技能规范说明、调用指令与步骤要求（遵循标准 Agent Skills 规范）..."
                    rows={6}
                    className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono text-[11px] leading-relaxed resize-none"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSkillModal(false)}
                    className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={!newSkillName.trim() || isSubmittingSkill}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    {isSubmittingSkill && <Loader2 size={12} className="animate-spin" />}
                    <span>创建技能并加载</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 10. Preview Skill Definition Modal */}
      {previewingSkill && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <BookOpen size={17} className="text-amber-400" />
                <h3 className="text-base font-bold text-zinc-100">
                  技能定义: {previewingSkill.name}
                </h3>
              </div>
              <button
                onClick={() => setPreviewingSkill(null)}
                className="text-zinc-400 hover:text-zinc-100 text-xs cursor-pointer"
              >
                关闭
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="font-mono text-[11px] text-zinc-500">
                  路径: .pi/skills/{previewingSkill.id}/SKILL.md
                </span>
                <span
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-mono',
                    previewingSkill.enabled
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-zinc-800 text-zinc-500'
                  )}
                >
                  {previewingSkill.enabled ? '已启用' : '已禁用'}
                </span>
              </div>

              <pre className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-80 leading-relaxed whitespace-pre-wrap select-text">
                {previewingSkill.content || '(无定义内容)'}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800/80">
              <button
                onClick={() => handleCopyToolResult(previewingSkill.content || '')}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-750 text-xs text-zinc-200 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Copy size={12} />
                <span>复制技能源码</span>
              </button>
              <button
                onClick={() => setPreviewingSkill(null)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
