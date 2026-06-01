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
  engineAction: (conversationId: string, actionId: string) =>
    request<{ result: any; runtimeState: any; messages?: { user: any; assistant: any } }>(`/conversations/${conversationId}/engine`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'action', actionId }),
    }),
  engineAccuse: (conversationId: string, suspectId: string, clueIds: string[]) =>
    request<{ result: any; runtimeState: any; messages?: { user: any; assistant: any } }>(`/conversations/${conversationId}/engine`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'accuse', suspectId, clueIds }),
    }),
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
