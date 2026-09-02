export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  creatorId?: string;
  name: string;
  avatar?: string;
  description?: string;
  category?: string;
  tone?: string;
  greeting?: string;
  systemPrompt?: string;
  model?: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  userId: string;
  agentId?: string;
  agentName?: string;
  agentAvatar?: string;
  agentCategory?: string;
  agentTone?: string;
  agentDescription?: string;
  agentSystemPrompt?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export interface Space {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  executionMode: 'AUTO' | 'REVIEW_DISPATCH';
  hostAgentId?: string | null;
  hostAgent?: Agent | null;
  createdAt: string;
  updatedAt: string;
  members?: SpaceMember[];
  messages?: SpaceMessage[];
  files?: SpaceFile[];
  runs?: AgentRun[];
}

export interface SpaceMember {
  id: string;
  spaceId: string;
  agentId: string;
  roleName?: string | null;
  sortOrder: number;
  createdAt: string;
  agent?: Agent | null;
}

export interface SpaceMessage {
  id: string;
  spaceId: string;
  role: 'user' | 'assistant' | 'system';
  speakerAgentId?: string | null;
  content: string;
  attachments?: SpaceMessageAttachment[];
  sourceKey?: string | null;
  createdAt: string;
}

export interface SpaceSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  sourceUrl: string;
  digest: string;
  installedAt: string;
  enabled: boolean;
  fileCount: number;
  warnings: string[];
  scripts: string[];
  approvedScripts: string[];
  executionEnabled: boolean;
}

export interface SpaceSkillPreview {
  id: string;
  name: string;
  version: string;
  description: string;
  sourceUrl: string;
  digest: string;
  files: string[];
  warnings: string[];
}

export interface SpaceSkillInvocationAttachment {
  type: 'skill_invocation';
  skillId: string;
  name: string;
  version: string;
  digest: string;
}

export interface SpaceFile {
  id: string;
  spaceId: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
  relativePath: string;
  runId?: string | null;
  taskId?: string | null;
  status?: 'GENERATING' | 'WAITING_APPROVAL' | 'READY' | 'INCOMPLETE';
  shareId?: string | null;
  shareEnabled?: boolean;
  sharedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface SpaceFileShare {
  id: string;
  fileName: string;
  spaceId: string;
  spaceName: string;
  url: string;
  sharedAt?: string | null;
  updatedAt?: string | null;
}

export type SpaceTaskCapability = 'workspace_read' | 'workspace_write' | 'web_research' | 'code_execute';
export type SpaceNetworkPolicy = 'forbidden' | 'allowed' | 'required';

export interface SpaceTaskExecutionStep {
  agentId: string;
  agentName?: string;
  mode: 'advisor' | 'executor';
  title: string;
  instruction: string;
  dependsOn: number[];
  deliverables: string[];
}

export interface SpaceTaskProposal {
  type: 'task_proposal';
  title: string;
  goal: string;
  summary: string;
  steps: string[];
  deliverables: string[];
  artifacts?: string[];
  executionPlan?: SpaceTaskExecutionStep[];
  capabilities?: SpaceTaskCapability[];
  networkPolicy?: SpaceNetworkPolicy;
  status: 'pending' | 'approved' | 'rejected';
  runId?: string;
  skillSnapshot?: {
    id: string;
    name: string;
    version: string;
    description?: string;
    digest?: string;
  };
  skillAgentId?: string;
}

export interface SpaceDiscussionAttachment {
  type: 'discussion_turn' | 'discussion_summary';
  discussionId: string;
  round?: number;
  failed?: boolean;
}

export interface SpaceRunResultAttachment {
  type: 'run_result';
  runId: string;
  status: string;
}

export interface SpaceDiscussionResearchRequest {
  query: string;
  reason: string;
  agentId: string;
  agentName: string;
  approved?: boolean;
}

export interface SpaceDiscussion {
  id: string;
  spaceId: string;
  userId: string;
  topic: string;
  participantIds: string[];
  status: 'QUEUED' | 'RUNNING' | 'WAITING_RESEARCH' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
  currentRound: number;
  currentIndex: number;
  maxRounds: number;
  allowWeb: boolean;
  webSearchCount: number;
  pendingResearch?: SpaceDiscussionResearchRequest | null;
  result?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export type SpaceMessageAttachment = MessageAttachment | SpaceTaskProposal | SpaceDiscussionAttachment | SpaceRunResultAttachment | SpaceSkillInvocationAttachment;

export interface AgentRun {
  id: string;
  spaceId: string;
  userId: string;
  input: string;
  status: string;
  result?: string | null;
  error?: string | null;
    retryOfId?: string | null;
    attempt: number;
    workerId?: string | null;
    heartbeatAt?: string | null;
    completionId?: string | null;
    modelRequestCount: number;
    modelRequestLimit: number;
    runtimeVersion: number;
    eventSequence: number;
    coordinatorState?: unknown;
    createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  tasks: AgentTask[];
  events: AgentRunEvent[];
}

export interface AgentTask {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  title: string;
  instruction: string;
  acceptanceCriteria?: string | null;
  origin?: string;
  parentTaskId?: string | null;
  mode: 'advisor' | 'executor';
  dependsOn?: number[] | null;
  skillId?: string;
  skillVersion?: string;
  skillSnapshot?: {
    id: string;
    name: string;
    version: string;
    description?: string;
    requiredCapabilities?: SpaceTaskCapability[];
    allowedTools?: string[];
    artifactExtensions?: string[];
    instructions?: string;
  } | null;
  webResearchRequired?: boolean;
  modelRequestCount: number;
  modelRequestLimit: number;
  status: string;
  result?: string | null;
    error?: string | null;
    reviewFeedback?: string | null;
    waitQuestion?: string | null;
    waitReason?: string | null;
    waitAnswer?: string | null;
    waitingAt?: string | null;
    proposedAt?: string | null;
    approvedAt?: string | null;
    submittedAt?: string | null;
    reviewDecision?: string | null;
    reviewSummary?: string | null;
    attempt: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  reviewedAt?: string | null;
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  type: string;
  message: string;
  payload?: unknown;
  idempotencyKey?: string | null;
  sequence: number;
  taskId?: string | null;
  agentId?: string | null;
  attempt?: number | null;
  actor?: string | null;
  createdAt: string;
}

export interface MessageAttachment {
  type: 'image';
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
}

export interface FavoriteAgent {
  id: string;
  userId: string;
  agentId: string;
  source: 'builtin' | 'custom';
  agent?: Agent;
  createdAt: string;
}

export const AGENT_CATEGORIES = [
  '全部',
  '专业',
  '写作',
  '编程',
  '学习',
  '心理',
  '创意',
  '生活',
  '工具',
  '娱乐',
] as const;

export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export const AGENT_TONES = [
  '专业',
  '幽默',
  '温柔',
  '冷静',
  '热情',
  '简洁',
  '详细',
  '友好',
] as const;

export type AgentTone = (typeof AGENT_TONES)[number];

export const CATEGORY_COLORS: Record<string, string> = {
  专业: '#0f766e',
  写作: '#f59e0b',
  编程: '#2563eb',
  学习: '#10b981',
  心理: '#ec4899',
  创意: '#8b5cf6',
  生活: '#f97316',
  工具: '#6366f1',
  娱乐: '#ef4444',
};

export type NavTab = 'discover' | 'agents' | 'create' | 'me' | 'settings';
