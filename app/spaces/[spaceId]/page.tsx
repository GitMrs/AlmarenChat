'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Activity, ArrowLeft, BookOpen, Check, CheckCircle2, ChevronRight, Download, FilePenLine, FileText, Globe2, History, ListTodo, Loader2, MessagesSquare, PackagePlus, Paperclip, Plus, RotateCcw, Save, Send, Settings2, ShieldCheck, SkipForward, Square, Trash2, UploadCloud, UsersRound, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppShell from '@/components/layout/AppShell';
import Avatar from '@/components/shared/Avatar';
import LoginRequired from '@/components/auth/LoginRequired';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import ComposerShell from '@/components/chat/ComposerShell';
import SpaceMessageItem from '@/components/spaces/SpaceMessageItem';
import TaskProposalDialog, { type TaskProposalRevision } from '@/components/spaces/TaskProposalDialog';
import TaskDispatchDialog, { type TaskDispatchRevision } from '@/components/spaces/TaskDispatchDialog';
import TaskReviewDialog from '@/components/spaces/TaskReviewDialog';
import SpaceFileEditorDialog from '@/components/spaces/SpaceFileEditorDialog';
import SpaceDiscussionDialog from '@/components/spaces/SpaceDiscussionDialog';
import SpaceDiscussionStatus from '@/components/spaces/SpaceDiscussionStatus';
import { CompressionStatusPanel } from '@/components/spaces/CompressionStatusPanel';
import { agentRuns as agentRunsApi, agents as agentsApi, spaces as spacesApi, streamSpaceMessage } from '@/lib/api';
import { getBuiltInAgents } from '@/lib/agents-data';
import { latestRunInRetryChain } from '@/lib/agent-run-retry-chain.mjs';
import {
  DEFAULT_CONTINUATION_ITERATIONS,
  isExecutionBudgetWait,
  isRunBudgetWait,
  MAX_CONTINUATION_ITERATIONS,
} from '@/lib/agent-wait-policy.mjs';
import { isEditableSpaceFile } from '@/lib/space-files';
import type { Agent, AgentRun, AgentRunEvent, AgentTask, SpaceDiscussion, SpaceFile, SpaceLearning, SpaceLearningItem, SpaceMessage, SpaceSkill, SpaceSkillPreview, SpaceTaskProposal, SpaceWork } from '@/types';

const FALLBACK_COLOR = '#4f46e5';
const SPACE_COORDINATOR_ID = 'space-coordinator';
const DEFAULT_COORDINATOR = {
  id: SPACE_COORDINATOR_ID,
  name: '空间协调者',
  avatar: '🧭',
  category: '协调者',
  description: '默认接收未 @ 的消息，负责理解需求和协调成员。',
};

const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED']);
const RUN_STATUS_LABELS: Record<string, string> = {
  QUEUED: '等待执行',
  PLANNING: '正在拆分任务',
  RUNNING: '正在执行',
  WAITING: '等待用户',
  WAITING_APPROVAL: '等待审核',
  SUMMARIZING: '正在汇总',
  COMPLETED: '已完成',
  PARTIAL: '部分完成',
  FAILED_VALIDATION: '验收失败',
  BLOCKED: '缺少必要条件',
  FAILED: '执行失败',
  CANCEL_REQUESTED: '正在取消',
  CANCELLED: '已取消',
};
const TASK_STATUS_LABELS: Record<string, string> = {
  PROPOSED: '待确认',
  PENDING: '等待中',
  QUEUED: '已派发',
  RUNNING: '执行中',
  WAITING: '等待用户',
  WAITING_USER: '等待补充信息',
  WAITING_APPROVAL: '待审核',
  SUBMITTED: '已提交',
  REVIEWING: '协调者验收中',
  REVISION_REQUIRED: '需要返工',
  CANCEL_REQUESTED: '正在停止',
  COMPLETED: '已完成',
  BLOCKED: '缺少必要条件',
  FAILED: '失败',
  CANCELLED: '已取消',
  SKIPPED: '已跳过',
};
const FILE_STATUS_LABELS: Record<string, string> = {
  GENERATING: '生成中',
  WAITING_APPROVAL: '待审核',
  INCOMPLETE: '未完成',
};
const LEARNING_CATEGORY_LABELS: Record<string, string> = {
  collaboration: '协作与派发',
  acceptance: '验收与返工',
  delivery: '交付可信度',
  execution: '执行方法',
};
const WORK_NOUNS: Record<string, string> = {
  'wechat-article': '文章',
  'short-video-script': '脚本',
  'story-writing': '作品',
  'research-report': '报告',
  'project-proposal': '方案',
  'product-requirements': '需求',
  'course-training': '课程',
  'simple-webpage': '页面',
};

type RunEventPayload = {
  taskId?: string;
  scope?: 'task' | 'run';
  iteration?: number;
  totalIteration?: number;
  maxIterations?: number;
  durationMs?: number;
  requestChars?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedTotalTokens?: number;
  contentChars?: number;
  reasoningContentChars?: number;
  toolCallCount?: number;
  retryCount?: number;
  finishReasons?: string[];
  providerUsage?: Record<string, number> | null;
  tool?: string;
  path?: string;
  paths?: string[];
  valid?: boolean;
  fileName?: string;
  size?: number;
  files?: Array<{ fileName?: string; size?: number }>;
  audit?: { accepted?: boolean; issues?: string[] };
  status?: string;
  summary?: { created?: number; modified?: number; deleted?: number };
  entries?: Array<{ path?: string; change?: 'CREATED' | 'MODIFIED' | 'DELETED'; valid?: boolean; issues?: string[] }>;
  validation?: { valid?: boolean; issues?: string[] };
  accepted?: boolean;
  issues?: string[];
  warnings?: string[];
  evidence?: {
    taskCount?: number;
    completedTaskCount?: number;
    workspaceChanges?: number;
    validatedFiles?: number;
    commandChecks?: number;
    coveredRequirements?: number;
    requirementCount?: number;
  };
  reason?: string;
  mode?: string;
};

const TOOL_LABELS: Record<string, string> = {
  list_files: '查看目录',
  read_file: '读取文件',
  write_file: '写入文件',
  patch_file: '修改文件',
  patch_files: '批量修改文件',
  check_files: '检查文件',
};

function eventPayload(event: AgentRunEvent) {
  return event.payload && typeof event.payload === 'object' ? (event.payload as RunEventPayload) : {};
}

function eventChangesWorkspaceFiles(event: AgentRunEvent) {
  if (['WORKSPACE_FILE_UPDATED', 'WORKSPACE_ARTIFACTS_READY'].includes(event.type)) return true;
  if (event.type !== 'TOOL_COMPLETED') return false;
  return ['write_file', 'patch_file', 'patch_files'].includes(eventPayload(event).tool || '');
}

