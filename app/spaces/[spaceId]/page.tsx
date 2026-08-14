'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Activity, ArrowLeft, AtSign, Check, CheckCircle2, ChevronRight, Download, FilePenLine, FileText, Globe2, History, ListTodo, Loader2, Paperclip, Plus, RotateCcw, Save, Send, Settings2, SkipForward, Square, Trash2, UploadCloud, UsersRound, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppShell from '@/components/layout/AppShell';
import Avatar from '@/components/shared/Avatar';
import LoginRequired from '@/components/auth/LoginRequired';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ComposerShell from '@/components/chat/ComposerShell';
import SpaceMessageItem from '@/components/spaces/SpaceMessageItem';
import TaskProposalDialog, { type TaskProposalRevision } from '@/components/spaces/TaskProposalDialog';
import TaskReviewDialog from '@/components/spaces/TaskReviewDialog';
import SpaceFileEditorDialog from '@/components/spaces/SpaceFileEditorDialog';
import { CompressionStatusPanel } from '@/components/spaces/CompressionStatusPanel';
import { agentRuns as agentRunsApi, agents as agentsApi, spaces as spacesApi, streamSpaceMessage } from '@/lib/api';
import { getBuiltInAgents } from '@/lib/agents-data';
import { taskProposalCapabilities } from '@/lib/task-proposals';
import { isEditableSpaceFile } from '@/lib/space-files';
import type { Agent, AgentRun, AgentRunEvent, AgentTask, SpaceFile, SpaceMessage, SpaceTaskProposal } from '@/types';

const FALLBACK_COLOR = '#4f46e5';
const SPACE_COORDINATOR_ID = 'space-coordinator';
const DEFAULT_COORDINATOR = {
  id: SPACE_COORDINATOR_ID,
  name: '空间协调者',
  avatar: '🧭',
  category: '协调者',
  description: '默认接收未 @ 的消息，负责理解需求和协调成员。',
};

const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'PLANNING', 'RUNNING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED']);
const RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: '等待执行',
  PLANNING: '正在拆分任务',
  RUNNING: '正在执行',
  WAITING_APPROVAL: '等待审核',
  SUMMARIZING: '正在汇总',
  COMPLETED: '已完成',
  FAILED: '执行失败',
  CANCEL_REQUESTED: '正在取消',
  CANCELLED: '已取消',
};
const TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: '等待中',
  RUNNING: '执行中',
  WAITING_APPROVAL: '待审核',
  CANCEL_REQUESTED: '正在停止',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
  SKIPPED: '已跳过',
};
const FILE_STATUS_LABELS: Record<string, string> = {
  GENERATING: '生成中',
  WAITING_APPROVAL: '待审核',
  INCOMPLETE: '未完成',
};

type RunEventPayload = {
  taskId?: string;
  tool?: string;
  path?: string;
  paths?: string[];
  valid?: boolean;
  fileName?: string;
  size?: number;
  files?: Array<{ fileName?: string; size?: number }>;
};

const TOOL_LABELS: Record<string, string> = {
  list_files: '查看目录',
  read_file: '读取文件',
  write_file: '写入文件',
  patch_file: '修改文件',
  check_files: '检查文件',
};

function eventPayload(event: AgentRunEvent) {
  return event.payload && typeof event.payload === 'object' ? (event.payload as RunEventPayload) : {};
}

function formatActivityEvent(event: AgentRunEvent) {
  const payload = eventPayload(event);
  if (event.type === 'TOOL_COMPLETED') {
    const paths = payload.path ? [payload.path] : payload.paths || [];
    return {
      title: TOOL_LABELS[payload.tool || ''] || event.message,
      detail: paths.length > 0 ? paths.join('、') : payload.tool === 'list_files' ? '工作区根目录' : '',
      checked: payload.tool === 'check_files' && payload.valid,
    };
  }
  return { title: event.message, detail: '', checked: event.type === 'TASK_COMPLETED' };
}

function formatEventTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatBytes(value?: number | null) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatRunDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function FileStatus({ status }: { status?: SpaceFile['status'] }) {
  const label = status ? FILE_STATUS_LABELS[status] : '';
  if (!label) return null;
  const color = status === 'INCOMPLETE'
    ? 'bg-rose-50 text-rose-600'
    : status === 'WAITING_APPROVAL'
      ? 'bg-sky-50 text-sky-600'
      : 'bg-amber-50 text-amber-600';
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${color}`}>{label}</span>;
}

function taskProposalOf(message: SpaceMessage) {
  return message.attachments?.find((attachment): attachment is SpaceTaskProposal => attachment.type === 'task_proposal');
}

export default function SpaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const spaceId = params.spaceId as string;
  const [space, setSpace] = useState<any | null>(null);
  const [messages, setMessages] = useState<SpaceMessage[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [files, setFiles] = useState<SpaceFile[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [mode, setMode] = useState<'chat' | 'task'>('chat');
  const [sidePanel, setSidePanel] = useState<'members' | 'files' | 'runs' | 'settings' | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingSpeakerId, setStreamingSpeakerId] = useState<string | null>(null);
  const [addingAgentId, setAddingAgentId] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState('');
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [runActionLoading, setRunActionLoading] = useState(false);
  const [proposalActionMessageId, setProposalActionMessageId] = useState<string | null>(null);
  const [editingProposal, setEditingProposal] = useState<{ message: SpaceMessage; proposal: SpaceTaskProposal } | null>(null);
  const [proposalEditError, setProposalEditError] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeActionMessageId, setActiveActionMessageId] = useState<string | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<SpaceMessage | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [pendingCancelTask, setPendingCancelTask] = useState<AgentTask | null>(null);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'retry' | 'skip' | null>(null);
  const [revisionTask, setRevisionTask] = useState<AgentTask | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [editingFile, setEditingFile] = useState<SpaceFile | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const memberAgents = useMemo(
    () => (space?.members || []).map((member: any) => agentById.get(member.agentId)).filter(Boolean) as Agent[],
    [agentById, space]
  );
  const availableAgents = useMemo(
    () => agents.filter((agent) => !(space?.members || []).some((member: any) => member.agentId === agent.id)),
    [agents, space]
  );
  const coordinatorAgent = useMemo(() => space?.hostAgent || DEFAULT_COORDINATOR, [space]);
  const latestRun = runs[0] || null;
  const activeRun = runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status)) || null;
  const currentRun = (selectedRunId ? runs.find((run) => run.id === selectedRunId) : null) || activeRun || runs[0] || null;
  const taskActivityById = useMemo(() => {
    const grouped = new Map<string, AgentRunEvent[]>();
    for (const event of currentRun?.events || []) {
      const taskId = eventPayload(event).taskId;
      if (!taskId) continue;
      grouped.set(taskId, [...(grouped.get(taskId) || []), event]);
    }
    return grouped;
  }, [currentRun]);
  const latestAssistantMessageId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  const isRunActive = Boolean(activeRun);
  const completedTaskCount = currentRun?.tasks.filter((task) => task.status === 'COMPLETED').length || 0;
  const activeTask = currentRun?.tasks.find((task) => ['RUNNING', 'WAITING_APPROVAL', 'CANCEL_REQUESTED'].includes(task.status)) || null;
  const reviewTask = currentRun?.tasks.find((task) => task.status === 'WAITING_APPROVAL') || null;
  const taskProgress = currentRun?.tasks.length ? Math.round((completedTaskCount / currentRun.tasks.length) * 100) : 0;
  const memberStatus = (agentId: string) => {
    const agentTasks = activeRun?.tasks.filter((item) => item.agentId === agentId) || [];
    const task = agentTasks.find((item) => item.status === 'CANCEL_REQUESTED')
      || agentTasks.find((item) => item.status === 'RUNNING')
      || agentTasks.find((item) => item.status === 'WAITING_APPROVAL')
      || agentTasks.find((item) => item.status === 'PENDING')
      || null;
    if (task?.status === 'CANCEL_REQUESTED') return { label: '正在停止', color: 'bg-rose-400', text: 'text-rose-500', task };
    if (task?.status === 'RUNNING') return { label: '工作中', color: 'bg-emerald-500', text: 'text-emerald-600', task };
    if (task?.status === 'WAITING_APPROVAL') return { label: '待审核', color: 'bg-sky-400', text: 'text-sky-600', task };
    if (task?.status === 'PENDING') return { label: '等待中', color: 'bg-amber-400', text: 'text-amber-600', task };
    return { label: '空闲', color: 'bg-slate-300', text: 'text-slate-400', task: null };
  };
  const coordinatorStatus = activeRun && ['PLANNING', 'SUMMARIZING'].includes(activeRun.status)
    ? { label: '协调中', color: 'bg-emerald-500', text: 'text-emerald-600' }
    : { label: '在线', color: 'bg-slate-300', text: 'text-slate-400' };
  const latestResearchEvent = currentRun
    ? [...currentRun.events].reverse().find((event) => event.type.startsWith('WEB_SEARCH_')) || null
    : null;
  const runArtifacts = useMemo(
    () => currentRun ? files.filter((file) => file.runId === currentRun.id) : [],
    [currentRun, files]
  );
  const reviewFiles = useMemo(
    () => reviewTask ? files.filter((file) => file.taskId === reviewTask.id) : [],
    [files, reviewTask]
  );
  const speakerById = useMemo(() => {
    const map = new Map<string, any>(agents.map((agent) => [agent.id, agent]));
    map.set(coordinatorAgent.id, coordinatorAgent);
    return map;
  }, [agents, coordinatorAgent]);

  const load = async () => {
    if (!localStorage.getItem('token')) {
      setNeedsLogin(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [spaceResult, messageResult, fileResult, runResult, builtIn, customResult] = await Promise.all([
        spacesApi.get(spaceId),
        spacesApi.messages(spaceId, { limit: 60 }),
        spacesApi.files(spaceId),
        spacesApi.runs(spaceId),
        getBuiltInAgents(),
        agentsApi.mine().catch(() => ({ agents: [] })),
      ]);
      setAgents([...customResult.agents, ...builtIn]);
      setSpace(spaceResult.space);
      setInstructionsDraft(spaceResult.space.instructions || '');
      setMessages(messageResult.messages);
      setFiles(fileResult.files);
      setRuns(runResult.runs);
      setSelectedRunId(null);
    } catch (err: any) {
      setError(err.message || '加载空间失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [spaceId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: isStreaming ? 'auto' : 'smooth' });
  }, [messages.length, streamingContent, isStreaming]);

  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(async () => {
      try {
        const [result, fileResult] = await Promise.all([
          agentRunsApi.get(activeRun.id),
          spacesApi.files(spaceId),
        ]);
        setRuns((items) => items.map((item) => (item.id === result.run.id ? result.run : item)));
        setFiles(fileResult.files);
      } catch {
        // Keep the last persisted state visible; the next poll can recover from a transient failure.
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeRun?.id, activeRun?.status, spaceId]);

  useEffect(() => {
    if (!latestRun || ACTIVE_RUN_STATUSES.has(latestRun.status)) return;
    spacesApi.files(spaceId).then((result) => setFiles(result.files)).catch(() => {});
  }, [latestRun?.id, latestRun?.status, spaceId]);

  useEffect(() => {
    if (sidePanel) setMentionMenuOpen(false);
  }, [sidePanel]);

  const refreshSpace = async () => {
    const result = await spacesApi.get(spaceId);
    setSpace(result.space);
  };

  const addMember = async () => {
    if (!addingAgentId) return;
    await spacesApi.addMember(spaceId, { agentId: addingAgentId });
    setAddingAgentId('');
    await refreshSpace();
  };

  const removeMember = async (memberId: string) => {
    await spacesApi.removeMember(spaceId, memberId);
    await refreshSpace();
  };

  const uploadFile = async (file?: File) => {
    if (!file || uploadingFile) return;
    setUploadingFile(true);
    setError('');
    try {
      const result = await spacesApi.uploadFile(spaceId, file);
      setFiles((items) => [result.file, ...items]);
    } catch (err: any) {
      setError(err.message || '上传资料失败');
    } finally {
      setUploadingFile(false);
    }
  };

  const insertMention = (agent: Agent) => {
    setInput((current) => {
      const prefix = current.trim() ? `${current.trimEnd()} ` : '';
      return `${prefix}@${agent.name} `;
    });
    setMentionMenuOpen(false);
  };

  const sendMessage = async (
    content: string,
    options?: { reuseLastUserMessage?: boolean; historyOverride?: SpaceMessage[] }
  ) => {
    if (!content || isStreaming) return;

    const userMessage: SpaceMessage = {
      id: `user-${Date.now()}`,
      spaceId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    const history = options?.historyOverride || messages;
    const nextMessages = options?.reuseLastUserMessage ? history : [...history, userMessage];
    setMessages(nextMessages);
    if (!options?.reuseLastUserMessage) setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingSpeakerId(null);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const result = await streamSpaceMessage({
        spaceId,
        message: content,
        history: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
          speakerAgentId: message.speakerAgentId,
        })),
        skipPersistUserMessage: options?.reuseLastUserMessage,
        signal: controller.signal,
      });
      setStreamingSpeakerId(result.speakerAgentId || null);

      const reader = result.stream.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;
        setStreamingContent(fullContent);
      }

      const [messageResult, fileResult] = await Promise.all([
        spacesApi.messages(spaceId, { limit: 60 }),
        result.workspaceFilesChanged > 0 ? spacesApi.files(spaceId) : Promise.resolve(null),
        refreshSpace(),
      ]);
      setMessages(messageResult.messages);
      if (fileResult) setFiles(fileResult.files);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || '发送失败');
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamingContent('');
  };

  const saveInstructions = async () => {
    if (savingInstructions) return;
    setSavingInstructions(true);
    setError('');
    try {
      const result = await spacesApi.update(spaceId, { instructions: instructionsDraft.trim() || null });
      setSpace((current: any) => ({ ...current, ...result.space }));
      setInstructionsDraft(result.space.instructions || '');
    } catch (err: any) {
      setError(err.message || '保存空间规则失败');
    } finally {
      setSavingInstructions(false);
    }
  };

  const send = () => {
    setMentionMenuOpen(false);
    return sendMessage(input.trim());
  };

  const copyMessage = (message: SpaceMessage) => {
    navigator.clipboard.writeText(message.content);
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId(null), 1800);
  };

  const regenerateMessage = async () => {
    if (!latestAssistantMessageId || isStreaming) return;
    const assistantIndex = messages.findIndex((message) => message.id === latestAssistantMessageId);
    const lastUserMessage = [...messages.slice(0, assistantIndex)].reverse().find((message) => message.role === 'user');
    if (!lastUserMessage) return;

    const nextMessages = messages.filter((message) => message.id !== latestAssistantMessageId);
    try {
      if (!latestAssistantMessageId.startsWith('assistant-')) {
        await spacesApi.deleteMessage(spaceId, latestAssistantMessageId);
      }
      setMessages(nextMessages);
      await sendMessage(lastUserMessage.content, { reuseLastUserMessage: true, historyOverride: nextMessages });
    } catch (err: any) {
      setError(err.message || '重新生成失败');
    }
  };

  const deleteMessage = async () => {
    if (!pendingDeleteMessage || deletingMessageId) return;
    setDeletingMessageId(pendingDeleteMessage.id);
    try {
      if (!pendingDeleteMessage.id.startsWith('user-') && !pendingDeleteMessage.id.startsWith('assistant-')) {
        await spacesApi.deleteMessage(spaceId, pendingDeleteMessage.id);
      }
      setMessages((current) => current.filter((message) => message.id !== pendingDeleteMessage.id));
      setPendingDeleteMessage(null);
    } catch (err: any) {
      setError(err.message || '删除消息失败');
    } finally {
      setDeletingMessageId(null);
    }
  };

  const downloadFile = async (file: SpaceFile) => {
    if (downloadingFileId) return;
    setDownloadingFileId(file.id);
    setError('');
    try {
      const blob = await spacesApi.downloadFile(spaceId, file.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '下载资料失败');
    } finally {
      setDownloadingFileId('');
    }
  };

  const openFile = (file: SpaceFile) => {
    if (isEditableSpaceFile(file.fileName)) setEditingFile(file);
    else downloadFile(file);
  };

  const approveTaskProposal = async (
    message: SpaceMessage,
    proposal: SpaceTaskProposal,
    revision?: TaskProposalRevision
  ) => {
    if (proposal.status !== 'pending' || isRunActive || proposalActionMessageId) return;
    setProposalActionMessageId(message.id);
    setError('');
    try {
      const result = await spacesApi.createRun(spaceId, revision?.goal || proposal.goal, message.id, revision);
      setRuns((items) => [result.run, ...items]);
      setSelectedRunId(result.run.id);
      setMessages((items) => items.map((item) => item.id === message.id ? {
        ...item,
        attachments: item.attachments?.map((attachment) => {
          if (attachment.type !== 'task_proposal') return attachment;
          const updated = revision ? { ...attachment, ...revision } : attachment;
          return {
            ...updated,
            capabilities: taskProposalCapabilities(updated.goal, updated.steps, updated.deliverables),
            status: 'approved' as const,
            runId: result.run.id,
          };
        }),
      } : item));
      setEditingProposal(null);
      setProposalEditError('');
    } catch (err: any) {
      const message = err.message || '确认任务失败';
      setError(message);
      if (revision) setProposalEditError(message);
    } finally {
      setProposalActionMessageId(null);
    }
  };

  const rejectTaskProposal = async (message: SpaceMessage) => {
    if (proposalActionMessageId) return;
    setProposalActionMessageId(message.id);
    setError('');
    try {
      const result = await spacesApi.rejectTaskProposal(spaceId, message.id);
      setMessages((items) => items.map((item) => item.id === message.id ? result.message : item));
    } catch (err: any) {
      setError(err.message || '取消任务方案失败');
    } finally {
      setProposalActionMessageId(null);
    }
  };

  const cancelRun = async () => {
    if (!activeRun || runActionLoading) return;
    setRunActionLoading(true);
    setError('');
    try {
      const result = await agentRunsApi.cancel(activeRun.id);
      setRuns((items) => items.map((item) => (item.id === result.run.id ? result.run : item)));
    } catch (err: any) {
      setError(err.message || '取消任务失败');
    } finally {
      setRunActionLoading(false);
    }
  };

  const cancelAgentTask = async () => {
    if (!activeRun || !pendingCancelTask || cancellingTaskId) return;
    const task = pendingCancelTask;
    setCancellingTaskId(task.id);
    setError('');
    try {
      const result = await agentRunsApi.cancelTask(activeRun.id, task.id);
      setRuns((items) => items.map((item) => (item.id === result.run.id ? result.run : item)));
      setPendingCancelTask(null);
    } catch (err: any) {
      setError(err.message || '停止当前步骤失败');
    } finally {
      setCancellingTaskId(null);
    }
  };

  const retryRun = async () => {
    if (!currentRun || isRunActive || runActionLoading) return;
    setRunActionLoading(true);
    setError('');
    try {
      const result = await agentRunsApi.retry(currentRun.id);
      setRuns((items) => [result.run, ...items]);
      setSelectedRunId(result.run.id);
    } catch (err: any) {
      setError(err.message || '重试任务失败');
    } finally {
      setRunActionLoading(false);
    }
  };

  const reviewCurrentTask = async (action: 'approve' | 'retry' | 'skip', feedback?: string) => {
    if (!currentRun || !reviewTask || reviewAction) return;
    setReviewAction(action);
    setReviewError('');
    try {
      const result = await agentRunsApi.reviewTask(currentRun.id, reviewTask.id, action, feedback);
      const fileResult = await spacesApi.files(spaceId);
      setRuns((items) => items.map((item) => (item.id === result.run.id ? result.run : item)));
      setFiles(fileResult.files);
      setRevisionTask(null);
    } catch (err: any) {
      const message = err.message || '处理审核失败';
      setError(message);
      setReviewError(message);
    } finally {
      setReviewAction(null);
    }
  };

  if (loading) {
    return (
      <AppShell hideHeader hideBottomNav>
        <div className="flex justify-center py-24 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      </AppShell>
    );
  }

  if (needsLogin) {
    return (
      <AppShell hideHeader hideBottomNav>
        <div className="py-8">
          <LoginRequired title="登录后进入空间" description="空间会保存成员、消息和资料，需要登录后使用。" />
        </div>
      </AppShell>
    );
  }

  if (!space) {
    return (
      <AppShell hideHeader hideBottomNav>
        <div className="py-20 text-center text-sm font-bold text-slate-400">空间不存在</div>
      </AppShell>
    );
  }

  const streamingSpeaker = streamingSpeakerId ? speakerById.get(streamingSpeakerId) : coordinatorAgent;

  return (
    <AppShell hideHeader hideBottomNav mainClassName="!max-w-none !px-0 !pb-0">
      <div className="flex h-dvh min-h-0 flex-col">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            uploadFile(file);
          }}
        />

        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-white">
          <aside className="hidden w-[320px] shrink-0 flex-col border-r border-black/[0.06] bg-white lg:flex">
            <div className="border-b border-black/[0.06] px-6 pb-6 pt-5">
              <button
                type="button"
                onClick={() => router.push('/spaces')}
                className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-black/[0.06] bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:text-slate-950"
              >
                <ArrowLeft size={16} />
                返回
              </button>
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-lg text-white">
                  {coordinatorAgent.avatar || '🧭'}
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-black text-slate-950">{space.name}</h1>
                  <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-400">
                    {space.description || `${memberAgents.length + 1} 位成员协作空间`}
                  </p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <CompressionStatusPanel spaceId={spaceId} compact />
              <section className="border-b border-black/[0.06] px-6 py-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-black text-slate-500">
                    <UsersRound size={15} />
                    空间成员
                    <span className="text-slate-300">{memberAgents.length + 1}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSidePanel('members')}
                    className="text-xs font-black text-slate-400 transition hover:text-slate-950"
                  >
                    管理
                  </button>
                </div>
                <div className="space-y-1">
                  <div className="flex w-full items-center gap-3 rounded-lg px-2 py-2">
                    <Avatar src={coordinatorAgent.avatar || '🧭'} alt={coordinatorAgent.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-slate-800">{coordinatorAgent.name}</div>
                      <div className="truncate text-xs font-semibold text-slate-400">默认协调者</div>
                    </div>
                    <span className={`flex shrink-0 items-center gap-1.5 text-[11px] font-black ${coordinatorStatus.text}`}>
                      <span className={`h-2 w-2 rounded-full ${coordinatorStatus.color}`} />
                      {coordinatorStatus.label}
                    </span>
                  </div>
                  {memberAgents.slice(0, 5).map((agent) => {
                    const status = memberStatus(agent.id);
                    return (
                      <div key={agent.id} className="flex w-full items-center gap-3 rounded-lg px-2 py-2">
                        <Avatar src={agent.avatar || '🤖'} alt={agent.name} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-black text-slate-800">{agent.name}</div>
                          <div className="truncate text-xs font-semibold text-slate-400">{agent.category || 'Agent'}</div>
                        </div>
                        <span className={`flex shrink-0 items-center gap-1.5 text-[11px] font-black ${status.text}`}>
                          <span className={`h-2 w-2 rounded-full ${status.color}`} />
                          {status.label}
                        </span>
                        {status.task?.status === 'RUNNING' && (
                          <button
                            type="button"
                            onClick={() => setPendingCancelTask(status.task)}
                            aria-label={`停止${agent.name}当前步骤`}
                            title="停止当前步骤"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-rose-400 transition hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Square size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="border-b border-black/[0.06] px-6 py-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-black text-slate-500">
                    <FileText size={15} />
                    空间资料
                    <span className="text-slate-300">{files.length}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSidePanel('files')}
                    className="text-xs font-black text-slate-400 transition hover:text-slate-950"
                  >
                    管理
                  </button>
                </div>
                {files.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center gap-3 rounded-lg border border-dashed border-slate-200 px-3 py-3 text-left text-xs font-bold text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
                  >
                    <UploadCloud size={16} />
                    上传第一份空间资料
                  </button>
                ) : (
                  <div className="space-y-1">
                    {files.slice(0, 4).map((file) => (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => openFile(file)}
                        title={isEditableSpaceFile(file.fileName) ? '编辑文件' : '下载文件'}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-[#fbfaf7]"
                      >
                        <FileText size={15} className="shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 flex-1 truncate text-xs font-black text-slate-700">{file.fileName}</div>
                            <FileStatus status={file.status} />
                          </div>
                          <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{formatBytes(file.size)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="px-6 py-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-black text-slate-500">
                    <Settings2 size={15} />
                    空间规则
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setInstructionsDraft(space.instructions || '');
                      setSidePanel('settings');
                    }}
                    className="text-xs font-black text-slate-400 transition hover:text-slate-950"
                  >
                    编辑
                  </button>
                </div>
                <p className="line-clamp-4 whitespace-pre-wrap text-xs font-semibold leading-5 text-slate-400">
                  {space.instructions || '暂未设置空间规则。'}
                </p>
              </section>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] bg-white px-3 py-3 sm:px-5 lg:hidden">
              <button
                type="button"
                onClick={() => router.push('/spaces')}
                title="返回空间"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-black text-slate-950 sm:text-lg">{space.name}</h1>
                <p className="truncate text-xs font-semibold text-slate-400">
                  {space.description || `${memberAgents.length + 1} 位成员`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSidePanel('members')}
                aria-expanded={sidePanel === 'members'}
                aria-label={`空间成员，共 ${memberAgents.length + 1} 位`}
                title="空间成员"
                className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-black text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
              >
                <UsersRound size={17} />
                <span className="hidden md:inline">成员</span>
                <span className="text-xs text-slate-400">{memberAgents.length + 1}</span>
              </button>
              <button
                type="button"
                onClick={() => setSidePanel('files')}
                aria-expanded={sidePanel === 'files'}
                aria-label={`空间资料，共 ${files.length} 个文件`}
                title="空间资料"
                className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-black text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
              >
                <FileText size={17} />
                <span className="hidden md:inline">资料</span>
                {files.length > 0 && <span className="text-xs text-slate-400">{files.length}</span>}
              </button>
              <button
                type="button"
                onClick={() => setSidePanel('runs')}
                aria-expanded={sidePanel === 'runs'}
                aria-label={`历史任务，共 ${runs.length} 条`}
                title="历史任务"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
              >
                <History size={17} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setInstructionsDraft(space.instructions || '');
                  setSidePanel('settings');
                }}
                aria-expanded={sidePanel === 'settings'}
                aria-label="空间设置"
                title="空间设置"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
              >
                <Settings2 size={17} />
              </button>
            </header>
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#fbfaf7] px-4 py-5 sm:px-6 lg:px-10 lg:py-6">
              <div className="mx-auto max-w-4xl space-y-5">
                {error && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div>}
                {mode === 'task' && (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => setMode('chat')}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-black text-slate-500 transition hover:bg-white hover:text-slate-950"
                    >
                      <ArrowLeft size={14} />
                      返回对话
                    </button>
                  {currentRun ? (
                    <div className="space-y-6">
                      <section className="border-b border-black/[0.08] pb-5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-black text-slate-400">任务目标</div>
                          <button
                            type="button"
                            onClick={() => setSidePanel('runs')}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-black text-slate-500 transition hover:bg-white hover:text-slate-950"
                          >
                            <History size={14} />
                            历史任务
                            <span className="text-slate-300">{runs.length}</span>
                          </button>
                        </div>
                        <h2 className="mt-2 line-clamp-3 text-lg font-black leading-7 text-slate-950">{currentRun.input}</h2>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-bold text-slate-400">
                          <span className={currentRun.status === 'FAILED' ? 'text-rose-500' : currentRun.status === 'COMPLETED' ? 'text-emerald-600' : 'text-slate-700'}>
                            {RUN_STATUS_LABELS[currentRun.status] || currentRun.status}
                          </span>
                          <span>{formatRunDate(currentRun.createdAt)}</span>
                          {currentRun.attempt > 1 && <span>第 {currentRun.attempt} 次执行</span>}
                          {currentRun.id === activeRun?.id ? (
                            <button
                              type="button"
                              onClick={cancelRun}
                              disabled={runActionLoading || activeRun.status === 'CANCEL_REQUESTED'}
                              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-black text-rose-500 transition hover:bg-rose-50 disabled:text-slate-300"
                            >
                              {runActionLoading ? <Loader2 className="animate-spin" size={13} /> : <Square size={13} />}
                              停止任务
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={retryRun}
                              disabled={isRunActive || runActionLoading}
                              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-black text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:text-slate-300"
                            >
                              {runActionLoading ? <Loader2 className="animate-spin" size={13} /> : <RotateCcw size={13} />}
                              重新执行
                            </button>
                          )}
                        </div>
                      </section>

                      {currentRun.id === activeRun?.id && currentRun.status !== 'WAITING_APPROVAL' && (
                        <section className="rounded-lg border border-black/[0.06] bg-white px-4 py-4 sm:px-5">
                          <div className="flex items-start gap-3">
                            <Loader2 className="mt-0.5 shrink-0 animate-spin text-slate-500" size={17} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-black text-slate-900">
                                  {activeTask?.title || (currentRun.status === 'QUEUED' ? '等待 Worker 接收任务' : currentRun.status === 'SUMMARIZING' ? '协调者正在整理最终结果' : '协调者正在拆分任务')}
                                </div>
                                <span className="text-xs font-black text-slate-400">
                                  {completedTaskCount}/{currentRun.tasks.length || '—'}
                                </span>
                              </div>
                              {activeTask && <div className="mt-1 text-xs font-semibold text-slate-400">{activeTask.agentName}</div>}
                              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${Math.max(4, taskProgress)}%` }} />
                              </div>
                              {latestResearchEvent && (
                                <div className={`mt-3 flex items-center gap-2 text-xs font-bold ${latestResearchEvent.type === 'WEB_SEARCH_COMPLETED' ? 'text-emerald-600' : latestResearchEvent.type === 'WEB_SEARCH_STARTED' ? 'text-slate-500' : 'text-amber-600'}`}>
                                  {latestResearchEvent.type === 'WEB_SEARCH_STARTED' ? <Loader2 className="animate-spin" size={13} /> : <Globe2 size={13} />}
                                  {latestResearchEvent.message}
                                </div>
                              )}
                            </div>
                          </div>
                        </section>
                      )}

                      {currentRun.status === 'WAITING_APPROVAL' && reviewTask && (
                        <section className="border-y border-black/[0.08] py-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-black text-sky-600">第 {reviewTask.sortOrder + 1} 步待审核</div>
                              <h3 className="mt-1 text-base font-black text-slate-950">{reviewTask.title}</h3>
                              <div className="mt-1 text-xs font-semibold text-slate-400">{reviewTask.agentName} · 第 {reviewTask.attempt} 次执行</div>
                            </div>
                            <span className="rounded bg-sky-50 px-2 py-1 text-xs font-black text-sky-600">等待你的确认</span>
                          </div>
                          {reviewTask.result && (
                            <div className="markdown-body mt-5 text-sm leading-7 text-slate-700">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{reviewTask.result}</ReactMarkdown>
                            </div>
                          )}
                          {reviewFiles.length > 0 && (
                            <div className="mt-5 border-t border-black/[0.06] pt-4">
                              <div className="mb-2 text-xs font-black text-slate-500">本步骤文件</div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {reviewFiles.map((file) => (
                                  <button key={file.id} type="button" onClick={() => downloadFile(file)} className="flex min-w-0 items-center gap-3 rounded-lg border border-black/[0.06] px-3 py-2.5 text-left transition hover:bg-white">
                                    <FileText size={15} className="shrink-0 text-slate-400" />
                                    <span className="min-w-0 flex-1 truncate text-xs font-black text-slate-700">{file.fileName}</span>
                                    <FileStatus status={file.status} />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="mt-5 flex flex-col gap-2 border-t border-black/[0.06] pt-4 sm:flex-row sm:flex-wrap">
                            <button type="button" onClick={() => reviewCurrentTask('approve')} disabled={Boolean(reviewAction)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">
                              {reviewAction === 'approve' ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
                              确认并继续
                            </button>
                            <button type="button" onClick={() => { setReviewError(''); setRevisionTask(reviewTask); }} disabled={Boolean(reviewAction)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 text-xs font-black text-slate-600 transition hover:text-slate-950 disabled:text-slate-300">
                              <RotateCcw size={15} />
                              补充要求并重做
                            </button>
                            <button type="button" onClick={() => reviewCurrentTask('skip')} disabled={Boolean(reviewAction)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-xs font-black text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:text-slate-300">
                              {reviewAction === 'skip' ? <Loader2 className="animate-spin" size={15} /> : <SkipForward size={15} />}
                              跳过此步骤
                            </button>
                          </div>
                        </section>
                      )}

                      {currentRun.result && (
                        <section>
                          <div className="mb-4 flex items-center gap-3">
                            <Avatar src={coordinatorAgent.avatar || '🧭'} alt={coordinatorAgent.name} size="sm" />
                            <div>
                              <h3 className="text-sm font-black text-slate-950">交付结果</h3>
                              <div className="text-xs font-semibold text-slate-400">{coordinatorAgent.name}已完成验收</div>
                            </div>
                          </div>
                          <div className="markdown-body text-sm leading-7 text-slate-700">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentRun.result}</ReactMarkdown>
                          </div>
                        </section>
                      )}

                      {runArtifacts.length > 0 && (
                        <section className="border-t border-black/[0.08] pt-5">
                          <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-black text-slate-950">产出文件</h3>
                            <span className="text-xs font-bold text-slate-400">{runArtifacts.length} 个</span>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {runArtifacts.map((artifact) => (
                                <button
                                  key={artifact.id}
                                  type="button"
                                  onClick={() => setSidePanel('files')}
                                  className="flex min-w-0 items-center gap-3 rounded-lg border border-black/[0.06] bg-white px-4 py-3 text-left transition hover:bg-slate-50"
                                >
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                    <FileText size={16} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-black text-slate-800">{artifact.fileName}</div>
                                    <div className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-slate-400">
                                      <span>{artifact.size ? `${formatBytes(artifact.size)} · ` : ''}打开空间资料</span>
                                      <FileStatus status={artifact.status} />
                                    </div>
                                  </div>
                                </button>
                              ))}
                          </div>
                        </section>
                      )}

                      {currentRun.error && (
                        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{currentRun.error}</div>
                      )}

                      <details className="group border-t border-black/[0.08] pt-1">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-black text-slate-600 marker:hidden">
                          <span className="flex items-center gap-2">
                            <ChevronRight className="transition-transform group-open:rotate-90" size={16} />
                            执行详情
                          </span>
                          <span className="text-xs font-bold text-slate-400">{currentRun.tasks.length} 个步骤</span>
                        </summary>
                        <div className="pb-3">
                          {latestResearchEvent && (
                            <div className="mb-3 flex items-start gap-2 border-b border-black/[0.06] pb-4 text-xs font-bold text-slate-500">
                              <Globe2 className="mt-0.5 shrink-0" size={14} />
                              <span>{latestResearchEvent.message}</span>
                            </div>
                          )}
                          {currentRun.tasks.length === 0 ? (
                            <div className="py-3 text-sm font-semibold text-slate-400">尚未生成执行步骤</div>
                          ) : currentRun.tasks.map((task, index) => {
                            const activity = taskActivityById.get(task.id) || [];
                            const recentActivity = activity.slice(-10);
                            const latestActivity = recentActivity.at(-1);
                            return (
                              <details key={task.id} className="group/step border-b border-black/[0.06] last:border-b-0" open={['RUNNING', 'WAITING_APPROVAL', 'CANCEL_REQUESTED', 'FAILED'].includes(task.status) ? true : undefined}>
                                <summary className="flex cursor-pointer list-none items-start gap-3 py-4 marker:hidden">
                                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">{index + 1}</div>
                                  <div className="min-w-0 flex-1">
                                    <div className="font-black text-slate-900">{task.title}</div>
                                    <div className="mt-1 text-xs font-semibold text-slate-400">{task.agentName}</div>
                                  </div>
                                  <span className={task.status === 'FAILED' ? 'text-xs font-black text-rose-500' : 'text-xs font-black text-slate-400'}>
                                    {TASK_STATUS_LABELS[task.status] || task.status}
                                  </span>
                                </summary>
                                <div className="mb-4 ml-10 border-l-2 border-slate-200 pl-4">
                                  <div className="text-[11px] font-black text-slate-400">任务内容</div>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-slate-600">{task.instruction}</p>
                                  {recentActivity.length > 0 && (
                                    <div className="mt-4 space-y-3">
                                      {recentActivity.map((event) => {
                                        const activityItem = formatActivityEvent(event);
                                        const isCurrent = task.status === 'RUNNING' && event.id === latestActivity?.id;
                                        return (
                                          <div key={event.id} className="flex min-w-0 items-start gap-2.5">
                                            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-slate-400">
                                              {isCurrent && ['MODEL_WORKING', 'MODEL_STREAMING', 'MODEL_RETRYING'].includes(event.type) ? <Loader2 className="animate-spin" size={14} /> : activityItem.checked ? <CheckCircle2 className="text-emerald-500" size={14} /> : <Activity size={14} />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <div className="text-xs font-bold leading-5 text-slate-700">{activityItem.title}</div>
                                              {activityItem.detail && <div className="break-all text-[11px] font-semibold leading-5 text-slate-400">{activityItem.detail}</div>}
                                            </div>
                                            <time className="shrink-0 pt-0.5 text-[10px] font-semibold text-slate-300">{formatEventTime(event.createdAt)}</time>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {task.result && (
                                    <div className="mt-4 border-t border-black/[0.06] pt-4">
                                      <div className="mb-2 text-[11px] font-black text-slate-400">成员结果</div>
                                      <div className="markdown-body text-sm leading-7 text-slate-700"><ReactMarkdown remarkPlugins={[remarkGfm]}>{task.result}</ReactMarkdown></div>
                                    </div>
                                  )}
                                  {task.error && <div className="mt-3 text-sm font-semibold text-rose-600">{task.error}</div>}
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      </details>
                    </div>
                  ) : (
                    <div className="py-16 text-center">
                      <ListTodo className="mx-auto text-slate-300" size={30} />
                      <h2 className="mt-4 text-lg font-black text-slate-950">给空间一个完整目标</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-500">协调者会拆分步骤，并依次交给空间成员处理。</p>
                    </div>
                  )}
                  </div>
                )}
                <div className={mode === 'chat' ? 'space-y-5' : 'hidden'}>
                {messages.length === 0 && !isStreaming && (
                  <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-8 text-center">
                    <h2 className="text-lg font-black text-slate-950">先把需求交给协调者</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      有什么想法，直接说吧。
                    </p>
                  </div>
                )}
                {messages.map((message) => (
                  <SpaceMessageItem
                    key={message.id}
                    message={message}
                    speaker={message.speakerAgentId ? speakerById.get(message.speakerAgentId) : null}
                    fallbackColor={FALLBACK_COLOR}
                    latestAssistantMessageId={latestAssistantMessageId}
                    copied={copiedMessageId === message.id}
                    active={activeActionMessageId === message.id}
                    onActivate={() => setActiveActionMessageId((current) => (current === message.id ? null : message.id))}
                    onCopy={() => copyMessage(message)}
                    onRegenerate={regenerateMessage}
                    onDelete={() => setPendingDeleteMessage(message)}
                    run={taskProposalOf(message)?.runId
                      ? runs.find((run) => run.id === taskProposalOf(message)?.runId)
                      : null}
                    proposalBusy={proposalActionMessageId === message.id}
                    proposalDisabled={isRunActive}
                    onApproveProposal={(proposal) => approveTaskProposal(message, proposal)}
                    onReviseProposal={(proposal) => {
                      setProposalEditError('');
                      setEditingProposal({ message, proposal });
                    }}
                    onRejectProposal={() => rejectTaskProposal(message)}
                    onOpenRun={() => {
                      const proposal = taskProposalOf(message);
                      if (!proposal?.runId) return;
                      setSelectedRunId(proposal.runId);
                      setMode('task');
                    }}
                  />
                ))}
                {isStreaming && streamingContent && (
                  <div className="flex justify-start gap-3">
                    <Avatar src={streamingSpeaker?.avatar || '🤖'} alt={streamingSpeaker?.name || 'Agent'} size="sm" className="mt-1 shrink-0" />
                    <div className="min-w-0 max-w-[84%] rounded-[24px] rounded-bl-md border border-black/[0.06] bg-white px-5 py-4 text-slate-800 shadow-sm">
                      <div className="mb-1 text-xs font-black text-slate-400">{streamingSpeaker?.name || '空间 Agent'}</div>
                      <div className="markdown-body min-w-0 max-w-full overflow-hidden text-sm leading-7">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}
                {isStreaming && !streamingContent && (
                  <div className="flex justify-start gap-3">
                    <Avatar src={streamingSpeaker?.avatar || '🤖'} alt={streamingSpeaker?.name || 'Agent'} size="sm" className="mt-1 shrink-0" />
                    <div className="rounded-[24px] rounded-bl-md border border-black/[0.06] bg-white px-5 py-4 shadow-sm">
                      <div className="flex gap-1.5">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:150ms]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:300ms]" />
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </div>
            </div>

            <footer className="border-t border-black/[0.06] bg-white p-3 sm:p-4 lg:bg-[#fbfaf7] lg:px-10 lg:pb-4 lg:pt-3">
              <div className="mx-auto max-w-4xl">
                <ComposerShell>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  title="上传资料"
                  className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white hover:text-slate-950 disabled:text-slate-300"
                >
                  {uploadingFile ? <Loader2 className="animate-spin" size={18} /> : <Paperclip size={18} />}
                </button>
                <div className="relative mb-0.5 shrink-0">
                  {mentionMenuOpen && (
                    <div className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-64 max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-black/[0.08] bg-white py-1 shadow-xl">
                      <div className="px-3 pb-1 pt-2 text-[11px] font-black text-slate-400">选择成员</div>
                      <div className="max-h-64 overflow-y-auto p-1">
                        <button
                          type="button"
                          onClick={() => insertMention(coordinatorAgent as Agent)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-slate-50"
                        >
                          <Avatar src={coordinatorAgent.avatar || '🧭'} alt={coordinatorAgent.name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black text-slate-800">{coordinatorAgent.name}</div>
                            <div className="text-xs font-semibold text-slate-400">默认接话</div>
                          </div>
                          <span className={`flex shrink-0 items-center gap-1.5 text-[11px] font-black ${coordinatorStatus.text}`}>
                            <span className={`h-2 w-2 rounded-full ${coordinatorStatus.color}`} />
                            {coordinatorStatus.label}
                          </span>
                        </button>
                        {memberAgents.map((agent) => {
                          const status = memberStatus(agent.id);
                          return (
                            <button
                              key={agent.id}
                              type="button"
                              onClick={() => insertMention(agent)}
                              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-slate-50"
                            >
                              <Avatar src={agent.avatar || '🤖'} alt={agent.name} size="sm" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-black text-slate-800">{agent.name}</div>
                                <div className="truncate text-xs font-semibold text-slate-400">{agent.category || 'Agent'}</div>
                              </div>
                              <span className={`flex shrink-0 items-center gap-1.5 text-[11px] font-black ${status.text}`}>
                                <span className={`h-2 w-2 rounded-full ${status.color}`} />
                                {status.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setMentionMenuOpen((open) => !open)}
                    aria-expanded={mentionMenuOpen}
                    aria-label="@ 成员"
                    title="@ 成员"
                    className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${mentionMenuOpen ? 'bg-white text-slate-950' : 'text-slate-500 hover:bg-white hover:text-slate-950'}`}
                  >
                    <AtSign size={18} />
                  </button>
                </div>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  placeholder="提问或交代任务..."
                  rows={1}
                  className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none placeholder:text-slate-400"
                />
                {isStreaming ? (
                  <button onClick={stop} className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-500 text-white">
                    <Square size={17} />
                  </button>
                ) : (
                  <button
                    onClick={send}
                    disabled={!input.trim()}
                    className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    <Send size={17} />
                  </button>
                )}
                </ComposerShell>
              </div>
            </footer>
          </main>

          {sidePanel && (
            <>
              <button
                type="button"
                aria-label="关闭侧栏"
                onClick={() => setSidePanel(null)}
                className="absolute inset-0 z-10 bg-slate-950/10"
              />
              <aside className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-black/[0.06] bg-white shadow-[-16px_0_40px_-24px_rgba(15,23,42,0.35)] sm:w-[360px]">
                <div className="flex h-[65px] shrink-0 items-center justify-between border-b border-black/[0.06] px-5">
                  <div className="flex items-center gap-2 text-sm font-black text-slate-800">
                    {sidePanel === 'members' ? <UsersRound size={17} /> : sidePanel === 'files' ? <FileText size={17} /> : sidePanel === 'runs' ? <History size={17} /> : <Settings2 size={17} />}
                    {sidePanel === 'members' ? '空间成员' : sidePanel === 'files' ? '空间资料' : sidePanel === 'runs' ? '历史任务' : '空间设置'}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSidePanel(null)}
                    title="关闭"
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  {sidePanel === 'members' ? (
                    <>
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-[#fbfaf7] px-3 py-3">
                          <Avatar src={coordinatorAgent.avatar || '🧭'} alt={coordinatorAgent.name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="truncate text-sm font-black text-slate-800">{coordinatorAgent.name}</div>
                              <span className="shrink-0 rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-black text-white">默认</span>
                            </div>
                            <div className="truncate text-xs font-semibold text-slate-400">空间协调者</div>
                          </div>
                          <span className={`flex shrink-0 items-center gap-1.5 text-[11px] font-black ${coordinatorStatus.text}`}>
                            <span className={`h-2 w-2 rounded-full ${coordinatorStatus.color}`} />
                            {coordinatorStatus.label}
                          </span>
                        </div>

                        {(space.members || []).map((member: any) => {
                          const agent = agentById.get(member.agentId);
                          const status = memberStatus(member.agentId);
                          return (
                            <div key={member.id} className="flex items-center gap-3 rounded-lg px-3 py-3 transition hover:bg-[#fbfaf7]">
                              <Avatar src={agent?.avatar || '🤖'} alt={agent?.name || 'Agent'} size="sm" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-black text-slate-800">{agent?.name || member.agentId}</div>
                                <div className="truncate text-xs font-semibold text-slate-400">{member.roleName || agent?.category || 'Agent'}</div>
                              </div>
                              <span className={`flex shrink-0 items-center gap-1.5 text-[11px] font-black ${status.text}`}>
                                <span className={`h-2 w-2 rounded-full ${status.color}`} />
                                {status.label}
                              </span>
                              {status.task?.status === 'RUNNING' && (
                                <button
                                  type="button"
                                  onClick={() => setPendingCancelTask(status.task)}
                                  aria-label={`停止${agent?.name || member.agentId}当前步骤`}
                                  title="停止当前步骤"
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-rose-400 transition hover:bg-rose-50 hover:text-rose-600"
                                >
                                  <Square size={12} />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => removeMember(member.id)}
                                className="text-xs font-black text-slate-300 transition hover:text-rose-500"
                              >
                                移除
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-5 border-t border-black/[0.06] pt-5">
                        <div className="mb-3 text-xs font-black text-slate-400">添加成员</div>
                        <div className="flex gap-2">
                          <select
                            value={addingAgentId}
                            onChange={(event) => setAddingAgentId(event.target.value)}
                            className="h-11 min-w-0 flex-1 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-bold text-slate-700 outline-none"
                          >
                            <option value="">选择 Agent</option>
                            {availableAgents.slice(0, 80).map((agent) => (
                              <option key={agent.id} value={agent.id}>{agent.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={addMember}
                            disabled={!addingAgentId}
                            title="添加成员"
                            className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-white disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            <Plus size={17} />
                          </button>
                        </div>
                      </div>
                    </>
                  ) : sidePanel === 'files' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFile}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-400"
                      >
                        {uploadingFile ? <Loader2 className="animate-spin" size={15} /> : <UploadCloud size={15} />}
                        上传资料
                      </button>
                      <div className="mt-5 space-y-2">
                        {files.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 px-5 py-10 text-center">
                            <FileText className="mx-auto text-slate-300" size={24} />
                            <div className="mt-3 text-sm font-black text-slate-500">暂无资料</div>
                            <div className="mt-1 text-xs font-semibold leading-5 text-slate-400">上传的资料会保存在当前空间。</div>
                          </div>
                        ) : (
                          files.map((file) => (
                            <div key={file.id} className="flex items-center gap-3 rounded-lg border border-black/[0.06] bg-white px-3 py-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                <FileText size={16} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className="min-w-0 flex-1 truncate text-sm font-black text-slate-800">{file.fileName}</div>
                                  <FileStatus status={file.status} />
                                </div>
                                <div className="mt-0.5 text-xs font-semibold text-slate-400">{formatBytes(file.size)}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditingFile(file)}
                                disabled={!isEditableSpaceFile(file.fileName)}
                                title={isEditableSpaceFile(file.fileName) ? '编辑文件' : '当前文件类型不支持在线编辑'}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950 disabled:hidden"
                              >
                                <FilePenLine size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadFile(file)}
                                disabled={Boolean(downloadingFileId)}
                                title="下载文件"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950 disabled:text-slate-200"
                              >
                                {downloadingFileId === file.id ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : sidePanel === 'runs' ? (
                    <div className="space-y-2">
                      {runs.length === 0 ? (
                        <div className="py-12 text-center">
                          <ListTodo className="mx-auto text-slate-300" size={26} />
                          <div className="mt-3 text-sm font-black text-slate-500">暂无任务</div>
                        </div>
                      ) : runs.map((run) => {
                        const completed = run.tasks.filter((task) => task.status === 'COMPLETED').length;
                        const selected = currentRun?.id === run.id;
                        return (
                          <button
                            key={run.id}
                            type="button"
                            onClick={() => {
                              setSelectedRunId(run.id);
                              setMode('task');
                              setSidePanel(null);
                            }}
                            className={`w-full border-b border-black/[0.06] px-2 py-4 text-left transition last:border-b-0 ${selected ? 'bg-[#fbfaf7]' : 'hover:bg-[#fbfaf7]'}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="line-clamp-2 min-w-0 flex-1 text-sm font-black leading-6 text-slate-800">{run.input}</div>
                              <span className={run.status === 'FAILED' ? 'shrink-0 text-xs font-black text-rose-500' : run.status === 'COMPLETED' ? 'shrink-0 text-xs font-black text-emerald-600' : 'shrink-0 text-xs font-black text-slate-500'}>
                                {RUN_STATUS_LABELS[run.status] || run.status}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-400">
                              <span>{formatRunDate(run.createdAt)}</span>
                              <span>·</span>
                              <span>{completed}/{run.tasks.length} 步</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="space-rules" className="mb-2 block text-sm font-black text-slate-700">
                          空间规则
                        </label>
                        <textarea
                          id="space-rules"
                          value={instructionsDraft}
                          onChange={(event) => setInstructionsDraft(event.target.value)}
                          maxLength={12_000}
                          rows={14}
                          placeholder="例如：使用 TypeScript；修改后运行类型检查；所有报告使用中文。"
                          className="w-full resize-y rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                        />
                        <div className="mt-2 text-right text-xs font-semibold text-slate-400">
                          {instructionsDraft.length} / 12000
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={saveInstructions}
                        disabled={savingInstructions}
                        className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-400"
                      >
                        {savingInstructions ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
                        保存规则
                      </button>
                    </div>
                  )}
                </div>
              </aside>
            </>
          )}
        </div>
      </div>
      <TaskProposalDialog
        proposal={editingProposal?.proposal || null}
        loading={Boolean(editingProposal && proposalActionMessageId === editingProposal.message.id)}
        error={proposalEditError}
        onCancel={() => {
          setProposalEditError('');
          setEditingProposal(null);
        }}
        onConfirm={(revision) => {
          if (!editingProposal) return;
          approveTaskProposal(editingProposal.message, editingProposal.proposal, revision);
        }}
      />
      <TaskReviewDialog
        task={revisionTask}
        loading={reviewAction === 'retry'}
        error={reviewError}
        onCancel={() => {
          setReviewError('');
          setRevisionTask(null);
        }}
        onConfirm={(feedback) => reviewCurrentTask('retry', feedback)}
      />
      <SpaceFileEditorDialog
        spaceId={spaceId}
        file={editingFile}
        onClose={() => setEditingFile(null)}
        onSaved={(updatedFile) => {
          setFiles((items) => [updatedFile, ...items.filter((item) => item.id !== updatedFile.id)]);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingCancelTask)}
        title={`停止${pendingCancelTask?.agentName || '当前 Agent'}的步骤？`}
        description="当前步骤会标记为已取消，未完成的结果不会用于汇总，后续成员会继续执行。"
        icon={<Square size={18} />}
        cancelText="继续执行"
        confirmText="停止当前步骤"
        destructive
        loading={Boolean(pendingCancelTask && cancellingTaskId === pendingCancelTask.id)}
        onCancel={() => setPendingCancelTask(null)}
        onConfirm={cancelAgentTask}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteMessage)}
        title="删除这条消息？"
        description="删除后不会再出现在当前空间的聊天记录里。"
        icon={<Trash2 size={20} />}
        cancelText="先保留"
        confirmText="确认删除"
        destructive
        loading={Boolean(pendingDeleteMessage && deletingMessageId === pendingDeleteMessage.id)}
        onCancel={() => setPendingDeleteMessage(null)}
        onConfirm={deleteMessage}
      />
    </AppShell>
  );
}
