export type StudioApprovalMode = 'dangerous' | 'always' | 'never';

export interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  content?: string;
  updatedAt?: number;
}

export interface SkillPreset {
  id: string;
  name: string;
  description: string;
  content: string;
}

export interface ToolInvocation {
  id: string;
  name: string;
  preview: string;
  status: 'waiting_approval' | 'running' | 'done' | 'failed' | 'completed' | 'stopped' | 'denied';
  approvalId?: string;
  args?: Record<string, any>;
  result?: string;
  sessionId?: string;
  agentId?: string;
  expanded?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  tools?: ToolInvocation[];
  tokens?: number | null;
  timestamp: number;
}

export interface StudioWorkspaceItem {
  id: string;
  name: string;
  description?: string | null;
  systemPrompt?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: number;
  children?: FileNode[];
}

export interface StudioConfig {
  coordinatorBaseUrl: string;
  coordinatorApiKey: string;
  coordinatorModel: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  deepseekApiKey: string;
}

export const DEFAULT_CONFIG: StudioConfig = {
  coordinatorBaseUrl: '',
  coordinatorApiKey: '',
  coordinatorModel: 'DeepSeek-V4',
  anthropicApiKey: '',
  openaiApiKey: '',
  deepseekApiKey: '',
};
