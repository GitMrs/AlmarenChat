export interface BilibiliAgentConnector {
  id?: string;
  spaceId?: string | null;
  enabled?: boolean | number | string | null;
  status?: string | null;
  publicConfig?: unknown;
  credentialCiphertext?: string | null;
}

export interface BilibiliAgentToolsOptions {
  userId?: string;
  spaceId?: string;
  projectRoot?: string;
  loadConnector: () => Promise<BilibiliAgentConnector | null>;
  markExpired?: (context: { spaceId?: string; provider?: string }) => Promise<void> | void;
}

export interface BilibiliAgentToolResult {
  ok: boolean;
  status?: string;
  error?: string;
  [key: string]: unknown;
}

export interface BilibiliAgentToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface BilibiliAgentTools {
  tools: BilibiliAgentToolSchema[];
  guidance: string;
  owns(name: string): boolean;
  execute(
    name: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<BilibiliAgentToolResult>;
}

export function createBilibiliAgentTools(options: BilibiliAgentToolsOptions): BilibiliAgentTools;

export const BILIBILI_TOOL_GUIDANCE: string;
