import type { AgentRun, AssistantMemoryItem, PersonalAssistantBootstrap, PersonalAssistantProfile, SpaceDiscussion, SpaceFileShare, SpaceSkill, SpaceSkillPreview, SpaceTaskProposal } from '@/types';

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

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Upload failed' }));
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

export type AssistantPageContext = {
  type: 'space' | 'run' | 'conversation' | 'agent';
  spaceId?: string;
  runId?: string;
  conversationId?: string;
  agentId?: string;
};

export const assistant = {
  get: () => request<PersonalAssistantBootstrap>('/assistant'),
  updateProfile: (data: Partial<PersonalAssistantProfile>) =>
    request<{ profile: PersonalAssistantProfile }>('/assistant/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  addMemory: (data: { content: string; category?: string }) =>
    request<{ memory: AssistantMemoryItem }>('/assistant/memories', { method: 'POST', body: JSON.stringify(data) }),
  updateMemory: (id: string, data: { content?: string; status?: 'ACTIVE' | 'DISABLED' }) =>
    request<{ memory: AssistantMemoryItem }>(`/assistant/memories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMemory: (id: string) =>
    request<{ success: true }>(`/assistant/memories/${id}`, { method: 'DELETE' }),
  sendMessage: async (data: {
    message: string;
    webSearchEnabled: boolean;
    sharePage: boolean;
    pageContext?: AssistantPageContext | null;
    signal?: AbortSignal;
  }) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return fetch(`${API_BASE}/assistant/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        message: data.message,
        webSearchEnabled: data.webSearchEnabled,
        sharePage: data.sharePage,
        pageContext: data.pageContext,
      }),
      signal: data.signal,
    });
  },
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
  list: (options?: { limit?: number; includeLastMessage?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.includeLastMessage === false) params.set('includeLastMessage', 'false');
    const query = params.toString();
    return request<{ conversations: any[] }>(`/conversations${query ? `?${query}` : ''}`);
  },
  get: (id: string) => request<{ conversation: any }>(`/conversations/${id}`),
  create: (data: {
    agentId: string;
    title?: string;
    agentSnapshot?: {
      name?: string;
      avatar?: string;
      category?: string;
      tone?: string;
      description?: string;
      systemPrompt?: string;
    };
  }) =>
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
  sendMessage: (
    id: string,
    content: string,
    options?: {
      role?: 'user' | 'assistant';
      attachments?: { type: 'image'; url: string; name?: string; mimeType?: string; size?: number }[];
    }
  ) =>
    request<{ message: any }>(`/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, ...options }),
    }),
  deleteMessage: (conversationId: string, messageId: string) =>
    request<{ success: boolean }>(`/conversations/${conversationId}/messages/${messageId}`, {
      method: 'DELETE',
    }),
};

// Spaces
export const spaces = {
  list: () => request<{ spaces: any[] }>('/spaces'),
  create: (data: { name: string; description?: string; instructions?: string; executionMode?: 'AUTO' | 'REVIEW_DISPATCH'; agentIds?: string[] }) =>
    request<{ space: any }>('/spaces', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  get: (id: string) => request<{ space: any }>(`/spaces/${id}`),
  update: (id: string, data: { name?: string; description?: string | null; instructions?: string | null; executionMode?: 'AUTO' | 'REVIEW_DISPATCH'; hostAgentId?: string | null }) =>
    request<{ space: any }>(`/spaces/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/spaces/${id}`, {
      method: 'DELETE',
    }),
  clearContents: (id: string) =>
    request<{
      success: boolean;
      deleted: { messages: number; files: number; memories: number; sessions: number; discussions: number; runs: number };
    }>(`/spaces/${id}/contents`, { method: 'DELETE' }),
  learning: (id: string) =>
    request<{ learning: import('@/types').SpaceLearning; readme: string }>(`/spaces/${id}/learning`),
  updateLearning: (id: string, data: import('@/types').SpaceLearningCommand) =>
    request<{ learning: import('@/types').SpaceLearning; readme: string }>(`/spaces/${id}/learning`, {
      method: 'PATCH',
      body: JSON.stringify(data),
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
  skills: (id: string) => request<{ skills: SpaceSkill[] }>(`/spaces/${id}/skills`),
  previewSkill: (id: string, sourceUrl: string) =>
    request<{ preview: SpaceSkillPreview }>(`/spaces/${id}/skills`, {
      method: 'POST',
      body: JSON.stringify({ action: 'preview', sourceUrl }),
    }),
  installSkill: (id: string, sourceUrl: string, expectedDigest: string) =>
    request<{ skill: SpaceSkill }>(`/spaces/${id}/skills`, {
      method: 'POST',
      body: JSON.stringify({ action: 'install', sourceUrl, expectedDigest }),
    }),
  previewUploadedSkill: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('action', 'preview');
    formData.append('file', file);
    return uploadRequest<{ preview: SpaceSkillPreview }>(`/spaces/${id}/skills`, formData);
  },
  installUploadedSkill: (id: string, file: File, expectedDigest: string) => {
    const formData = new FormData();
    formData.append('action', 'install');
    formData.append('expectedDigest', expectedDigest);
    formData.append('file', file);
    return uploadRequest<{ skill: SpaceSkill }>(`/spaces/${id}/skills`, formData);
  },
  updateSkillExecution: (id: string, skillId: string, approvedScripts: string[]) =>
    request<{ skill: SpaceSkill }>(`/spaces/${id}/skills`, {
      method: 'PATCH',
      body: JSON.stringify({ skillId, approvedScripts }),
    }),
  removeSkill: (id: string, skillId: string) =>
    request<{ success: boolean }>(`/spaces/${id}/skills?skillId=${encodeURIComponent(skillId)}`, { method: 'DELETE' }),
  discussions: (id: string) =>
    request<{ discussions: SpaceDiscussion[] }>(`/spaces/${id}/discussions`),
  createDiscussion: (id: string, data: { topic: string; participantIds: string[]; allowWeb: boolean }) =>
    request<{ discussion: SpaceDiscussion }>(`/spaces/${id}/discussions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateDiscussion: (
    spaceId: string,
    discussionId: string,
    data: { action: 'cancel' | 'approve_research' | 'reject_research'; scope?: 'once' | 'discussion' }
  ) => request<{ discussion: SpaceDiscussion }>(`/spaces/${spaceId}/discussions/${discussionId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
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
  createFilePreview: (spaceId: string, fileId: string, options?: { externalImages?: boolean }) =>
    request<{ url: string; rootUrl: string }>(`/spaces/${spaceId}/files/${fileId}/preview`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }),
  getFileShare: (spaceId: string, fileId: string) =>
    request<{ enabled: boolean; url: string | null }>(`/spaces/${spaceId}/files/${fileId}/share`),
  enableFileShare: (spaceId: string, fileId: string) =>
    request<{ enabled: boolean; url: string }>(`/spaces/${spaceId}/files/${fileId}/share`, { method: 'PUT' }),
  disableFileShare: (spaceId: string, fileId: string) =>
    request<{ enabled: false; url: null }>(`/spaces/${spaceId}/files/${fileId}/share`, { method: 'DELETE' }),
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
    revisedProposal?: { goal: string; steps: string[]; deliverables: string[]; networkPolicy: 'forbidden' | 'allowed' | 'required' }
  ) =>
    request<{ run: AgentRun; proposal?: SpaceTaskProposal }>(`/spaces/${id}/runs`, {
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

export const spaceShares = {
  list: () => request<{ shares: SpaceFileShare[] }>('/shares'),
};

export const agentRuns = {
  get: (id: string, afterSequence = 0) => request<{ run: AgentRun }>(
    `/runs/${id}${afterSequence > 0 ? `?afterSequence=${afterSequence}` : ''}`
  ),
  cancel: (id: string) =>
    request<{ run: AgentRun }>(`/runs/${id}/cancel`, { method: 'POST' }),
  cancelTask: (runId: string, taskId: string) =>
    request<{ run: AgentRun }>(`/runs/${runId}/tasks/${taskId}/cancel`, { method: 'POST' }),
  reviewDispatch: (
    runId: string,
    taskId: string,
    action: 'approve' | 'reject',
    revision?: { agentId: string; title: string; instruction: string; acceptanceCriteria: string },
    feedback?: string
  ) => request<{ run: AgentRun }>(`/runs/${runId}/tasks/${taskId}/dispatch`, {
    method: 'POST',
    body: JSON.stringify({ action, revision, feedback }),
  }),
  reviewTask: (runId: string, taskId: string, action: 'approve' | 'retry' | 'skip', feedback?: string) =>
    request<{ run: AgentRun }>(`/runs/${runId}/tasks/${taskId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, feedback }),
    }),
  resume: (id: string, answer: string) =>
    request<{ run: AgentRun }>(`/runs/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
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

export async function generateConversationImage(data: {
  conversationId: string;
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  skipPersistUserMessage?: boolean;
  signal?: AbortSignal;
}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const res = await fetch(`${API_BASE}/conversations/${data.conversationId}/images`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      prompt: data.prompt,
      size: data.size,
      skipPersistUserMessage: data.skipPersistUserMessage,
    }),
    signal: data.signal,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `Image generation failed: ${res.status}` }));
    throw new Error(error.error || `Image generation failed: ${res.status}`);
  }
  return res.json() as Promise<{ userMessage?: any; message: any }>;
}

export async function streamSpaceMessage(data: {
  spaceId: string;
  message: string;
  history: { role: string; content: string; speakerAgentId?: string | null }[];
  targetAgentId?: string;
  interactionMode?: 'chat' | 'multi_reply';
  webSearchEnabled?: boolean;
  skipPersistUserMessage?: boolean;
  skillId?: string;
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
      interactionMode: data.interactionMode,
      webSearchEnabled: data.webSearchEnabled,
      skipPersistUserMessage: data.skipPersistUserMessage,
      skillId: data.skillId,
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
    imageModelEnabled?: boolean;
    imageModelName?: string | null;
    imageModelSize?: string | null;
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
  models: (data: { apiBaseUrl: string; apiKey: string }) =>
    request<{ models: string[] }>('/user/models', {
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
