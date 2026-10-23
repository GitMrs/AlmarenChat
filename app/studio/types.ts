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
  /** 工具执行中的实时输出（累计），完成后由 result 取代 */
  liveOutput?: string;
  sessionId?: string;
  agentId?: string;
  expanded?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  /** 推理模型流式思考内容（仅本次运行内有效，不落库） */
  thinking?: string;
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

export interface PreviewFile {
  path: string;
  content: string;
  isImage?: boolean;
  dataUrl?: string;
  mimeType?: string;
  size?: number;
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
