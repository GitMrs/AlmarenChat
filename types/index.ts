export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  createdAt: string;
}

// Agent is kept as the underlying data model (backward compatible)
// UI-facing components use entertainment terminology (Character, Story, World, etc.)
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
  // Entertainment metadata (optional, progressive enhancement)
  creationType?: 'mystery' | 'world' | 'character' | 'script';
  genre?: string;
  hook?: string;
  worldSetting?: string;
  playerRole?: string;
  openingScene?: string;
  rules?: string;
  winConditions?: string;
  estimatedDuration?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  playerCount?: string;
  tags?: string[];
  builderConfig?: string; // JSON string of type-specific structured data
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

// Entertainment genre categories (replaces AGENT_CATEGORIES)
export const CATEGORIES = [
  '全部',
  '悬疑推理',
  '浪漫言情',
  '奇幻冒险',
  '都市剧情',
  '社交推理',
  '心理博弈',
  '喜剧搞笑',
  '恐怖惊悚',
  '科幻探索',
] as const;

// Keep backward-compatible alias
export const AGENT_CATEGORIES = CATEGORIES;

export type Category = (typeof CATEGORIES)[number];
export type AgentCategory = Category;

export const TONES = [
  '沉浸',
  '悬疑',
  '浪漫',
  '黑暗',
  '轻松',
  '史诗',
  '幽默',
  '紧张',
] as const;

// Keep backward-compatible alias
export const AGENT_TONES = TONES;

export type Tone = (typeof TONES)[number];
export type AgentTone = Tone;

export const CATEGORY_COLORS: Record<string, string> = {
  悬疑推理: '#6366f1',
  浪漫言情: '#ec4899',
  奇幻冒险: '#8b5cf6',
  都市剧情: '#f97316',
  社交推理: '#14b8a6',
  心理博弈: '#f43f5e',
  喜剧搞笑: '#eab308',
  恐怖惊悚: '#1e293b',
  科幻探索: '#06b6d4',
};

// Difficulty labels
export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '轻松',
  medium: '普通',
  hard: '烧脑',
};

export type NavTab = 'discover' | 'explore' | 'create' | 'play' | 'me';

export type {
  BlueprintAccusation,
  BlueprintAccusationResult,
  BlueprintAction,
  BlueprintActionIntent,
  BlueprintActionResult,
  BlueprintClue,
  BlueprintCondition,
  BlueprintEffect,
  BlueprintEnding,
  BlueprintInitialState,
  BlueprintItem,
  BlueprintObject,
  BlueprintRuntimeState,
  BlueprintScene,
  BlueprintSuspect,
  MysteryBlueprint,
} from './blueprint';
