import type { AgentRun } from '@/types';

const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
export const auth = {
  register: (data: { email: string; password: string; name: string }) =>
    request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  me: () => request<{ user: any }>('/auth/me'),
};

// Agents
export const agents = {
  list: () => request<{ agents: any[] }>('/agents'),
  mine: () => request<{ agents: any[] }>('/agents?scope=mine'),
  get: (id: string) => request<{ agent: any }>(`/agents/${id}`),
  create: (data: any) =>
    request<{ agent: any }>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: any) =>
    request<{ agent: any }>(`/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/agents/${id}`, {
      method: 'DELETE',
    }),
  knowledge: (id: string) => request<{ documents: any[] }>(`/agents/${id}/knowledge`),
  knowledgeChunks: (id: string, documentId: string) =>
    request<{ document: any; chunks: any[] }>(`/agents/${id}/knowledge?documentId=${encodeURIComponent(documentId)}`),
  searchKnowledge: (id: string, query: string) =>
    request<{ hits: any[] }>(`/agents/${id}/knowledge?q=${encodeURIComponent(query)}`),
  deleteKnowledge: (id: string, documentId: string) =>
    request<{ success: boolean }>(`/agents/${id}/knowledge?documentId=${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
    }),
  uploadKnowledge: async (id: string, file: File) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API_BASE}/agents/${id}/knowledge`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json() as Promise<{ document: any; chunkCount: number }>;
  },
};

// Conversations
export const conversations = {
  list: () => request<{ conversations: any[] }>('/conversations'),
  get: (id: string) => request<{ conversation: any }>(`/conversations/${id}`),
  create: (data: { agentId: string; title?: string }) =>
    request<{ conversation: any }>('/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/conversations/${id}`, {
      method: 'DELETE',
    }),
  update: (id: string, data: { title?: string; contextMessageLimit?: number }) =>
    request<{ conversation: any }>(`/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getMessages: (id: string, options?: { before?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.before) params.set('before', options.before);
    if (options?.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return request<{ messages: any[]; hasMore?: boolean }>(`/conversations/${id}/messages${query ? `?${query}` : ''}`);
  },
  sendMessage: (id: string, content: string) =>
    request<{ message: any }>(`/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  deleteMessage: (conversationId: string, messageId: string) =>
    request<{ success: boolean }>(`/conversations/${conversationId}/messages/${messageId}`, {
      method: 'DELETE',
    }),
};

// Spaces
export const spaces = {
  list: () => request<{ spaces: any[] }>('/spaces'),
  create: (data: { name: string; description?: string; instructions?: string; agentIds?: string[] }) =>
    request<{ space: any }>('/spaces', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  get: (id: string) => request<{ space: any }>(`/spaces/${id}`),
  update: (id: string, data: { name?: string; description?: string | null; instructions?: string | null; hostAgentId?: string | null }) =>
    request<{ space: any }>(`/spaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/spaces/${id}`, {
      method: 'DELETE',
    }),
  members: (id: string) => request<{ members: any[] }>(`/spaces/${id}/members`),
  addMember: (id: string, data: { agentId: string; roleName?: string }) =>
    request<{ member: any }>(`/spaces/${id}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  removeMember: (spaceId: string, memberId: string) =>
    request<{ success: boolean }>(`/spaces/${spaceId}/members/${memberId}`, {
      method: 'DELETE',
    }),
  messages: (id: string, options?: { before?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.before) params.set('before', options.before);
    if (options?.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return request<{ messages: any[]; hasMore?: boolean }>(`/spaces/${id}/messages${query ? `?${query}` : ''}`);
  },
  deleteMessage: (spaceId: string, messageId: string) =>
    request<{ success: boolean }>(`/spaces/${spaceId}/messages/${messageId}`, { method: 'DELETE' }),
  files: (id: string) => request<{ files: any[] }>(`/spaces/${id}/files`),
  downloadFile: async (spaceId: string, fileId: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const res = await fetch(`${API_BASE}/spaces/${spaceId}/files/${fileId}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }
    return res.blob();
  },
  readFileText: (spaceId: string, fileId: string) =>
    request<{ content: string; updatedAt: string | null; readOnlyReason: string | null }>(
      `/spaces/${spaceId}/files/${fileId}?mode=edit`
    ),
  updateFileText: (spaceId: string, fileId: string, content: string, updatedAt: string | null) =>
    request<{ file: any }>(`/spaces/${spaceId}/files/${fileId}`, {
      method: 'PUT',
      body: JSON.stringify({ content, updatedAt }),
    }),
  runs: (id: string) => request<{ runs: AgentRun[] }>(`/spaces/${id}/runs`),
  createRun: (
    id: string,
    input: string,
    proposalMessageId?: string,
    revisedProposal?: { goal: string; steps: string[]; deliverables: string[] }
  ) =>
    request<{ run: AgentRun }>(`/spaces/${id}/runs`, {
      method: 'POST',
      body: JSON.stringify({ input, proposalMessageId, revisedProposal }),
    }),
  rejectTaskProposal: (spaceId: string, messageId: string) =>
    request<{ message: any }>(`/spaces/${spaceId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'reject_task_proposal' }),
    }),
  uploadFile: async (id: string, file: File) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API_BASE}/spaces/${id}/files`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json() as Promise<{ file: any }>;
  },
  getCompressionStats: (id: string) =>
    request<{
      originalCount: number;
      originalTokens: number;
      compressedCount: number;
      compressedTokens: number;
      reductionPercentage: number;
      compressionLevel: 'none' | 'light' | 'moderate' | 'aggressive';
      budgetExceeded: boolean;
      messageCount: number;
      compressionHistory: Array<{
        timestamp: string;
        reductionPercentage: number;
        level: string;
        originalTokens: number;
        compressedTokens: number;
      }>;
      lastCompressedAt: string | null;
    }>(`/spaces/${id}/compression-stats`),
};

