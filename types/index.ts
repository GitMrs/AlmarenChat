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
  createdAt: string;
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
  createdAt: string;
  updatedAt?: string | null;
}

export type SpaceTaskCapability = 'workspace_read' | 'workspace_write' | 'web_research';

export interface SpaceTaskProposal {
  type: 'task_proposal';
  title: string;
  goal: string;
  summary: string;
  steps: string[];
  deliverables: string[];
  capabilities?: SpaceTaskCapability[];
  status: 'pending' | 'approved' | 'rejected';
  runId?: string;
}

export type SpaceMessageAttachment = MessageAttachment | SpaceTaskProposal;

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
  status: string;
  result?: string | null;
  error?: string | null;
  reviewFeedback?: string | null;
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