function formatActivityEvent(event: AgentRunEvent) {
  const payload = eventPayload(event);
  if (event.type === 'MODEL_WORKING' && payload.iteration) {
    return {
      title: event.message,
      detail: payload.totalIteration && payload.totalIteration !== payload.iteration
        ? `模型请求总第 ${payload.totalIteration} 轮（本批 ${payload.iteration}/${payload.maxIterations || 12}）`
        : `模型请求 ${payload.iteration}/${payload.maxIterations || 12}`,
      checked: false,
    };
  }
  if (event.type === 'MODEL_REQUEST_COMPLETED') {
    const usage = modelUsageParts(payload);
    const details = [
      payload.durationMs ? formatDuration(payload.durationMs) : '',
      usage.reportedTokens > 0
        ? [
            usage.estimated ? '估算' : '',
            usage.inputTokens > 0 ? `输入 ${formatMetricCount(usage.inputTokens)} Token` : '',
            usage.outputTokens > 0 ? `输出 ${formatMetricCount(usage.outputTokens)} Token` : '',
            `合计 ${formatMetricCount(usage.reportedTokens)} Token`,
          ].filter(Boolean).join(' / ')
        : [
            payload.requestChars ? `输入 ${formatMetricCount(payload.requestChars)} 字符` : '',
            usage.outputChars > 0 ? `输出 ${formatMetricCount(usage.outputChars)} 字符` : '',
          ].filter(Boolean).join(' / '),
      payload.toolCallCount ? `${payload.toolCallCount} 个工具调用` : '',
      payload.retryCount ? `重试 ${payload.retryCount} 次` : '',
    ].filter(Boolean);
    return { title: event.message, detail: details.join(' · '), checked: true };
  }
  if (event.type === 'TOOL_COMPLETED') {
    const paths = payload.path ? [payload.path] : payload.paths || [];
    return {
      title: TOOL_LABELS[payload.tool || ''] || event.message,
      detail: paths.length > 0 ? paths.join('、') : payload.tool === 'list_files' ? '工作区根目录' : '',
      checked: payload.tool === 'check_files' && payload.valid,
    };
  }
  if (event.type === 'COORDINATOR_TASK_DISPATCHED') {
    return {
      title: event.message,
      detail: payload.reason || '协调者已根据实时团队与当前成果完成选人',
      checked: true,
    };
  }
  if (event.type === 'COORDINATOR_TASK_PROPOSED') {
    return {
      title: event.message,
      detail: payload.reason || '等待用户确认成员与任务边界',
      checked: false,
    };
  }
  if (event.type === 'TASK_DISPATCH_APPROVED') {
    return { title: event.message, detail: '用户已授权该成员开始执行', checked: true };
  }
  if (event.type === 'COORDINATOR_DECISION_STARTED') {
    return { title: event.message, detail: '正在读取成员状态、已有成果和剩余授权', checked: false };
  }
  if (event.type === 'COORDINATOR_GOAL_SATISFIED') {
    return { title: event.message, detail: '协调者判断已验收成果覆盖了授权目标', checked: true };
  }
  return { title: event.message, detail: '', checked: ['TASK_COMPLETED', 'TASK_ACCEPTED'].includes(event.type) };
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

function formatDuration(value: number) {
  if (value < 1_000) return `${Math.round(value)}ms`;
  const seconds = Math.round(value / 1_000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}分${remainingSeconds}秒` : `${minutes}分钟`;
}

function formatMetricCount(value: number) {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function providerUsageValue(usage: Record<string, number> | null | undefined, keys: string[]) {
  for (const key of keys) {
    const value = Number(usage?.[key]);
    if (value > 0) return value;
  }
  return 0;
}

function modelUsageParts(payload: RunEventPayload) {
  const usage = payload.providerUsage;
  const inputTokens = providerUsageValue(usage, ['prompt_tokens', 'promptTokens', 'input_tokens', 'inputTokens']);
  const outputTokens = providerUsageValue(usage, ['completion_tokens', 'completionTokens', 'output_tokens', 'outputTokens']);
  const totalTokens = providerUsageValue(usage, ['total_tokens', 'totalTokens']);
  const estimatedInputTokens = Number(payload.estimatedInputTokens) || 0;
  const estimatedOutputTokens = Number(payload.estimatedOutputTokens) || 0;
  const estimatedTotalTokens = Number(payload.estimatedTotalTokens) || estimatedInputTokens + estimatedOutputTokens;
  const reportedTokens = totalTokens || inputTokens + outputTokens;
  const outputChars = (Number(payload.contentChars) || 0) + (Number(payload.reasoningContentChars) || 0);
  const hasProviderUsage = reportedTokens > 0;
  return {
    inputTokens: inputTokens || estimatedInputTokens,
    outputTokens: outputTokens || estimatedOutputTokens,
    reportedTokens: reportedTokens || estimatedTotalTokens,
    outputChars,
    estimated: !hasProviderUsage && estimatedTotalTokens > 0,
  };
}

function aggregateModelRequests(events: AgentRunEvent[], taskOnly = false) {
  const metrics = {
    requests: 0,
    durationMs: 0,
    retries: 0,
    requestChars: 0,
    outputChars: 0,
    inputTokens: 0,
    outputTokens: 0,
    providerTokens: 0,
    providerUsageCount: 0,
    estimatedUsageCount: 0,
  };
  for (const event of events) {
    if (event.type !== 'MODEL_REQUEST_COMPLETED') continue;
    const payload = eventPayload(event);
    if (taskOnly && payload.scope === 'run') continue;
    metrics.requests += 1;
    metrics.durationMs += Number(payload.durationMs) || 0;
    metrics.retries += Number(payload.retryCount) || 0;
    metrics.requestChars += Number(payload.requestChars) || 0;
    const usage = modelUsageParts(payload);
    metrics.outputChars += usage.outputChars;
    if (usage.reportedTokens > 0) {
      metrics.inputTokens += usage.inputTokens;
      metrics.outputTokens += usage.outputTokens;
      metrics.providerTokens += usage.reportedTokens;
      if (usage.estimated) metrics.estimatedUsageCount += 1;
      else metrics.providerUsageCount += 1;
    }
  }
  return metrics;
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

function compactWorkTitle(title: string, maxLength = 14) {
  const value = title.trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function messageRunId(message: SpaceMessage) {
  const attachment = message.attachments?.find((item) => item.type === 'task_proposal' || item.type === 'run_result');
  return attachment && 'runId' in attachment ? attachment.runId : undefined;
}

function mentionedAgents(content: string, agents: Agent[]) {
  const nameCounts = new Map<string, number>();
  for (const agent of agents) {
    const key = agent.name.toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  return agents.filter((agent) => {
    if (nameCounts.get(agent.name.toLocaleLowerCase()) !== 1) return false;
    const escaped = agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`@${escaped}(?=$|\\s|[，。！？、,.;；:：])`, 'i').test(content);
  });
}

function activeMentionToken(value: string, caret: number) {
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|[\s，。！？、,.;；:：])@([^@\s，。！？、,.;；:：]*)$/.exec(beforeCaret);
  if (!match) return null;
  const start = beforeCaret.lastIndexOf('@');
  const remainingToken = value.slice(caret).match(/^[^@\s，。！？、,.;；:：]*/)?.[0] || '';
  return { start, end: caret + remainingToken.length, query: match[1] };
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
  const [works, setWorks] = useState<SpaceWork[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState('all');
  const [activeWorkId, setActiveWorkId] = useState('new');
  const [discussions, setDiscussions] = useState<SpaceDiscussion[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [mode, setMode] = useState<'chat' | 'task'>('chat');
  const [sidePanel, setSidePanel] = useState<'members' | 'files' | 'skills' | 'runs' | 'settings' | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [skills, setSkills] = useState<SpaceSkill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [skillSourceUrl, setSkillSourceUrl] = useState('');
  const [skillUploadFile, setSkillUploadFile] = useState<File | null>(null);
  const [skillPreview, setSkillPreview] = useState<SpaceSkillPreview | null>(null);
  const [skillBusy, setSkillBusy] = useState(false);
  const [pendingRemoveSkill, setPendingRemoveSkill] = useState<SpaceSkill | null>(null);
  const [pendingExecutionSkill, setPendingExecutionSkill] = useState<SpaceSkill | null>(null);
  const [approvedScriptDraft, setApprovedScriptDraft] = useState<string[]>([]);
  const [composerToolsOpen, setComposerToolsOpen] = useState(false);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingSpeakerId, setStreamingSpeakerId] = useState<string | null>(null);
  const [replyQueueAgentIds, setReplyQueueAgentIds] = useState<string[]>([]);
  const [replyQueueIndex, setReplyQueueIndex] = useState(0);
  const [addingAgentId, setAddingAgentId] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState('');
  const [instructionsDraft, setInstructionsDraft] = useState('');
  const [executionModeDraft, setExecutionModeDraft] = useState<'AUTO' | 'REVIEW_DISPATCH'>('REVIEW_DISPATCH');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [learning, setLearning] = useState<SpaceLearning | null>(null);
  const [learningReadme, setLearningReadme] = useState('');
  const [learningActionId, setLearningActionId] = useState('');
  const [clearSpaceOpen, setClearSpaceOpen] = useState(false);
  const [clearingSpace, setClearingSpace] = useState(false);
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
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<'approve' | 'retry' | 'skip' | null>(null);
  const [dispatchAction, setDispatchAction] = useState<'approve' | 'reject' | null>(null);
  const [editingDispatchTask, setEditingDispatchTask] = useState<AgentTask | null>(null);
  const [pendingRejectDispatch, setPendingRejectDispatch] = useState<AgentTask | null>(null);
  const [dispatchError, setDispatchError] = useState('');
  const [revisionTask, setRevisionTask] = useState<AgentTask | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [resumeAnswer, setResumeAnswer] = useState('');
  const [continuationIterations, setContinuationIterations] = useState(DEFAULT_CONTINUATION_ITERATIONS);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState('');
  const [editingFile, setEditingFile] = useState<SpaceFile | null>(null);
  const [discussionDialogOpen, setDiscussionDialogOpen] = useState(false);
  const [discussionTopic, setDiscussionTopic] = useState('');
  const [discussionParticipantIds, setDiscussionParticipantIds] = useState<string[]>([]);
  const [discussionAllowWeb, setDiscussionAllowWeb] = useState(false);
  const [discussionBusy, setDiscussionBusy] = useState(false);
  const [discussionError, setDiscussionError] = useState('');
  const [dismissedDiscussionIds, setDismissedDiscussionIds] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const forceScrollToBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skillZipInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerToolsRef = useRef<HTMLDivElement>(null);

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
  const mentionAgents = useMemo(() => {
    const seen = new Set<string>();
    return [coordinatorAgent as Agent, ...memberAgents].filter((agent) => {
      if (seen.has(agent.id)) return false;
      seen.add(agent.id);
      return true;
    });
  }, [coordinatorAgent, memberAgents]);
  const duplicateMentionNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of mentionAgents) {
      const key = agent.name.toLocaleLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [mentionAgents]);
  const mentionCandidates = useMemo(() => {
    const query = mentionQuery.trim().toLocaleLowerCase();
    if (!query) return mentionAgents;
    return mentionAgents.filter((agent) =>
      [agent.name, agent.category, agent.description].some((value) => value?.toLocaleLowerCase().includes(query))
    );
  }, [mentionAgents, mentionQuery]);
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) || null;
  const latestRun = runs[0] || null;
  const activeRun = runs.find((run) => ACTIVE_RUN_STATUSES.has(run.status)) || null;
  const latestDiscussion = discussions[0] || null;
  const activeDiscussion = discussions.find((discussion) => ['QUEUED', 'RUNNING', 'WAITING_RESEARCH', 'CANCEL_REQUESTED'].includes(discussion.status)) || null;
  const visibleDiscussion = latestDiscussion
    && (activeDiscussion?.id === latestDiscussion.id || !dismissedDiscussionIds.includes(latestDiscussion.id))
    ? latestDiscussion
    : null;
  const currentRun = (selectedRunId ? runs.find((run) => run.id === selectedRunId) : null) || activeRun || runs[0] || null;
  const runModelMetrics = useMemo(
    () => aggregateModelRequests(currentRun?.events || []),
    [currentRun]
  );
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
  const activeTask = currentRun?.tasks.find((task) => ['PROPOSED', 'RUNNING', 'SUBMITTED', 'REVIEWING', 'WAITING', 'WAITING_USER', 'WAITING_APPROVAL', 'CANCEL_REQUESTED'].includes(task.status)) || null;
  const proposedTask = currentRun?.tasks.find((task) => task.status === 'PROPOSED') || null;
  const waitingTask = currentRun?.tasks.find((task) => task.status === 'WAITING') || null;
  const waitingForExecutionContinuation = Boolean(waitingTask && isExecutionBudgetWait(waitingTask.waitReason));
  const waitingForRunContinuation = Boolean(
    currentRun?.status === 'WAITING' && !waitingTask && isRunBudgetWait(currentRun.error)
  );
  const reviewTask = currentRun?.tasks.find((task) => task.status === 'WAITING_APPROVAL') || null;
  const reviewAudit = reviewTask
    ? [...(currentRun?.events || [])].reverse().map((event) => ({ event, payload: eventPayload(event) }))
      .find(({ event, payload }) => event.type === 'RESEARCH_RESULT_AUDITED' && payload.taskId === reviewTask.id)?.payload.audit || null
    : null;
  const proposedTaskReason = proposedTask
    ? [...(currentRun?.events || [])].reverse().map((event) => ({ event, payload: eventPayload(event) }))
      .find(({ event, payload }) => event.type === 'COORDINATOR_TASK_PROPOSED' && payload.taskId === proposedTask.id)?.payload.reason || ''
    : '';
  const discussionSequenceIds = activeDiscussion
    ? activeDiscussion.currentRound === 2
      ? [...activeDiscussion.participantIds].reverse()
      : activeDiscussion.participantIds
    : [];
  const currentDiscussionAgentId = activeDiscussion && activeDiscussion.currentRound <= activeDiscussion.maxRounds
    ? discussionSequenceIds[activeDiscussion.currentIndex]
    : null;
  const memberStatus = (agentId: string) => {
    const agentTasks = activeRun?.tasks.filter((item) => item.agentId === agentId) || [];
    const task = agentTasks.find((item) => item.status === 'CANCEL_REQUESTED')
      || agentTasks.find((item) => item.status === 'RUNNING')
      || agentTasks.find((item) => item.status === 'REVIEWING')
      || agentTasks.find((item) => item.status === 'SUBMITTED')
      || agentTasks.find((item) => item.status === 'WAITING')
      || agentTasks.find((item) => item.status === 'WAITING_APPROVAL')
      || agentTasks.find((item) => item.status === 'PROPOSED')
      || agentTasks.find((item) => item.status === 'PENDING')
      || null;
    if (task?.status === 'CANCEL_REQUESTED') return { label: '正在停止', color: 'bg-rose-400', text: 'text-rose-500', task };
    if (task?.status === 'RUNNING') return { label: '工作中', color: 'bg-emerald-500', text: 'text-emerald-600', task };
    if (['SUBMITTED', 'REVIEWING'].includes(task?.status || '')) return { label: '验收中', color: 'bg-sky-400', text: 'text-sky-600', task };
    if (task?.status === 'WAITING') return { label: '等待补充', color: 'bg-amber-400', text: 'text-amber-600', task };
    if (task?.status === 'WAITING_APPROVAL') return { label: '待审核', color: 'bg-sky-400', text: 'text-sky-600', task };
    if (task?.status === 'PROPOSED') return { label: '待确认', color: 'bg-amber-400', text: 'text-amber-600', task };
    if (task?.status === 'PENDING') return { label: '等待中', color: 'bg-amber-400', text: 'text-amber-600', task };
    if (activeDiscussion?.participantIds.includes(agentId)) {
      if (agentId === currentDiscussionAgentId && activeDiscussion.status === 'CANCEL_REQUESTED') {
        return { label: '正在停止', color: 'bg-rose-400', text: 'text-rose-500', task: null };
      }
      if (agentId === currentDiscussionAgentId && activeDiscussion.status === 'WAITING_RESEARCH') {
        return { label: '等待联网', color: 'bg-sky-400', text: 'text-sky-600', task: null };
      }
      if (agentId === currentDiscussionAgentId && activeDiscussion.status === 'RUNNING') {
        return { label: '讨论中', color: 'bg-emerald-500', text: 'text-emerald-600', task: null };
      }
      return { label: '等待讨论', color: 'bg-amber-400', text: 'text-amber-600', task: null };
    }
    if (isStreaming && streamingSpeakerId === agentId) {
      return { label: '回答中', color: 'bg-emerald-500', text: 'text-emerald-600', task: null };
    }
    if (replyQueueAgentIds.slice(replyQueueIndex + 1).includes(agentId)) {
      return { label: '等待回答', color: 'bg-amber-400', text: 'text-amber-600', task: null };
    }
    return { label: '空闲', color: 'bg-slate-300', text: 'text-slate-400', task: null };
  };
  const coordinatorStatus = activeRun && (['PLANNING', 'SUMMARIZING'].includes(activeRun.status) || ['SUBMITTED', 'REVIEWING'].includes(activeTask?.status || ''))
    ? { label: '协调中', color: 'bg-emerald-500', text: 'text-emerald-600' }
    : activeDiscussion && activeDiscussion.currentRound > activeDiscussion.maxRounds
      ? { label: '汇总中', color: 'bg-emerald-500', text: 'text-emerald-600' }
      : isStreaming && streamingSpeakerId === coordinatorAgent.id
        ? { label: '回答中', color: 'bg-emerald-500', text: 'text-emerald-600' }
        : { label: '在线', color: 'bg-slate-300', text: 'text-slate-400' };
  const latestResearchEvent = currentRun
    ? [...currentRun.events].reverse().find((event) => event.type.startsWith('WEB_SEARCH_')) || null
    : null;
  const acceptanceEvent = currentRun
    ? [...currentRun.events].reverse().find((event) => event.type === 'RUN_ACCEPTANCE_COMPLETED') || null
    : null;
  const acceptanceAudit = acceptanceEvent ? eventPayload(acceptanceEvent) : null;
  const runArtifacts = useMemo(
    () => currentRun ? files.filter((file) => file.runId === currentRun.id) : [],
    [currentRun, files]
  );
  const reviewFiles = useMemo(
    () => reviewTask ? files.filter((file) => file.taskId === reviewTask.id) : [],
    [files, reviewTask]
  );
  const workById = useMemo(() => new Map(works.map((work) => [work.id, work])), [works]);
  const visibleFiles = useMemo(() => {
    if (selectedWorkId === 'all') return files;
    if (selectedWorkId === 'legacy') return files.filter((file) => !file.workId);
    return files.filter((file) => file.workId === selectedWorkId);
  }, [files, selectedWorkId]);
  const hasPendingTaskProposal = useMemo(
    () => messages.some((message) => taskProposalOf(message)?.status === 'pending'),
    [messages]
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
      const [spaceResult, messageResult, fileResult, runResult, workResult, discussionResult, skillResult, learningResult, builtIn, customResult] = await Promise.all([
        spacesApi.get(spaceId),
        spacesApi.messages(spaceId, { limit: 60 }),
        spacesApi.files(spaceId),
        spacesApi.runs(spaceId),
        spacesApi.works(spaceId),
        spacesApi.discussions(spaceId),
        spacesApi.skills(spaceId),
        spacesApi.learning(spaceId),
        getBuiltInAgents(),
        agentsApi.mine().catch(() => ({ agents: [] })),
      ]);
      setAgents([...customResult.agents, ...builtIn]);
      setSpace(spaceResult.space);
      setInstructionsDraft(spaceResult.space.instructions || '');
      setExecutionModeDraft(spaceResult.space.executionMode === 'AUTO' ? 'AUTO' : 'REVIEW_DISPATCH');
      forceScrollToBottomRef.current = true;
      setMessages(messageResult.messages);
      const pendingWorkId = messageResult.messages
        .map((message) => taskProposalOf(message))
        .find((proposal) => proposal?.status === 'pending')?.workId;
      setActiveWorkId(pendingWorkId || 'new');
      setFiles(fileResult.files);
      setRuns(runResult.runs);
      setWorks(workResult.works);
      setDiscussions(discussionResult.discussions);
      setSkills(skillResult.skills);
      setLearning(learningResult.learning);
      setLearningReadme(learningResult.readme);
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
    try {
      const stored = JSON.parse(localStorage.getItem(`space:${spaceId}:dismissed-discussions`) || '[]');
      setDismissedDiscussionIds(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
    } catch {
      setDismissedDiscussionIds([]);
    }
  }, [spaceId]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const shouldJump = forceScrollToBottomRef.current;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: shouldJump || isStreaming ? 'auto' : 'smooth',
    });
    forceScrollToBottomRef.current = false;
  }, [messages, streamingContent, isStreaming]);

  const openTaskRun = (runId: string, followRetries = false) => {
    const target = followRetries ? latestRunInRetryChain(runs, runId) : null;
    setSelectedRunId(target?.id || runId);
    setMode('task');
  };

  const returnToChat = () => {
    setMode('chat');
  };

  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(async () => {
      try {
        const result = await agentRunsApi.get(activeRun.id, activeRun.eventSequence || 0);
        const fileResult = result.run.events.some(eventChangesWorkspaceFiles)
          ? await spacesApi.files(spaceId)
          : null;
        setRuns((items) => items.map((item) => {
          if (item.id !== result.run.id) return item;
          const events = new Map(item.events.map((event) => [event.id, event]));
          for (const event of result.run.events) events.set(event.id, event);
          return { ...result.run, events: [...events.values()].sort((a, b) => a.sequence - b.sequence) };
        }));
        if (fileResult) setFiles(fileResult.files);
      } catch {
        // Keep the last persisted state visible; the next poll can recover from a transient failure.
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeRun?.id, activeRun?.status, activeRun?.eventSequence, spaceId]);

  useEffect(() => {
    if (!latestRun || ACTIVE_RUN_STATUSES.has(latestRun.status)) return;
    const refreshCompletion = () => Promise.all([
      spacesApi.files(spaceId),
      spacesApi.messages(spaceId, { limit: 60 }),
      spacesApi.learning(spaceId),
    ]).then(([fileResult, messageResult, learningResult]) => {
      setFiles(fileResult.files);
      setMessages(messageResult.messages);
      setLearning(learningResult.learning);
      setLearningReadme(learningResult.readme);
    }).catch(() => {});
    refreshCompletion();
    const timer = window.setTimeout(refreshCompletion, 1_000);
    return () => window.clearTimeout(timer);
  }, [latestRun?.id, latestRun?.status, spaceId]);

  useEffect(() => {
    if (!activeDiscussion) return;
    const timer = window.setInterval(async () => {
      try {
        const [discussionResult, messageResult] = await Promise.all([
          spacesApi.discussions(spaceId),
          spacesApi.messages(spaceId, { limit: 60 }),
        ]);
        setDiscussions(discussionResult.discussions);
        setMessages(messageResult.messages);
      } catch {
        // Keep the latest persisted discussion state; the next poll can recover.
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [activeDiscussion?.id, activeDiscussion?.status, activeDiscussion?.updatedAt, spaceId]);

  useEffect(() => {
    if (sidePanel) {
      setMentionMenuOpen(false);
      setMentionRange(null);
      setComposerToolsOpen(false);
    }
  }, [sidePanel]);

  useEffect(() => {
    const closeComposerTools = (event: PointerEvent) => {
      if (!composerToolsRef.current?.contains(event.target as Node)) setComposerToolsOpen(false);
    };
    document.addEventListener('pointerdown', closeComposerTools);
    return () => document.removeEventListener('pointerdown', closeComposerTools);
  }, []);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionQuery]);

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

  const isMentionAlreadySelected = (agent: Agent) => {
    const source = mentionRange
      ? `${input.slice(0, mentionRange.start)}${input.slice(mentionRange.end)}`
      : input;
    return mentionedAgents(source, [agent]).length > 0;
  };

  const insertMention = (agent: Agent) => {
    let caret = 0;
    setInput((current) => {
      if (mentionRange) {
        const suffix = current.slice(mentionRange.end);
        const separator = suffix.startsWith(' ') ? '' : ' ';
        const replacement = `@${agent.name}${separator}`;
        caret = mentionRange.start + replacement.length;
        return `${current.slice(0, mentionRange.start)}${replacement}${suffix}`;
      }
      const prefix = current.trim() ? `${current.trimEnd()} ` : '';
      const next = `${prefix}@${agent.name} `;
      caret = next.length;
      return next;
    });
    setMentionMenuOpen(false);
    setMentionRange(null);
    setMentionQuery('');
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  const syncMentionFromCaret = (value: string, caret: number) => {
    const token = activeMentionToken(value, caret);
    if (!token) {
      if (mentionRange) {
        setMentionRange(null);
        setMentionMenuOpen(false);
      }
      return;
    }
    setMentionRange({ start: token.start, end: token.end });
    setMentionQuery(token.query);
    setComposerToolsOpen(false);
    setMentionMenuOpen(true);
  };

  const sendMessage = async (
    content: string,
    options?: { reuseLastUserMessage?: boolean; historyOverride?: SpaceMessage[]; skillIdOverride?: string | null }
  ) => {
    if (!content || isStreaming) return;

    if (!options?.reuseLastUserMessage && latestDiscussion && !activeDiscussion) {
      dismissDiscussion(latestDiscussion.id);
    }

    const activeSkillId = options?.skillIdOverride === undefined ? selectedSkillId : options.skillIdOverride;
    const activeSkill = skills.find((skill) => skill.id === activeSkillId) || null;
    const userMessage: SpaceMessage = {
      id: `user-${Date.now()}`,
      spaceId,
      role: 'user',
      content,
      ...(activeSkill ? { attachments: [{
        type: 'skill_invocation' as const,
        skillId: activeSkill.id,
        name: activeSkill.name,
        version: activeSkill.version,
        digest: activeSkill.digest,
      }] } : {}),
      createdAt: new Date().toISOString(),
    };
    const history = options?.historyOverride || messages;
    const nextMessages = options?.reuseLastUserMessage ? history : [...history, userMessage];
    setMessages(nextMessages);
    if (!options?.reuseLastUserMessage) setInput('');
    if (!options?.reuseLastUserMessage) setSelectedSkillId(null);
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingSpeakerId(null);
    setReplyQueueAgentIds([]);
    setReplyQueueIndex(0);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const targets = mentionedAgents(content, memberAgents);
      const replyTargets: Array<Agent | null> = targets.length > 1 ? targets : [null];
      setReplyQueueAgentIds(targets.length > 1 ? targets.map((agent) => agent.id) : []);
      let workspaceFilesChanged = 0;

      for (let index = 0; index < replyTargets.length; index += 1) {
        setReplyQueueIndex(index);
        setStreamingContent('');
        setStreamingSpeakerId(replyTargets[index]?.id || null);
        const result = await streamSpaceMessage({
          spaceId,
          message: content,
          history: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
            speakerAgentId: message.speakerAgentId,
          })),
          targetAgentId: replyTargets[index]?.id,
          interactionMode: targets.length > 1 ? 'multi_reply' : 'chat',
          webSearchEnabled: targets.length <= 1 && webSearchEnabled,
          skipPersistUserMessage: Boolean(options?.reuseLastUserMessage || index > 0),
          skillId: activeSkillId || undefined,
          workId: activeWorkId === 'new' ? undefined : activeWorkId,
          signal: controller.signal,
        });
        setStreamingSpeakerId(result.speakerAgentId || replyTargets[index]?.id || null);
        workspaceFilesChanged += result.workspaceFilesChanged;

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

        if (index < replyTargets.length - 1) {
          const messageResult = await spacesApi.messages(spaceId, { limit: 60 });
          setMessages(messageResult.messages);
        }
      }

      const [messageResult, fileResult] = await Promise.all([
        spacesApi.messages(spaceId, { limit: 60 }),
        workspaceFilesChanged > 0 ? spacesApi.files(spaceId) : Promise.resolve(null),
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
      setReplyQueueAgentIds([]);
      setReplyQueueIndex(0);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamingContent('');
    setReplyQueueAgentIds([]);
    setReplyQueueIndex(0);
  };

  const openDiscussionDialog = () => {
    setDiscussionTopic(input.trim());
    setDiscussionParticipantIds(memberAgents.slice(0, 3).map((agent) => agent.id));
    setDiscussionAllowWeb(false);
    setDiscussionError('');
    setDiscussionDialogOpen(true);
  };

  const startDiscussion = async () => {
    if (discussionBusy || !discussionTopic.trim() || discussionParticipantIds.length < 2) return;
    setDiscussionBusy(true);
    setDiscussionError('');
    try {
      const result = await spacesApi.createDiscussion(spaceId, {
        topic: discussionTopic.trim(),
        participantIds: discussionParticipantIds,
        allowWeb: discussionAllowWeb,
      });
      const messageResult = await spacesApi.messages(spaceId, { limit: 60 });
      setDiscussions((items) => [result.discussion, ...items]);
      setMessages(messageResult.messages);
      setInput('');
      setDiscussionDialogOpen(false);
    } catch (err: any) {
      setDiscussionError(err.message || '发起讨论失败');
    } finally {
      setDiscussionBusy(false);
    }
  };

  const updateDiscussion = async (
    action: 'cancel' | 'approve_research' | 'reject_research',
    scope?: 'once' | 'discussion'
  ) => {
    if (!latestDiscussion || discussionBusy) return;
    setDiscussionBusy(true);
    setError('');
    try {
      const result = await spacesApi.updateDiscussion(spaceId, latestDiscussion.id, { action, scope });
      setDiscussions((items) => items.map((item) => item.id === result.discussion.id ? result.discussion : item));
    } catch (err: any) {
      setError(err.message || '处理讨论失败');
    } finally {
      setDiscussionBusy(false);
    }
  };

  const dismissDiscussion = (discussionId: string) => {
    if (dismissedDiscussionIds.includes(discussionId)) return;
    const next = [...dismissedDiscussionIds, discussionId].slice(-20);
    setDismissedDiscussionIds(next);
    localStorage.setItem(`space:${spaceId}:dismissed-discussions`, JSON.stringify(next));
  };

  const convertDiscussionToTask = () => {
    if (!latestDiscussion?.result || isStreaming) return;
    const prompt = `请根据刚才关于“${latestDiscussion.topic}”的讨论结论，生成一份可确认的任务方案。`;
    sendMessage(prompt);
  };

  const saveInstructions = async () => {
    if (savingInstructions) return;
    setSavingInstructions(true);
    setError('');
    try {
      const result = await spacesApi.update(spaceId, {
        instructions: instructionsDraft.trim() || null,
        executionMode: executionModeDraft,
      });
      setSpace((current: any) => ({ ...current, ...result.space }));
      setInstructionsDraft(result.space.instructions || '');
      setExecutionModeDraft(result.space.executionMode === 'AUTO' ? 'AUTO' : 'REVIEW_DISPATCH');
    } catch (err: any) {
      setError(err.message || '保存空间规则失败');
    } finally {
      setSavingInstructions(false);
    }
  };

  const updateLearningDraft = (collection: 'proposals' | 'rules', id: string, field: 'title' | 'instruction', value: string) => {
    setLearning((current) => current ? {
      ...current,
      [collection]: current[collection].map((item) => item.id === id ? { ...item, [field]: value } : item),
    } : current);
  };

  const applyLearningAction = async (
    item: SpaceLearningItem,
    action: 'approve' | 'ignore' | 'update_rule' | 'disable_rule' | 'enable_rule'
  ) => {
    if (learningActionId) return;
    setLearningActionId(item.id);
    setError('');
    try {
      const result = await spacesApi.updateLearning(spaceId, {
        action,
        id: item.id,
        category: item.category,
        title: item.title,
        instruction: item.instruction,
      });
      setLearning(result.learning);
      setLearningReadme(result.readme);
    } catch (err: any) {
      setError(err.message || '更新空间成长规则失败');
    } finally {
      setLearningActionId('');
    }
  };

  const clearSpaceContents = async () => {
    if (clearingSpace || isStreaming || activeRun || activeDiscussion) return;
    setClearingSpace(true);
    setError('');
    try {
      await spacesApi.clearContents(spaceId);
      setMessages([]);
      setFiles([]);
      setRuns([]);
      setWorks([]);
      setSelectedWorkId('all');
      setActiveWorkId('new');
      setDiscussions([]);
      setLearning(null);
      setLearningReadme('');
      setSelectedRunId(null);
      setMode('chat');
      setInput('');
      setDismissedDiscussionIds([]);
      localStorage.removeItem(`space:${spaceId}:dismissed-discussions`);
      setClearSpaceOpen(false);
    } catch (err: any) {
      setError(err.message || '清空空间失败');
    } finally {
      setClearingSpace(false);
    }
  };

  const previewSkill = async (sourceUrl: string) => {
    if (skillBusy || !sourceUrl.trim()) return;
    setSkillBusy(true);
    setError('');
    try {
      const result = await spacesApi.previewSkill(spaceId, sourceUrl.trim());
      setSkillPreview(result.preview);
      setSkillUploadFile(null);
      if (skillZipInputRef.current) skillZipInputRef.current.value = '';
    } catch (err: any) {
      setError(err.message || '分析 Skill 失败');
    } finally {
      setSkillBusy(false);
    }
  };

  const previewUploadedSkill = async (file: File) => {
    if (skillBusy) return;
    setSkillBusy(true);
    setError('');
    try {
      const result = await spacesApi.previewUploadedSkill(spaceId, file);
      setSkillPreview(result.preview);
      setSkillUploadFile(file);
    } catch (err: any) {
      setError(err.message || '分析 Skill ZIP 失败');
      setSkillUploadFile(null);
    } finally {
      setSkillBusy(false);
    }
  };

  const installSkill = async () => {
    if (!skillPreview || skillBusy) return;
    setSkillBusy(true);
    setError('');
    try {
      const result = skillUploadFile
        ? await spacesApi.installUploadedSkill(spaceId, skillUploadFile, skillPreview.digest)
        : await spacesApi.installSkill(spaceId, skillPreview.sourceUrl, skillPreview.digest);
      setSkills((items) => [...items.filter((item) => item.id !== result.skill.id), result.skill]);
      setSkillPreview(null);
      setSkillSourceUrl('');
      setSkillUploadFile(null);
      if (skillZipInputRef.current) skillZipInputRef.current.value = '';
    } catch (err: any) {
      setError(err.message || '安装 Skill 失败');
    } finally {
      setSkillBusy(false);
    }
  };

  const removeSkill = async () => {
    if (!pendingRemoveSkill || skillBusy) return;
    setSkillBusy(true);
    setError('');
    try {
      await spacesApi.removeSkill(spaceId, pendingRemoveSkill.id);
      setSkills((items) => items.filter((item) => item.id !== pendingRemoveSkill.id));
      if (selectedSkillId === pendingRemoveSkill.id) setSelectedSkillId(null);
      setPendingRemoveSkill(null);
    } catch (err: any) {
      setError(err.message || '删除 Skill 失败');
    } finally {
      setSkillBusy(false);
    }
  };

  const saveSkillExecution = async () => {
    if (!pendingExecutionSkill || skillBusy) return;
    setSkillBusy(true);
    setError('');
    try {
      const result = await spacesApi.updateSkillExecution(spaceId, pendingExecutionSkill.id, approvedScriptDraft);
      setSkills((items) => items.map((item) => item.id === result.skill.id ? result.skill : item));
      setPendingExecutionSkill(null);
      setApprovedScriptDraft([]);
    } catch (err: any) {
      setError(err.message || '保存脚本执行权限失败');
    } finally {
      setSkillBusy(false);
    }
  };

  const send = () => {
    setMentionMenuOpen(false);
    const content = input.trim();
    const addSkill = /^\/skill\s+add\s+(\S+)\s*$/i.exec(content);
    if (addSkill) {
      setInput('');
      return previewSkill(addSkill[1]);
    }
    return sendMessage(content);
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
      const invocation = lastUserMessage.attachments?.find((attachment) => attachment.type === 'skill_invocation');
      await sendMessage(lastUserMessage.content, {
        reuseLastUserMessage: true,
        historyOverride: nextMessages,
        skillIdOverride: invocation?.type === 'skill_invocation' ? invocation.skillId : null,
      });
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
      const result = await spacesApi.createRun(
        spaceId,
        revision?.goal || proposal.goal,
        message.id,
        revision,
        activeWorkId === 'new' ? undefined : activeWorkId
      );
      setRuns((items) => [result.run, ...items]);
      if (result.run.work) {
        setWorks((items) => items.some((work) => work.id === result.run.work!.id)
          ? items
          : [{ ...result.run.work!, _count: { files: 0, runs: 1 } }, ...items]);
        setSelectedWorkId(result.run.work.id);
        setActiveWorkId(result.run.work.id);
      }
      setSelectedRunId(result.run.id);
      setMessages((items) => items.map((item) => item.id === message.id ? {
        ...item,
        attachments: item.attachments?.map((attachment) => {
          if (attachment.type !== 'task_proposal') return attachment;
          const updated = result.proposal || (revision ? { ...attachment, ...revision } : attachment);
          return {
            ...updated,
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

  const retryFailedTask = async (task: AgentTask) => {
    if (!currentRun || isRunActive || retryingTaskId) return;
    setRetryingTaskId(task.id);
    setError('');
    try {
      const result = await agentRunsApi.retryTask(currentRun.id, task.id);
      setRuns((items) => [result.run, ...items]);
      setSelectedRunId(result.run.id);
    } catch (err: any) {
      setError(err.message || '从失败步骤继续失败');
    } finally {
      setRetryingTaskId(null);
    }
  };

  const resumeRun = async () => {
    if (!currentRun || (!waitingTask && !waitingForRunContinuation) || resumeLoading) return;
    const answer = resumeAnswer.trim();
    const continuingBudget = waitingForExecutionContinuation || waitingForRunContinuation;
    if (!continuingBudget && !answer) return setResumeError('请填写补充信息');
    if (continuingBudget && (!Number.isInteger(continuationIterations) || continuationIterations < 1 || continuationIterations > MAX_CONTINUATION_ITERATIONS)) {
      return setResumeError(`请输入 1 到 ${MAX_CONTINUATION_ITERATIONS} 之间的整数`);
    }
    setResumeLoading(true);
    setResumeError('');
    try {
      const result = await agentRunsApi.resume(
        currentRun.id,
        answer,
        continuingBudget ? continuationIterations : undefined
      );
      setRuns((items) => items.map((item) => (item.id === result.run.id ? result.run : item)));
      setResumeAnswer('');
    } catch (err: any) {
      setResumeError(err.message || '提交补充信息失败');
    } finally {
      setResumeLoading(false);
    }
  };

  const reviewCurrentTask = async (action: 'approve' | 'retry' | 'skip', feedback?: string, task = reviewTask) => {
    if (!task || reviewAction) return;
    setReviewAction(action);
    setReviewError('');
    try {
      const result = await agentRunsApi.reviewTask(task.runId, task.id, action, feedback);
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

  const reviewDispatch = async (
    action: 'approve' | 'reject',
    task = proposedTask,
    revision?: TaskDispatchRevision,
    feedback?: string
  ) => {
    if (!task || dispatchAction) return;
    setDispatchAction(action);
    setDispatchError('');
    try {
      const result = await agentRunsApi.reviewDispatch(task.runId, task.id, action, revision, feedback);
      setRuns((items) => items.map((item) => (item.id === result.run.id ? result.run : item)));
      setEditingDispatchTask(null);
      setPendingRejectDispatch(null);
    } catch (err: any) {
      const message = err.message || '处理派发提案失败';
      setError(message);
      setDispatchError(message);
    } finally {
      setDispatchAction(null);
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
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-black text-slate-500">
                    <BookOpen size={15} />
                    Space Skills
                    <span className="text-slate-300">{skills.length}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSidePanel('skills')}
                    className="text-xs font-black text-slate-400 transition hover:text-slate-950"
                  >
                    管理
                  </button>
                </div>
                <p className="text-xs font-semibold leading-5 text-slate-400">
                  {skills.length > 0 ? skills.slice(0, 3).map((skill) => skill.name).join('、') : '当前空间还没有安装 Skill。'}
                </p>
              </section>

              <section className="border-b border-black/[0.06] px-6 py-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-black text-slate-500">
                    <FileText size={15} />
                    资料与成果
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
                      setExecutionModeDraft(space.executionMode === 'AUTO' ? 'AUTO' : 'REVIEW_DISPATCH');
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

          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
                  setExecutionModeDraft(space.executionMode === 'AUTO' ? 'AUTO' : 'REVIEW_DISPATCH');
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
                  <>
                    <button
                      type="button"
                      aria-label="关闭任务详情"
                      onClick={returnToChat}
                      className="fixed inset-0 z-40 bg-slate-950/15"
                    />
                    <aside className="fixed inset-0 z-50 flex flex-col bg-[#fbfaf7] shadow-[-16px_0_40px_-24px_rgba(15,23,42,0.35)] sm:left-auto sm:w-[min(560px,100vw)]">
                      <div className="flex h-[65px] shrink-0 items-center justify-between border-b border-black/[0.06] bg-white px-4 sm:px-5">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-black text-slate-800">
                          <ListTodo size={17} />
                          <span className="truncate">任务详情</span>
                        </div>
                        <button
                          type="button"
                          onClick={returnToChat}
                          title="关闭"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-950"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
                  {currentRun ? (
                    <div className="space-y-6">
                      <section className="border-b border-black/[0.08] pb-5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-black text-slate-400">任务目标</div>
                          <button
                            type="button"
                            onClick={() => {
                              returnToChat();
                              setSidePanel('runs');
                            }}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-black text-slate-500 transition hover:bg-white hover:text-slate-950"
                          >
                            <History size={14} />
                            历史任务
                            <span className="text-slate-300">{runs.length}</span>
                          </button>
                        </div>
                        <h2 className="mt-2 line-clamp-3 text-lg font-black leading-7 text-slate-950">{currentRun.input}</h2>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-bold text-slate-400">
                          <span className={['FAILED', 'FAILED_VALIDATION'].includes(currentRun.status) ? 'text-rose-500' : currentRun.status === 'COMPLETED' ? 'text-emerald-600' : ['PARTIAL', 'BLOCKED'].includes(currentRun.status) ? 'text-amber-600' : 'text-slate-700'}>
                            {RUN_STATUS_LABELS[currentRun.status] || currentRun.status}
                          </span>
                          <span>{formatRunDate(currentRun.createdAt)}</span>
                          {currentRun.attempt > 1 && <span>第 {currentRun.attempt} 次执行</span>}
                          <span>模型调用 {currentRun.modelRequestCount || 0}/{currentRun.modelRequestLimit || 12}</span>
                          {runModelMetrics.requests > 0 && <span>模型耗时 {formatDuration(runModelMetrics.durationMs)}</span>}
                          {runModelMetrics.retries > 0 && <span className="text-amber-600">重试 {runModelMetrics.retries} 次</span>}
                          {runModelMetrics.providerUsageCount + runModelMetrics.estimatedUsageCount > 0
                            ? <span>{runModelMetrics.estimatedUsageCount > 0 ? '估算 Token' : runModelMetrics.providerUsageCount === runModelMetrics.requests ? 'Token' : '已上报 Token'} 输入 {formatMetricCount(runModelMetrics.inputTokens)} / 输出 {formatMetricCount(runModelMetrics.outputTokens)} / 合计 {formatMetricCount(runModelMetrics.providerTokens)}</span>
                            : runModelMetrics.requestChars > 0
                              ? <span>输入 {formatMetricCount(runModelMetrics.requestChars)} 字符{runModelMetrics.outputChars > 0 ? ` / 输出 ${formatMetricCount(runModelMetrics.outputChars)} 字符` : ''}</span>
                              : null}
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
                              重新执行整个任务
                            </button>
                          )}
                        </div>
                      </section>

                      {currentRun.id === activeRun?.id && !['WAITING', 'WAITING_APPROVAL'].includes(currentRun.status) && (
                        <section className="rounded-lg border border-black/[0.06] bg-white px-4 py-4 sm:px-5">
                          <div className="flex items-start gap-3">
                            <Loader2 className="mt-0.5 shrink-0 animate-spin text-slate-500" size={17} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-black text-slate-900">
                                  {activeTask?.status === 'REVIEWING' || activeTask?.status === 'SUBMITTED'
                                    ? `协调者正在验收：${activeTask.title}`
                                    : activeTask?.title || (currentRun.status === 'QUEUED' ? '等待 Worker 接收任务' : currentRun.status === 'SUMMARIZING' ? '协调者正在整理最终结果' : '协调者正在安排下一项工作')}
                                </div>
                                <span className="text-xs font-black text-slate-400">
                                  已验收 {completedTaskCount} 项
                                </span>
                              </div>
                              {activeTask && <div className="mt-1 text-xs font-semibold text-slate-400">{activeTask.agentName}</div>}
                              <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                {currentRun.events.at(-1)?.message || '任务已进入执行队列'}
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

                      {currentRun.status === 'WAITING' && waitingTask && (
                        <section className="border-y border-black/[0.08] py-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-black text-amber-600">第 {waitingTask.sortOrder + 1} 步{waitingForExecutionContinuation ? '等待继续' : '等待补充'}</div>
                              <h3 className="mt-1 text-base font-black text-slate-950">{waitingTask.title}</h3>
                              <div className="mt-1 text-xs font-semibold text-slate-400">{waitingTask.agentName} · Worker 已暂停并释放</div>
                            </div>
                            <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">{waitingForExecutionContinuation ? '等待你的确认' : '等待你的回答'}</span>
                          </div>
                          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3">
                            <div className="text-sm font-black text-amber-900">{waitingTask.waitQuestion}</div>
                            {waitingTask.waitReason && <div className="mt-1 text-xs font-semibold leading-5 text-amber-700">{waitingForExecutionContinuation ? '完整执行上下文、工具结果和暂存文件都会保留。继续后将从下一轮直接处理，并产生新的模型调用费用。' : waitingTask.waitReason}</div>}
                          </div>
                          {!waitingForExecutionContinuation && (
                            <>
                              <label htmlFor="task-wait-answer" className="mt-4 block text-xs font-black text-slate-600">补充信息</label>
                              <textarea
                                id="task-wait-answer"
                                value={resumeAnswer}
                                onChange={(event) => { setResumeAnswer(event.target.value); setResumeError(''); }}
                                rows={4}
                                maxLength={4_000}
                                placeholder="回答这个问题后，原步骤会从当前任务链继续执行"
                                className="mt-2 w-full resize-y rounded-lg border border-black/[0.1] bg-white px-3 py-3 text-sm font-semibold leading-6 text-slate-800 outline-none transition focus:border-slate-400"
                              />
                            </>
                          )}
                          {waitingForExecutionContinuation && (
                            <div className="mt-4 flex flex-wrap items-end gap-3">
                              <div>
                                <label htmlFor="task-continuation-iterations" className="block text-xs font-black text-slate-600">追加有效执行轮次</label>
                                <input
                                  id="task-continuation-iterations"
                                  type="number"
                                  min={1}
                                  max={MAX_CONTINUATION_ITERATIONS}
                                  step={1}
                                  value={continuationIterations}
                                  onChange={(event) => { setContinuationIterations(Number(event.target.value)); setResumeError(''); }}
                                  className="mt-2 h-10 w-28 rounded-lg border border-black/[0.1] bg-white px-3 text-sm font-black text-slate-800 outline-none transition focus:border-slate-400"
                                />
                              </div>
                              <div className="pb-2 text-xs font-semibold text-slate-400">范围 1–{MAX_CONTINUATION_ITERATIONS}，最多预留 {continuationIterations + 2} 次模型请求</div>
                            </div>
                          )}
                          {resumeError && <div className="mt-2 text-xs font-semibold text-rose-600">{resumeError}</div>}
                          <button type="button" onClick={resumeRun} disabled={resumeLoading || (!waitingForExecutionContinuation && !resumeAnswer.trim())} className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">
                            {resumeLoading ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                            {waitingForExecutionContinuation ? `继续执行（增加 ${continuationIterations} 轮）` : '提交并继续'}
                          </button>
                        </section>
                      )}

                      {currentRun.status === 'WAITING' && waitingForRunContinuation && (
                        <section className="border-y border-black/[0.08] py-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-black text-amber-600">整个任务等待继续</div>
                              <h3 className="mt-1 text-base font-black text-slate-950">外层模型调用预算已用完</h3>
                              <div className="mt-1 text-xs font-semibold text-slate-400">Coordinator 状态、已完成步骤和工作区成果均已保留</div>
                            </div>
                            <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">等待你的确认</span>
                          </div>
                          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-amber-50 px-4 py-3">
                            <div>
                              <label htmlFor="run-continuation-iterations" className="block text-xs font-black text-amber-900">追加任务模型调用次数</label>
                              <input
                                id="run-continuation-iterations"
                                type="number"
                                min={1}
                                max={MAX_CONTINUATION_ITERATIONS}
                                step={1}
                                value={continuationIterations}
                                onChange={(event) => { setContinuationIterations(Number(event.target.value)); setResumeError(''); }}
                                className="mt-2 h-10 w-28 rounded-lg border border-amber-200 bg-white px-3 text-sm font-black text-slate-800 outline-none transition focus:border-amber-400"
                              />
                            </div>
                            <div className="pb-2 text-xs font-semibold text-amber-700">范围 1–{MAX_CONTINUATION_ITERATIONS}，从当前阶段继续</div>
                          </div>
                          {resumeError && <div className="mt-2 text-xs font-semibold text-rose-600">{resumeError}</div>}
                          <button type="button" onClick={resumeRun} disabled={resumeLoading} className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">
                            {resumeLoading ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                            继续任务（增加 {continuationIterations} 次）
                          </button>
                        </section>
                      )}

                      {currentRun.status === 'WAITING_APPROVAL' && proposedTask && (
                        <section className="border-y border-black/[0.08] py-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-black text-amber-600">Coordinator 派发提案</div>
                              <h3 className="mt-1 text-base font-black text-slate-950">{proposedTask.title}</h3>
                            </div>
                            <span className="rounded bg-amber-50 px-2 py-1 text-xs font-black text-amber-700">开工前待确认</span>
                          </div>

                          <div className="mt-5 grid gap-4 border-y border-black/[0.06] py-4 sm:grid-cols-3">
                            <div>
                              <div className="text-[11px] font-black text-slate-400">建议成员</div>
                              <div className="mt-1 text-sm font-black text-slate-800">{proposedTask.agentName} · {proposedTask.mode === 'advisor' ? '顾问' : '执行'}</div>
                            </div>
                            <div>
                              <div className="text-[11px] font-black text-slate-400">采用 Skill</div>
                              <div className="mt-1 text-sm font-black text-slate-800">{proposedTask.skillSnapshot?.name || '通用任务执行'}</div>
                            </div>
                            <div>
                              <div className="text-[11px] font-black text-slate-400">选择理由</div>
                              <div className="mt-1 text-sm font-semibold leading-6 text-slate-600">{proposedTaskReason || '协调者根据成员能力与当前工作状态作出选择。'}</div>
                            </div>
                          </div>

                          <div className="mt-4">
                            <div className="text-[11px] font-black text-slate-400">准备做什么</div>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-700">{proposedTask.instruction}</p>
                          </div>
                          {proposedTask.acceptanceCriteria && (
                            <div className="mt-4">
                              <div className="text-[11px] font-black text-slate-400">验收标准</div>
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-700">{proposedTask.acceptanceCriteria}</p>
                            </div>
                          )}
                          {dispatchError && <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{dispatchError}</div>}

                          <div className="mt-5 flex flex-col gap-2 border-t border-black/[0.06] pt-4 sm:flex-row sm:flex-wrap">
                            <button type="button" onClick={() => reviewDispatch('approve')} disabled={Boolean(dispatchAction)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">
                              {dispatchAction === 'approve' ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
                              确认并开始
                            </button>
                            <button type="button" onClick={() => { setDispatchError(''); setEditingDispatchTask(proposedTask); }} disabled={Boolean(dispatchAction)} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 text-xs font-black text-slate-600 transition hover:text-slate-950 disabled:text-slate-300">
                              <Settings2 size={15} />
                              调整派发
                            </button>
                            <button type="button" onClick={() => setPendingRejectDispatch(proposedTask)} disabled={Boolean(dispatchAction)} className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-xs font-black text-rose-500 transition hover:bg-rose-50 disabled:text-slate-300">
                              拒绝
                            </button>
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
                          {reviewAudit?.accepted === false && (
                            <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
                              <div className="font-black">来源验收未通过，不能直接确认此结果</div>
                              {reviewAudit.issues?.length ? <div className="mt-1 text-xs leading-5">{reviewAudit.issues.join('；')}</div> : null}
                            </div>
                          )}
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
                            <button type="button" onClick={() => reviewCurrentTask('approve')} disabled={Boolean(reviewAction) || reviewAudit?.accepted === false} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400">
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
                                  onClick={() => {
                                    returnToChat();
                                    setSidePanel('files');
                                  }}
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
                        <div className={currentRun.status === 'BLOCKED' ? 'rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700' : 'rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600'}>{currentRun.error}</div>
                      )}

                      {acceptanceAudit && (
                        <section className="border-t border-black/[0.08] pt-5">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-black text-slate-950">
                              <CheckCircle2 className={acceptanceAudit.accepted ? 'text-emerald-500' : 'text-rose-500'} size={16} />
                              Coordinator 自动验收
                            </div>
                            <span className={acceptanceAudit.accepted ? 'text-xs font-black text-emerald-600' : 'text-xs font-black text-rose-500'}>
                              {acceptanceAudit.accepted ? '通过' : '未通过'}
                            </span>
                          </div>
                          {acceptanceAudit.evidence && (
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-400">
                              <span>步骤 {acceptanceAudit.evidence.completedTaskCount || 0}/{acceptanceAudit.evidence.taskCount || 0}</span>
                              <span>文件变化 {acceptanceAudit.evidence.workspaceChanges || 0}</span>
                              <span>文件检查 {acceptanceAudit.evidence.validatedFiles || 0}</span>
                              <span>代码检查 {acceptanceAudit.evidence.commandChecks || 0}</span>
                              {acceptanceAudit.evidence.requirementCount > 0 && (
                                <span>目标覆盖 {acceptanceAudit.evidence.coveredRequirements || 0}/{acceptanceAudit.evidence.requirementCount}</span>
                              )}
                            </div>
                          )}
                          {Boolean(acceptanceAudit.issues?.length) && (
                            <div className="mt-3 space-y-1 text-xs font-semibold leading-5 text-rose-600">
                              {acceptanceAudit.issues?.map((issue) => <div key={issue}>{issue}</div>)}
                            </div>
                          )}
                          {Boolean(acceptanceAudit.warnings?.length) && (
                            <div className="mt-3 space-y-1 text-xs font-semibold leading-5 text-amber-600">
                              {acceptanceAudit.warnings?.map((warning) => <div key={warning}>{warning}</div>)}
                            </div>
                          )}
                        </section>
                      )}

                      <details className="group border-t border-black/[0.08] pt-1">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-black text-slate-600 marker:hidden">
                          <span className="flex items-center gap-2">
                            <ChevronRight className="transition-transform group-open:rotate-90" size={16} />
                            执行详情
                          </span>
                          <span className="text-xs font-bold text-slate-400">已创建 {currentRun.tasks.length} 项工作</span>
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
                            const modelMetrics = aggregateModelRequests(activity, true);
                            const recentActivity = activity.slice(-10);
                            const latestActivity = recentActivity.at(-1);
                            const manifest = [...activity].reverse().find((event) => event.type === 'ARTIFACT_MANIFEST_RECORDED');
                            const manifestPayload = manifest ? eventPayload(manifest) : null;
                            return (
                              <details key={task.id} className="group/step border-b border-black/[0.06] last:border-b-0" open={['RUNNING', 'WAITING', 'WAITING_APPROVAL', 'CANCEL_REQUESTED', 'BLOCKED', 'FAILED'].includes(task.status) ? true : undefined}>
                                <summary className="flex cursor-pointer list-none items-start gap-3 py-4 marker:hidden">
                                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">{index + 1}</div>
                                  <div className="min-w-0 flex-1">
                                    <div className="font-black text-slate-900">{task.title}</div>
                                    <div className="mt-1 text-xs font-semibold text-slate-400">
                                      {task.agentName} · {task.mode === 'advisor' ? '顾问' : '执行'} · {task.skillSnapshot?.name || '通用任务执行'} · 模型调用 {task.modelRequestCount || 0}/{task.modelRequestLimit || (task.mode === 'advisor' ? 8 : 12)}
                                    </div>
                                  </div>
                                  <span className={task.status === 'FAILED' ? 'text-xs font-black text-rose-500' : task.status === 'BLOCKED' ? 'text-xs font-black text-amber-600' : 'text-xs font-black text-slate-400'}>
                                    {TASK_STATUS_LABELS[task.status] || task.status}
                                  </span>
                                </summary>
                                <div className="mb-4 ml-10 border-l-2 border-slate-200 pl-4">
                                  <div className="text-[11px] font-black text-slate-400">任务内容</div>
                                  <p className="mt-1 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-slate-600">{task.instruction}</p>
                                  {modelMetrics.requests > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-y border-black/[0.06] py-2 text-[11px] font-semibold text-slate-500">
                                      <span>已完成请求 {modelMetrics.requests} 次</span>
                                      <span>模型耗时 {formatDuration(modelMetrics.durationMs)}</span>
                                      {modelMetrics.retries > 0 && <span className="text-amber-600">重试 {modelMetrics.retries} 次</span>}
                                      {modelMetrics.providerUsageCount + modelMetrics.estimatedUsageCount > 0
                                        ? <span>{modelMetrics.estimatedUsageCount > 0 ? '估算 Token' : modelMetrics.providerUsageCount === modelMetrics.requests ? 'Token' : '已上报 Token'} 输入 {formatMetricCount(modelMetrics.inputTokens)} / 输出 {formatMetricCount(modelMetrics.outputTokens)} / 合计 {formatMetricCount(modelMetrics.providerTokens)}</span>
                                        : modelMetrics.requestChars > 0
                                          ? <span>输入 {formatMetricCount(modelMetrics.requestChars)} 字符{modelMetrics.outputChars > 0 ? ` / 输出 ${formatMetricCount(modelMetrics.outputChars)} 字符` : ''}</span>
                                          : null}
                                    </div>
                                  )}
                                  {manifestPayload?.summary && (
                                    <details className="mt-3 rounded-md bg-slate-50 px-3 py-2">
                                      <summary className="cursor-pointer list-none text-xs font-bold text-slate-600 marker:hidden">
                                        工作区差异 · 新增 {manifestPayload.summary.created || 0} · 修改 {manifestPayload.summary.modified || 0} · 删除 {manifestPayload.summary.deleted || 0}
                                        <span className={manifestPayload.validation?.valid === false ? 'ml-2 text-rose-500' : manifestPayload.status === 'VALIDATED' ? 'ml-2 text-emerald-600' : 'ml-2 text-slate-400'}>
                                          {manifestPayload.validation?.valid === false ? '检查失败' : manifestPayload.status === 'VALIDATED' ? '已检查' : '已记录'}
                                        </span>
                                      </summary>
                                      {Boolean(manifestPayload.entries?.length) && (
                                        <div className="mt-2 space-y-1 border-t border-black/[0.06] pt-2">
                                          {manifestPayload.entries?.map((entry, entryIndex) => (
                                            <div key={`${entry.path}-${entryIndex}`} className="flex min-w-0 items-start gap-2 text-[11px] font-semibold text-slate-500">
                                              <span className="w-8 shrink-0">{entry.change === 'CREATED' ? '新增' : entry.change === 'MODIFIED' ? '修改' : '删除'}</span>
                                              <span className="min-w-0 flex-1 break-all">{entry.path}</span>
                                              {entry.valid === false && <span className="shrink-0 text-rose-500">未通过</span>}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </details>
                                  )}
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
                                  {task.error && <div className={task.status === 'BLOCKED' ? 'mt-3 text-sm font-semibold text-amber-700' : 'mt-3 text-sm font-semibold text-rose-600'}>{task.error}</div>}
                                  {task.status === 'FAILED' && !isRunActive && (
                                    <button
                                      type="button"
                                      onClick={() => retryFailedTask(task)}
                                      disabled={Boolean(retryingTaskId)}
                                      className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-black text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:text-slate-300"
                                    >
                                      {retryingTaskId === task.id ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
                                      从此步骤重试
                                    </button>
                                  )}
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
                    </aside>
                  </>
                )}
                <div className="space-y-5">
                {messages.length === 0 && !isStreaming && (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
                    <h2 className="text-lg font-black text-slate-950">先把需求交给协调者</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {space.templateSnapshot?.name
                        ? `${space.templateSnapshot.name}已经准备好，有什么目标直接说吧。`
                        : '有什么想法，直接说吧。'}
                    </p>
                    {space.templateSnapshot?.starterPrompts?.length > 0 && (
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        {space.templateSnapshot.starterPrompts.slice(0, 3).map((prompt: string) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => {
                              setInput(prompt);
                              window.requestAnimationFrame(() => textareaRef.current?.focus());
                            }}
                            className="min-h-9 rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    )}
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
                    run={messageRunId(message)
                      ? latestRunInRetryChain(runs, messageRunId(message))
                      : null}
                    proposalBusy={proposalActionMessageId === message.id}
                    proposalDisabled={isRunActive}
                    onApproveProposal={(proposal) => approveTaskProposal(message, proposal)}
                    onReviseProposal={(proposal) => {
                      setProposalEditError('');
                      setEditingProposal({ message, proposal });
                    }}
                    onRejectProposal={() => rejectTaskProposal(message)}
                    dispatchAction={dispatchAction}
                    reviewAction={reviewAction}
                    dispatchError={dispatchError}
                    reviewError={reviewError}
                    onApproveDispatch={(task) => reviewDispatch('approve', task)}
                    onEditDispatch={(task) => {
                      setDispatchError('');
                      setEditingDispatchTask(task);
                    }}
                    onRejectDispatch={(task) => {
                      setDispatchError('');
                      setPendingRejectDispatch(task);
                    }}
                    onApproveTaskResult={(task) => reviewCurrentTask('approve', undefined, task)}
                    onReviseTaskResult={(task) => {
                      setReviewError('');
                      setRevisionTask(task);
                    }}
                    onSkipTaskResult={(task) => reviewCurrentTask('skip', undefined, task)}
                    onOpenRun={() => {
                      const runId = messageRunId(message);
                      if (!runId) return;
                      openTaskRun(runId, true);
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
                {visibleDiscussion && (
                  <SpaceDiscussionStatus
                    discussion={visibleDiscussion}
                    agents={memberAgents}
                    busy={discussionBusy}
                    onCancel={() => updateDiscussion('cancel')}
                    onResearch={(approved, scope) => updateDiscussion(approved ? 'approve_research' : 'reject_research', scope)}
                    onConvert={convertDiscussionToTask}
                    onDismiss={() => dismissDiscussion(visibleDiscussion.id)}
                  />
                )}
                </div>
              </div>
            </div>

            <footer className="border-t border-black/[0.06] bg-white p-3 sm:p-4 lg:bg-[#fbfaf7] lg:px-10 lg:pb-4 lg:pt-3">
              <div className="mx-auto max-w-4xl">
                <ComposerShell toolbar={(works.length > 0 || selectedSkill) ? (
                  <div className="flex max-w-full flex-wrap items-center gap-2">
                    {works.length > 0 && (
                      <select
                        value={activeWorkId}
                        onChange={(event) => setActiveWorkId(event.target.value)}
                        aria-label="当前成果"
                        disabled={isStreaming || isRunActive || hasPendingTaskProposal}
                        className="h-8 max-w-[min(70vw,24rem)] rounded-lg border border-black/[0.08] bg-white px-2.5 text-xs font-black text-slate-600 outline-none disabled:text-slate-300"
                      >
                        <option value="new">新建{WORK_NOUNS[space.templateId] || '成果'}</option>
                        {works.map((work, index) => (
                          <option key={work.id} value={work.id}>
                            {WORK_NOUNS[work.kind] || '成果'} {works.length - index} · {compactWorkTitle(work.title)}
                          </option>
                        ))}
                      </select>
                    )}
                    {selectedSkill && (
                      <div className="inline-flex h-8 max-w-full items-center gap-2 rounded-lg bg-white px-2.5 text-xs font-black text-slate-600 shadow-sm">
                        <BookOpen size={13} className="shrink-0" />
                        <span className="truncate">使用 {selectedSkill.name}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedSkillId(null)}
                          aria-label="取消使用 Skill"
                          title="取消使用 Skill"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ) : undefined}>
                <div ref={composerToolsRef} className="relative mb-0.5 shrink-0">
                  {composerToolsOpen && (
                    <div className="absolute bottom-[calc(100%+10px)] left-0 z-30 max-h-96 w-64 overflow-y-auto rounded-lg border border-black/[0.08] bg-white p-1.5 shadow-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setComposerToolsOpen(false);
                          window.requestAnimationFrame(() => fileInputRef.current?.click());
                        }}
                        disabled={uploadingFile}
                        className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-xs font-black text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:text-slate-300"
                      >
                        {uploadingFile ? <Loader2 className="animate-spin" size={16} /> : <Paperclip size={16} />}
                        <span className="min-w-0 flex-1 whitespace-nowrap">上传资料</span>
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={webSearchEnabled}
                        onClick={() => {
                          setWebSearchEnabled((enabled) => !enabled);
                          setComposerToolsOpen(false);
                        }}
                        className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-xs font-black transition ${webSearchEnabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}
                      >
                        <Globe2 size={16} />
                        <span className="min-w-0 flex-1 whitespace-nowrap">联网搜索</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setComposerToolsOpen(false);
                          openDiscussionDialog();
                        }}
                        disabled={Boolean(activeDiscussion) || memberAgents.length < 2}
                        className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-xs font-black text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 disabled:text-slate-300"
                      >
                        <MessagesSquare size={16} />
                        <span className="min-w-0 flex-1 whitespace-nowrap">发起讨论</span>
                      </button>
                      <div className="my-1 border-t border-black/[0.06]" />
                      <button
                        type="button"
                        onClick={() => {
                          setComposerToolsOpen(false);
                          setSidePanel('skills');
                        }}
                        className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-xs font-black text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                      >
                        <PackagePlus size={16} />
                        <span className="min-w-0 flex-1 whitespace-nowrap">管理 Space Skills</span>
                      </button>
                      {skills.map((skill) => (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => {
                            setSelectedSkillId(skill.id === selectedSkillId ? null : skill.id);
                            setComposerToolsOpen(false);
                          }}
                          className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-black transition ${skill.id === selectedSkillId ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}
                        >
                          <BookOpen size={16} className="shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{skill.name}</span>
                          {skill.id === selectedSkillId && <Check size={14} className="shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                  {mentionMenuOpen && (
                    <div className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-64 max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-black/[0.08] bg-white py-1 shadow-xl">
                      <div className="truncate px-3 pb-1 pt-2 text-[11px] font-black text-slate-400">
                        {mentionQuery ? `@${mentionQuery}` : '选择成员'}
                      </div>
                      <div className="max-h-64 overflow-y-auto p-1">
                        {mentionCandidates.length === 0 && (
                          <div className="px-3 py-5 text-center text-xs font-semibold text-slate-400">没有匹配成员</div>
                        )}
                        {mentionCandidates.map((agent, index) => {
                          const isCoordinator = agent.id === coordinatorAgent.id;
                          const status = isCoordinator ? coordinatorStatus : memberStatus(agent.id);
                          const ambiguous = duplicateMentionNames.has(agent.name.toLocaleLowerCase());
                          const alreadySelected = isMentionAlreadySelected(agent);
                          return (
                            <button
                              key={agent.id}
                              type="button"
                              disabled={ambiguous || alreadySelected}
                              onClick={() => insertMention(agent)}
                              onMouseEnter={() => setActiveMentionIndex(index)}
                              className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${index === activeMentionIndex ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                            >
                              <Avatar src={agent.avatar || (isCoordinator ? '🧭' : '🤖')} alt={agent.name} size="sm" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-black text-slate-800">{agent.name}</div>
                                <div className="truncate text-xs font-semibold text-slate-400">
                                  {ambiguous ? '名称重复' : alreadySelected ? '已选择' : isCoordinator ? '默认接话' : agent.category || 'Agent'}
                                </div>
                              </div>
                              {alreadySelected ? <Check className="shrink-0 text-slate-400" size={14} /> : (
                                <span className={`flex shrink-0 items-center gap-1.5 text-[11px] font-black ${status.text}`}>
                                  <span className={`h-2 w-2 rounded-full ${status.color}`} />
                                  {status.label}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMentionMenuOpen(false);
                      setMentionRange(null);
                      setComposerToolsOpen((open) => !open);
                    }}
                    disabled={isStreaming}
                    aria-label={composerToolsOpen ? '关闭工具菜单' : '打开工具菜单'}
                    aria-expanded={composerToolsOpen}
                    title="工具"
                    className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition disabled:text-slate-300 ${composerToolsOpen ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-950'}`}
                  >
                    <Plus size={19} className={`transition-transform ${composerToolsOpen ? 'rotate-45' : ''}`} />
                    {webSearchEnabled && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />}
                  </button>
                </div>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => {
                    const value = event.target.value;
                    setInput(value);
                    syncMentionFromCaret(value, event.target.selectionStart);
                  }}
                  onSelect={(event) => syncMentionFromCaret(event.currentTarget.value, event.currentTarget.selectionStart)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (mentionMenuOpen) {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        const direction = event.key === 'ArrowDown' ? 1 : -1;
                        setActiveMentionIndex((current) => {
                          if (mentionCandidates.length === 0) return 0;
                          return (current + direction + mentionCandidates.length) % mentionCandidates.length;
                        });
                        return;
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setMentionMenuOpen(false);
                        setMentionRange(null);
                        return;
                      }
                      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
                        event.preventDefault();
                        const candidate = mentionCandidates[activeMentionIndex];
                        if (candidate
                          && !duplicateMentionNames.has(candidate.name.toLocaleLowerCase())
                          && !isMentionAlreadySelected(candidate)) {
                          insertMention(candidate);
                        }
                        return;
                      }
                    }
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
                    {sidePanel === 'members' ? <UsersRound size={17} /> : sidePanel === 'files' ? <FileText size={17} /> : sidePanel === 'skills' ? <BookOpen size={17} /> : sidePanel === 'runs' ? <History size={17} /> : <Settings2 size={17} />}
                    {sidePanel === 'members' ? '空间成员' : sidePanel === 'files' ? '资料与成果' : sidePanel === 'skills' ? 'Space Skills' : sidePanel === 'runs' ? '历史任务' : '空间设置'}
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
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedWorkId}
                          onChange={(event) => setSelectedWorkId(event.target.value)}
                          aria-label="筛选成果"
                          className="h-10 min-w-0 flex-1 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-bold text-slate-700 outline-none"
                        >
                          <option value="all">全部</option>
                          {works.map((work, index) => (
                            <option key={work.id} value={work.id}>
                              {WORK_NOUNS[work.kind] || '成果'} {works.length - index} · {compactWorkTitle(work.title, 14)}
                            </option>
                          ))}
                          {files.some((file) => !file.workId) && <option value="legacy">公共 / 历史</option>}
                        </select>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingFile}
                          title="上传资料"
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          {uploadingFile ? <Loader2 className="animate-spin" size={15} /> : <UploadCloud size={15} />}
                        </button>
                      </div>
                      <div className="mt-5 space-y-2">
                        {visibleFiles.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 px-5 py-10 text-center">
                            <FileText className="mx-auto text-slate-300" size={24} />
                            <div className="mt-3 text-sm font-black text-slate-500">暂无资料</div>
                            <div className="mt-1 text-xs font-semibold leading-5 text-slate-400">上传的资料会保存在当前空间。</div>
                          </div>
                        ) : (
                          visibleFiles.map((file) => (
                            <div key={file.id} className="flex items-center gap-3 rounded-lg border border-black/[0.06] bg-white px-3 py-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                <FileText size={16} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className="min-w-0 flex-1 truncate text-sm font-black text-slate-800">{file.fileName}</div>
                                  <FileStatus status={file.status} />
                                </div>
                                <div className="mt-0.5 truncate text-xs font-semibold text-slate-400">
                                  {file.workId ? `${WORK_NOUNS[workById.get(file.workId)?.kind || ''] || '成果'} · ${workById.get(file.workId)?.title || '未命名'}` : '公共资料 / 历史成果'}
                                  {file.size ? ` · ${formatBytes(file.size)}` : ''}
                                </div>
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
                  ) : sidePanel === 'skills' ? (
                    <div>
                      <div className="flex gap-2">
                        <input
                          value={skillSourceUrl}
                          onChange={(event) => setSkillSourceUrl(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              previewSkill(skillSourceUrl);
                            }
                          }}
                          placeholder="GitHub Skill 地址"
                          className="h-11 min-w-0 flex-1 rounded-lg border border-black/[0.08] bg-[#fbfaf7] px-3 text-xs font-semibold text-slate-700 outline-none focus:border-slate-300"
                        />
                        <button
                          type="button"
                          onClick={() => previewSkill(skillSourceUrl)}
                          disabled={!skillSourceUrl.trim() || skillBusy}
                          title="分析 Skill"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          {skillBusy && !skillPreview ? <Loader2 className="animate-spin" size={16} /> : <PackagePlus size={16} />}
                        </button>
                      </div>
                      <input
                        ref={skillZipInputRef}
                        type="file"
                        accept=".zip,application/zip"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) previewUploadedSkill(file);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => skillZipInputRef.current?.click()}
                        disabled={skillBusy}
                        className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 text-xs font-black text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 disabled:text-slate-300"
                      >
                        <UploadCloud size={15} />
                        上传 Skill ZIP
                      </button>
                      <div className="mt-5 space-y-2">
                        {skills.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 px-5 py-10 text-center">
                            <BookOpen className="mx-auto text-slate-300" size={24} />
                            <div className="mt-3 text-sm font-black text-slate-500">暂无 Space Skill</div>
                          </div>
                        ) : skills.map((skill) => (
                          <div key={skill.id} className="rounded-lg border border-black/[0.06] bg-white px-3 py-3">
                            <div className="flex items-start gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                <BookOpen size={16} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-black text-slate-800">{skill.name}</div>
                                <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{skill.id} · {skill.version}</div>
                                <p
                                  className="mt-2 line-clamp-3 text-xs font-semibold leading-5 text-slate-500"
                                  title={skill.description}
                                >
                                  {skill.description}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setPendingRemoveSkill(skill)}
                                title="删除 Skill"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                            {skill.warnings.map((warning) => (
                              <div key={warning} className="mt-2 text-[11px] font-semibold leading-5 text-amber-600">{warning}</div>
                            ))}
                            {skill.scripts?.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPendingExecutionSkill(skill);
                                  setApprovedScriptDraft(skill.approvedScripts || []);
                                }}
                                className={`mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-black transition ${skill.executionEnabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                              >
                                <ShieldCheck size={14} />
                                {skill.executionEnabled ? `已批准 ${skill.approvedScripts.length} 个脚本` : '配置脚本执行权限'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
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
                              openTaskRun(run.id);
                              setSidePanel(null);
                            }}
                            className={`w-full border-b border-black/[0.06] px-2 py-4 text-left transition last:border-b-0 ${selected ? 'bg-[#fbfaf7]' : 'hover:bg-[#fbfaf7]'}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="line-clamp-2 min-w-0 flex-1 text-sm font-black leading-6 text-slate-800">{run.input}</div>
                              <span className={['FAILED', 'FAILED_VALIDATION'].includes(run.status) ? 'shrink-0 text-xs font-black text-rose-500' : run.status === 'COMPLETED' ? 'shrink-0 text-xs font-black text-emerald-600' : ['PARTIAL', 'BLOCKED'].includes(run.status) ? 'shrink-0 text-xs font-black text-amber-600' : 'shrink-0 text-xs font-black text-slate-500'}>
                                {RUN_STATUS_LABELS[run.status] || run.status}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-400">
                              <span>{formatRunDate(run.createdAt)}</span>
                              <span>·</span>
                              <span>{completed}/{run.tasks.length} 步</span>
                              {run.work && <><span>·</span><span className="truncate">{WORK_NOUNS[run.work.kind] || '成果'}：{run.work.title}</span></>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <div className="mb-2 text-sm font-black text-slate-700">执行模式</div>
                        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-black/[0.08] bg-[#fbfaf7] p-1">
                          <button
                            type="button"
                            onClick={() => setExecutionModeDraft('REVIEW_DISPATCH')}
                            aria-pressed={executionModeDraft === 'REVIEW_DISPATCH'}
                            className={`min-h-11 rounded-md px-3 text-xs font-black transition ${executionModeDraft === 'REVIEW_DISPATCH' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:text-slate-950'}`}
                          >
                            派发前确认
                          </button>
                          <button
                            type="button"
                            onClick={() => setExecutionModeDraft('AUTO')}
                            aria-pressed={executionModeDraft === 'AUTO'}
                            className={`min-h-11 rounded-md px-3 text-xs font-black transition ${executionModeDraft === 'AUTO' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:text-slate-950'}`}
                          >
                            自动执行
                          </button>
                        </div>
                        <p className="mt-2 text-xs font-semibold leading-5 text-slate-400">
                          {executionModeDraft === 'REVIEW_DISPATCH' ? 'Coordinator 提出成员和任务边界，确认后成员才开始。' : '目标确认后由 Coordinator 自主派发并立即执行。'}
                        </p>
                      </div>
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
                        保存设置
                      </button>
                      <section className="border-t border-black/[0.06] pt-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-black text-slate-700">
                              <BookOpen size={16} />
                              团队成长
                            </div>
                            <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
                              只将你确认的经验写入成长 README，并用于后续规划、执行和验收。
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-black text-slate-400">v{learning?.revision || 0}</span>
                        </div>

                        {learning && (
                          <div className="mt-4 grid grid-cols-3 border-y border-black/[0.06] py-3 text-center">
                            <div>
                              <div className="text-base font-black text-slate-800">{learning.proposals.filter((item) => item.status === 'pending').length}</div>
                              <div className="mt-0.5 text-[11px] font-bold text-slate-400">待确认</div>
                            </div>
                            <div className="border-x border-black/[0.06]">
                              <div className="text-base font-black text-slate-800">{learning.rules.filter((item) => item.status === 'active').length}</div>
                              <div className="mt-0.5 text-[11px] font-bold text-slate-400">已生效</div>
                            </div>
                            <div>
                              <div className="text-base font-black text-slate-800">{[...learning.proposals, ...learning.rules].reduce((sum, item) => sum + item.occurrences, 0)}</div>
                              <div className="mt-0.5 text-[11px] font-bold text-slate-400">累计发现</div>
                            </div>
                          </div>
                        )}

                        <div className="mt-4 space-y-3">
                          {learning?.proposals.filter((item) => item.status === 'pending').map((item) => (
                            <div key={item.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[11px] font-black text-amber-700">待确认 · {LEARNING_CATEGORY_LABELS[item.category]}</span>
                                <span className="text-[11px] font-bold text-amber-600">发现 {item.occurrences} 次</span>
                              </div>
                              <input
                                value={item.title}
                                maxLength={120}
                                onChange={(event) => updateLearningDraft('proposals', item.id, 'title', event.target.value)}
                                aria-label="成长建议标题"
                                className="mt-2 w-full border-0 bg-transparent text-sm font-black text-slate-800 outline-none"
                              />
                              <textarea
                                value={item.instruction}
                                maxLength={1_200}
                                rows={3}
                                onChange={(event) => updateLearningDraft('proposals', item.id, 'instruction', event.target.value)}
                                aria-label="成长建议内容"
                                className="mt-1 w-full resize-y rounded-md border border-amber-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none focus:border-amber-300"
                              />
                              {item.evidence.at(-1) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSidePanel(null);
                                    openTaskRun(item.evidence.at(-1)!.runId);
                                  }}
                                  className="mt-2 text-left text-[11px] font-bold text-slate-400 hover:text-slate-700"
                                >
                                  证据任务：{item.evidence.at(-1)!.summary || item.evidence.at(-1)!.runId}
                                </button>
                              )}
                              <div className="mt-3 flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => applyLearningAction(item, 'ignore')}
                                  disabled={Boolean(learningActionId)}
                                  className="h-9 rounded-lg px-3 text-xs font-black text-slate-500 hover:bg-white disabled:text-slate-300"
                                >
                                  忽略
                                </button>
                                <button
                                  type="button"
                                  onClick={() => applyLearningAction(item, 'approve')}
                                  disabled={Boolean(learningActionId) || !item.title.trim() || !item.instruction.trim()}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-xs font-black text-white disabled:bg-slate-200"
                                >
                                  {learningActionId === item.id ? <Loader2 className="animate-spin" size={13} /> : <Check size={13} />}
                                  应用经验
                                </button>
                              </div>
                            </div>
                          ))}

                          {learning?.rules.map((item) => (
                            <div key={item.id} className={`rounded-lg border p-3 ${item.status === 'active' ? 'border-black/[0.08] bg-white' : 'border-black/[0.06] bg-slate-50 opacity-70'}`}>
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[11px] font-black text-slate-400">{LEARNING_CATEGORY_LABELS[item.category]} · {item.status === 'active' ? '已生效' : '已停用'}</span>
                                <span className="text-[11px] font-bold text-slate-400">发现 {item.occurrences} 次</span>
                              </div>
                              <input
                                value={item.title}
                                maxLength={120}
                                onChange={(event) => updateLearningDraft('rules', item.id, 'title', event.target.value)}
                                aria-label="成长规则标题"
                                className="mt-2 w-full border-0 bg-transparent text-sm font-black text-slate-800 outline-none"
                              />
                              <textarea
                                value={item.instruction}
                                maxLength={1_200}
                                rows={2}
                                onChange={(event) => updateLearningDraft('rules', item.id, 'instruction', event.target.value)}
                                aria-label="成长规则内容"
                                className="mt-1 w-full resize-y rounded-md border border-black/[0.06] bg-[#fbfaf7] px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none focus:border-slate-300"
                              />
                              <div className="mt-3 flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => applyLearningAction(item, item.status === 'active' ? 'disable_rule' : 'enable_rule')}
                                  disabled={Boolean(learningActionId)}
                                  className="h-9 rounded-lg px-3 text-xs font-black text-slate-500 hover:bg-slate-50 disabled:text-slate-300"
                                >
                                  {item.status === 'active' ? '停用' : '启用'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => applyLearningAction(item, 'update_rule')}
                                  disabled={Boolean(learningActionId) || !item.title.trim() || !item.instruction.trim()}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
                                >
                                  {learningActionId === item.id ? <Loader2 className="animate-spin" size={13} /> : <Save size={13} />}
                                  保存
                                </button>
                              </div>
                            </div>
                          ))}

                          {learning && learning.rules.length === 0 && learning.proposals.every((item) => item.status !== 'pending') && (
                            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs font-semibold leading-5 text-slate-400">
                              暂无成长经验。任务出现用户纠正、返工或验收问题后，这里会生成待确认建议。
                            </div>
                          )}
                        </div>

                        {learningReadme && (
                          <details className="mt-4 border-t border-black/[0.06] pt-3">
                            <summary className="cursor-pointer text-xs font-black text-slate-500">查看生成的 README</summary>
                            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-[11px] font-medium leading-5 text-slate-200">{learningReadme}</pre>
                          </details>
                        )}
                      </section>
                      <div className="border-t border-black/[0.06] pt-5">
                        <div className="text-sm font-black text-slate-700">清空空间内容</div>
                        <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
                          删除全部聊天记录、历史任务、空间记忆、成长经验和文件，保留空间成员与设置。
                        </p>
                        <button
                          type="button"
                          onClick={() => setClearSpaceOpen(true)}
                          disabled={clearingSpace || isStreaming || Boolean(activeRun) || Boolean(activeDiscussion)}
                          className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 px-4 text-xs font-black text-rose-600 transition hover:bg-rose-50 disabled:border-slate-200 disabled:text-slate-300"
                        >
                          <Trash2 size={15} />
                          清空聊天和文件
                        </button>
                        {(isStreaming || activeRun || activeDiscussion) && (
                          <p className="mt-2 text-xs font-semibold text-amber-600">请先停止正在进行的回答、任务或讨论。</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            </>
          )}
        </div>
      </div>
      {discussionDialogOpen && (
        <SpaceDiscussionDialog
          agents={memberAgents}
          topic={discussionTopic}
          selectedIds={discussionParticipantIds}
          allowWeb={discussionAllowWeb}
          busy={discussionBusy}
          error={discussionError}
          onTopicChange={setDiscussionTopic}
          onSelectedIdsChange={setDiscussionParticipantIds}
          onAllowWebChange={setDiscussionAllowWeb}
          onClose={() => setDiscussionDialogOpen(false)}
          onStart={startDiscussion}
        />
      )}
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
      <TaskDispatchDialog
        task={editingDispatchTask}
        members={memberAgents}
        loading={dispatchAction === 'approve'}
        error={dispatchError}
        onCancel={() => {
          setDispatchError('');
          setEditingDispatchTask(null);
        }}
        onConfirm={(revision) => reviewDispatch('approve', editingDispatchTask, revision)}
      />
      <TaskReviewDialog
        task={revisionTask}
        loading={reviewAction === 'retry'}
        error={reviewError}
        onCancel={() => {
          setReviewError('');
          setRevisionTask(null);
        }}
        onConfirm={(feedback) => reviewCurrentTask('retry', feedback, revisionTask)}
      />
      <TaskReviewDialog
        task={pendingRejectDispatch}
        loading={dispatchAction === 'reject'}
        error={dispatchError}
        eyebrow="退回派发提案"
        label="需要协调者如何调整"
        placeholder="例如：先交给产品确认范围；改由另一位成员执行；缩小本次任务边界..."
        confirmText="退回并重新规划"
        validationMessage="请说明需要调整的成员或任务边界"
        onCancel={() => {
          setDispatchError('');
          setPendingRejectDispatch(null);
        }}
        onConfirm={(feedback) => reviewDispatch('reject', pendingRejectDispatch, undefined, feedback)}
      />
      <SpaceFileEditorDialog
        spaceId={spaceId}
        file={editingFile}
        publishTarget={space?.templateId === 'wechat-article' ? 'wechat' : undefined}
        onClose={() => setEditingFile(null)}
        onSaved={(updatedFile) => {
          setFiles((items) => [updatedFile, ...items.filter((item) => item.id !== updatedFile.id)]);
        }}
      />
      <ConfirmDialog
        open={Boolean(skillPreview)}
        title={`安装 ${skillPreview?.name || 'Space Skill'}？`}
        description={skillPreview ? (
          <div className="space-y-3">
            <p className="line-clamp-4" title={skillPreview.description}>{skillPreview.description}</p>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              <div>{skillPreview.id} · {skillPreview.version}</div>
              <div className="mt-1 break-all">{skillUploadFile ? `已上传：${skillUploadFile.name}` : skillPreview.sourceUrl}</div>
              <div className="mt-1">{skillPreview.files.length} 个文本文件</div>
            </div>
            {skillPreview.warnings.map((warning) => (
              <p key={warning} className="font-semibold text-amber-600">{warning}</p>
            ))}
            <p className="text-xs font-semibold text-slate-400">安装不会授予终端、联网、文件写入或脚本执行权限。</p>
          </div>
        ) : null}
        icon={<PackagePlus size={20} />}
        cancelText="暂不安装"
        confirmText="确认安装"
        loading={skillBusy}
        onCancel={() => {
          setSkillPreview(null);
          setSkillUploadFile(null);
          if (skillZipInputRef.current) skillZipInputRef.current.value = '';
        }}
        onConfirm={installSkill}
      />
      <ConfirmDialog
        open={Boolean(pendingExecutionSkill)}
        title={`配置 ${pendingExecutionSkill?.name || 'Space Skill'} 的脚本权限`}
        description={pendingExecutionSkill ? (
          <div className="space-y-3">
            <p>只有你勾选的 Python 脚本可以在强制沙箱中读取当前任务文件。脚本不能联网、安装依赖或修改工作区。</p>
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-black/[0.06] p-2">
              {pendingExecutionSkill.scripts.map((script) => (
                <label key={script} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={approvedScriptDraft.includes(script)}
                    onChange={(event) => setApprovedScriptDraft((items) => event.target.checked
                      ? [...items, script]
                      : items.filter((item) => item !== script))}
                    className="mt-1 h-4 w-4 accent-slate-950"
                  />
                  <span className="min-w-0 break-all text-xs font-bold text-slate-700">{script}</span>
                </label>
              ))}
            </div>
            <p className="text-xs font-semibold text-amber-600">关闭全部勾选即可撤销该 Skill 的脚本执行权限。</p>
          </div>
        ) : null}
        icon={<ShieldCheck size={20} />}
        cancelText="取消"
        confirmText="保存权限"
        loading={skillBusy}
        onCancel={() => {
          setPendingExecutionSkill(null);
          setApprovedScriptDraft([]);
        }}
        onConfirm={saveSkillExecution}
      />
      <ConfirmDialog
        open={Boolean(pendingRemoveSkill)}
        title={`删除 ${pendingRemoveSkill?.name || 'Space Skill'}？`}
        description="删除后，新的消息和任务不能再选择它；已经开始的任务仍使用当时保存的 Skill 快照。"
        icon={<Trash2 size={20} />}
        cancelText="先保留"
        confirmText="确认删除"
        destructive
        loading={skillBusy}
        onCancel={() => setPendingRemoveSkill(null)}
        onConfirm={removeSkill}
      />
      <ConfirmDialog
        open={clearSpaceOpen}
        title="清空当前空间？"
        description="聊天记录、历史任务、空间记忆、成长经验、上传资料和工作区文件都会永久删除。空间本身、成员、Space Skills 和执行模式设置会保留。"
        icon={<Trash2 size={20} />}
        cancelText="先保留"
        confirmText="确认清空"
        destructive
        loading={clearingSpace}
        onCancel={() => setClearSpaceOpen(false)}
        onConfirm={clearSpaceContents}
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
