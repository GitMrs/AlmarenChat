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
  agentId: string;
  agent: Agent;
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
  createdAt: string;
}

export interface FavoriteAgent {
  id: string;
  userId: string;
  agentId: string;
  agent?: Agent;
  createdAt: string;
}

export const AGENT_CATEGORIES = [
  '全部',
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