export const agentRuns = {
  get: (id: string) => request<{ run: AgentRun }>(`/runs/${id}`),
  cancel: (id: string) =>
    request<{ run: AgentRun }>(`/runs/${id}/cancel`, { method: 'POST' }),
  cancelTask: (runId: string, taskId: string) =>
    request<{ run: AgentRun }>(`/runs/${runId}/tasks/${taskId}/cancel`, { method: 'POST' }),
  reviewTask: (runId: string, taskId: string, action: 'approve' | 'retry' | 'skip', feedback?: string) =>
    request<{ run: AgentRun }>(`/runs/${runId}/tasks/${taskId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, feedback }),
    }),
  retry: (id: string) =>
    request<{ run: AgentRun }>(`/runs/${id}/retry`, { method: 'POST' }),
};

// Favorites
export const favorites = {
  list: () => request<{ favorites: any[] }>('/favorites'),
  add: (agentId: string, source: 'builtin' | 'custom' = 'custom') =>
    request<{ favorite: any }>('/favorites', {
      method: 'POST',
      body: JSON.stringify({ agentId, source }),
    }),
  remove: (agentId: string, source: 'builtin' | 'custom' = 'custom') =>
    request<{ success: boolean }>(`/favorites/${agentId}?source=${source}`, {
      method: 'DELETE',
    }),
};

// Admin
export const admin = {
  dashboard: () => request<{ admin: any; stats: any; recentUsers: any[]; recentAgents: any[] }>('/admin'),
  users: (query?: string) => request<{ users: any[] }>(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  createUser: (data: { email: string; password: string; name: string; dailyChatLimit?: number | null }) =>
    request<{ user: any }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  user: (id: string) => request<{ user: any }>(`/admin/users/${id}`),
  updateUser: (id: string, data: { password?: string; dailyChatLimit?: number | null }) =>
    request<{ success: boolean }>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  resetUserPassword: (id: string, password: string) => admin.updateUser(id, { password }),
  deleteUser: (id: string) =>
    request<{ success: boolean }>(`/admin/users/${id}`, {
      method: 'DELETE',
    }),
  agents: (query?: string) => request<{ agents: any[] }>(`/admin/agents${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  updateAgent: (id: string, data: { isPublic: boolean }) =>
    request<{ agent: any }>(`/admin/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteAgent: (id: string) =>
    request<{ success: boolean }>(`/admin/agents/${id}`, {
      method: 'DELETE',
    }),
};

// AI Chat (streaming)
export async function streamChat(data: {
  message: string;
  history: { role: string; content: string }[];
  attachments?: { type: 'image'; url: string; name?: string; mimeType?: string; size?: number }[];
  context?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  modelName?: string;
  agentSnapshot?: {
    name?: string;
    avatar?: string;
    category?: string;
    tone?: string;
    description?: string;
    systemPrompt?: string;
  };
  conversationId?: string;
  agentId?: string;
  contextMessageLimit?: number;
  skipPersistUserMessage?: boolean;
  webSearchEnabled?: boolean;
  knowledgeEnabled?: boolean;
  signal?: AbortSignal;
}): Promise<{ stream: ReadableStream<Uint8Array>; conversationId?: string }> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    signal: data.signal,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `Chat request failed: ${res.status}` }));
    throw new Error(error.error || `Chat request failed: ${res.status}`);
  }

  const conversationId = res.headers.get('x-conversation-id') || undefined;
  return { stream: res.body!, conversationId };
}

export async function streamSpaceMessage(data: {
  spaceId: string;
  message: string;
  history: { role: string; content: string; speakerAgentId?: string | null }[];
  targetAgentId?: string;
  skipPersistUserMessage?: boolean;
  signal?: AbortSignal;
}): Promise<{ stream: ReadableStream<Uint8Array>; speakerAgentId?: string; speakerAgentName?: string; workspaceFilesChanged: number }> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const res = await fetch(`${API_BASE}/spaces/${data.spaceId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message: data.message,
      history: data.history,
      targetAgentId: data.targetAgentId,
      skipPersistUserMessage: data.skipPersistUserMessage,
    }),
    signal: data.signal,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `Space message failed: ${res.status}` }));
    throw new Error(error.error || `Space message failed: ${res.status}`);
  }

  return {
    stream: res.body!,
    speakerAgentId: res.headers.get('x-speaker-agent-id') || undefined,
    speakerAgentName: decodeURIComponent(res.headers.get('x-speaker-agent-name') || ''),
    workspaceFilesChanged: Number.parseInt(res.headers.get('x-workspace-files-changed') || '0', 10) || 0,
  };
}

// User
export const user = {
  get: () => request<{ user: any }>('/user'),
  update: (data: {
    name?: string | null;
    avatar?: string | null;
    apiBaseUrl?: string | null;
    apiKey?: string | null;
    modelName?: string | null;
    customModelEnabled?: boolean;
    tavilyApiKey?: string | null;
    defaultStyle?: string | null;
    contextMessageLimit?: number;
  }) =>
    request<{ user: any }>('/user', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  testModel: (data: { apiBaseUrl: string; apiKey: string; modelName: string }) =>
    request<{ ok: boolean; message: string }>('/user/test-model', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Uploads
export const uploads = {
  image: async (file: File) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${API_BASE}/uploads/images`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json() as Promise<{ attachment: { type: 'image'; url: string; name?: string; mimeType?: string; size?: number } }>;
  },
};
