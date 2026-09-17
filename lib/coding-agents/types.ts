export type CodingAgentId = 'pi' | 'claude-code' | 'codex' | 'dsh' | 'opencode' | 'grok';

export type AgentInstallStatus = 'installed' | 'not_installed' | 'error';

export type AgentSessionStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED';

export interface CodingAgentMetadata {
  id: CodingAgentId;
  name: string;
  provider: string;
  command: string;
  packageName: string;
  description: string;
  isBuiltin?: boolean;
  versionArgs: string[];
  installCommand: string;
}

export interface CodingAgentStatusInfo extends CodingAgentMetadata {
  status: AgentInstallStatus;
  version: string | null;
  path: string | null;
  lastCheckedAt: number;
}

export interface AgentSessionLaunchOptions {
  userId: string;
  spaceId?: string;
  workspaceId?: string;
  workspaceDir?: string;
  agentId: CodingAgentId;
  prompt: string;
  customApiKey?: string;
  customBaseUrl?: string;
  modelName?: string;
}

export interface AgentSessionEvent {
  type: 'stdout' | 'stderr' | 'status' | 'error' | 'exit';
  data: string;
  timestamp: number;
}

export interface AgentSession {
  id: string;
  userId: string;
  spaceId: string;
  agentId: CodingAgentId;
  prompt: string;
  status: AgentSessionStatus;
  workspaceDir: string;
  pid?: number;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  error?: string | null;
  logBuffer: string[];
  listeners: Set<(event: AgentSessionEvent) => void>;
}
