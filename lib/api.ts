import type { AgentGrowthProfile, AgentRun, AssistantConversationSummary, AssistantExperienceMessage, AssistantMemoryItem, AssistantQQBinding, AssistantReminder, AssistantReminderCandidate, Message, MessageAttachment, PersonalAssistantBootstrap, PersonalAssistantProfile, SpaceActionRequest, SpaceAutomation, SpaceConnector, SpaceDiscussion, SpaceFileShare, SpaceOperationOutcome, SpaceOperationsSummary, SpaceRelay, SpaceSkill, SpaceSkillPreview, SpaceTaskProposal, SpaceWork, SpaceWorkVersion, SpaceMcpServer } from '@/types';

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

export const assistant = {
  get: () => request<PersonalAssistantBootstrap>('/assistant'),
  getExperience: (experienceId: string) =>
    request<{ experience: { id: string; messages: AssistantExperienceMessage[] } }>(`/assistant/experiences/${experienceId}`),
  getQQBinding: () => request<{ binding: AssistantQQBinding | null }>('/assistant/qq'),
  saveQQBinding: (data: { appId: string; appSecret: string }) =>
    request<{ binding: AssistantQQBinding }>('/assistant/qq', { method: 'PUT', body: JSON.stringify(data) }),
  updateQQBinding: (data: { enabled?: boolean; action?: 'reset-peer' }) =>
    request<{ binding: AssistantQQBinding }>('/assistant/qq', { method: 'PATCH', body: JSON.stringify(data) }),
  deleteQQBinding: () => request<{ success: true }>('/assistant/qq', { method: 'DELETE' }),
  listConversations: () =>
    request<{ conversations: AssistantConversationSummary[]; currentConversationId: string }>('/assistant/conversations'),
  newConversation: (title?: string) =>
    request<{ conversationId: string; conversationMode: 'TEMPORARY'; messages: Message[] }>('/assistant/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  switchConversation: (conversationId: string) =>
    request<{ conversationId: string; conversationMode: 'MAIN' | 'TEMPORARY'; messages: Message[] }>(`/assistant/conversations/${conversationId}`, {
      method: 'POST',
    }),
  deleteConversation: (conversationId: string) =>
    request<{ success: true; currentConversationId: string; messages?: Message[] }>(`/assistant/conversations/${conversationId}`, {
      method: 'DELETE',
    }),
  updateProfile: (data: Partial<PersonalAssistantProfile>) =>
    request<{ profile: PersonalAssistantProfile }>('/assistant/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  addMemory: (data: { content: string; category?: string }) =>
    request<{ memory: AssistantMemoryItem }>('/assistant/memories', { method: 'POST', body: JSON.stringify(data) }),
  updateMemory: (id: string, data: { content?: string; status?: 'ACTIVE' | 'DISABLED' }) =>
    request<{ memory: AssistantMemoryItem }>(`/assistant/memories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMemory: (id: string) =>
    request<{ success: true }>(`/assistant/memories/${id}`, { method: 'DELETE' }),
  clearAllMemories: () =>
    request<{ success: true }>('/assistant/memories', { method: 'DELETE' }),
  extractMemories: (data: {
    mode: 'single' | 'conversation';
    userMessage?: string;
    assistantMessage?: string;
    conversationId?: string;
    localOnly?: boolean;
    localResponse?: string;
  }) =>
    request<{
      suggestions: Array<{ content: string; category: string }>;
      modelMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    }>('/assistant/memories/extract', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getProactiveGreeting: (modelSource: 'ONLINE' | 'OLLAMA' = 'ONLINE', allowNew = true) =>
    request<{
      shouldGreet: boolean;
      recovered?: boolean;
      deliveryId?: string;
      greeting?: string;
      expiresAt?: string;
      modelMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      assistantName?: string;
      assistantAvatar?: string;
      hour?: number;
      reason?: string;
      retryAfterMs?: number;
      backoffLevel?: number;
    }>(`/assistant/proactive?modelSource=${modelSource}&allowNew=${allowNew}`),
  completeLocalProactiveGreeting: (deliveryId: string, localResponse: string) =>
    request<{ shouldGreet: boolean; greeting?: string; reason?: string }>('/assistant/proactive', {
      method: 'POST',
      body: JSON.stringify({ deliveryId, localResponse, action: 'complete-local' }),
    }),
  markProactiveGreetingShown: (deliveryId: string) =>
    request<{ success: true }>('/assistant/proactive', {
      method: 'POST',
      body: JSON.stringify({ deliveryId, action: 'shown' }),
    }),
  skipProactiveGreeting: (deliveryId: string) =>
    request<{ success: true }>('/assistant/proactive', {
      method: 'POST',
      body: JSON.stringify({ deliveryId, action: 'skip' }),
    }),
  acceptProactiveGreeting: (deliveryId: string) =>
    request<{ message: Message }>('/assistant/proactive', {
      method: 'POST',
      body: JSON.stringify({ deliveryId }),
    }),
  dismissProactiveGreeting: (deliveryId: string) =>
    request<{ success: true }>('/assistant/proactive', {
      method: 'POST',
      body: JSON.stringify({ deliveryId, action: 'dismiss' }),
    }),
  expireProactiveGreeting: (deliveryId: string) =>
    request<{ success: true }>('/assistant/proactive', {
      method: 'POST',
      body: JSON.stringify({ deliveryId, action: 'expire' }),
    }),
  listReminders: () =>
    request<{ reminders: AssistantReminder[] }>('/assistant/reminders'),
  createReminder: (data: { content: string; dueTime?: string | null }) =>
    request<{ reminder: AssistantReminder }>('/assistant/reminders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createReminders: (
    items: AssistantReminderCandidate[],
    source: { sourceMessageId: string; idempotencyKey: string }
  ) =>
    request<{ reminder: AssistantReminder; reminders: AssistantReminder[] }>('/assistant/reminders', {
      method: 'POST',
      body: JSON.stringify({ items, ...source }),
    }),
  updateReminder: (data: { id: string; status?: 'PENDING' | 'COMPLETED' | 'DISMISSED'; snoozeMinutes?: number; dueTime?: string | null; content?: string }) =>
    request<{ reminder: AssistantReminder }>('/assistant/reminders', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteReminder: (id: string) =>
    request<{ success: boolean; id: string }>('/assistant/reminders', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    }),
  parseReminder: (data: { userMessage: string; localOnly?: boolean; localResponse?: string }) =>
    request<{
      hasReminder: boolean;
      explicit?: boolean;
      candidates?: AssistantReminderCandidate[];
      modelMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    }>('/assistant/reminders/parse', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  sendMessage: async (data: {
    message: string;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    webSearchEnabled: boolean;
    attachments?: MessageAttachment[];
    signal?: AbortSignal;
  }) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    return fetch(`${API_BASE}/assistant/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        message: data.message,
        conversationId: data.conversationId,
        userMessageId: data.userMessageId,
        assistantMessageId: data.assistantMessageId,
        webSearchEnabled: data.webSearchEnabled,
        attachments: data.attachments,
      }),
      signal: data.signal,
    });
  },
  prepareLocalMessage: (data: {
    message: string;
    conversationId: string;
    userMessageId: string;
    attachments?: MessageAttachment[];
    signal?: AbortSignal;
  }) =>
    request<{
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }>;
      conversationId: string;
      conversationMode: 'MAIN' | 'TEMPORARY';
    }>('/assistant/messages', {
      method: 'POST',
      body: JSON.stringify({
        operation: 'prepare-local',
        message: data.message,
        conversationId: data.conversationId,
        userMessageId: data.userMessageId,
        attachments: data.attachments,
        webSearchEnabled: false,
      }),
      signal: data.signal,
    }),
  persistLocalMessage: (conversationId: string, content: string, assistantMessageId: string) =>
    request<{ message: Message }>('/assistant/messages', {
      method: 'POST',
      body: JSON.stringify({ operation: 'persist-local', conversationId, content, assistantMessageId }),
    }),
  deleteMessage: (messageId: string, conversationId: string) =>
    request<{ success: boolean }>('/assistant/messages', {
      method: 'DELETE',
      body: JSON.stringify({ messageId, conversationId }),
    }),
  clearMessages: (conversationId: string) =>
    request<{ success: boolean }>('/assistant/messages', {
      method: 'DELETE',
      body: JSON.stringify({ conversationId }),
    }),
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
  growth: (id: string) => request<AgentGrowthProfile>(`/agents/${id}/memory`),
  addGrowthRule: (id: string, data: { category: string; title: string; instruction: string }) =>
    request<AgentGrowthProfile>(`/agents/${id}/memory`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateGrowthRule: (id: string, data: { id: string; action: string; category?: string; title?: string; instruction?: string }) =>
    request<AgentGrowthProfile>(`/agents/${id}/memory`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteGrowthRule: (id: string, ruleId: string) =>
    request<AgentGrowthProfile>(`/agents/${id}/memory?id=${encodeURIComponent(ruleId)}`, { method: 'DELETE' }),
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
  clearMessages: (conversationId: string) =>
    request<{ success: boolean }>(`/conversations/${conversationId}/messages`, {
      method: 'DELETE',
    }),
};

// Spaces
export const spaces = {
  list: () => request<{ spaces: any[] }>('/spaces'),
  create: (data: { name: string; description?: string; instructions?: string; executionEngine?: 'native' | 'pi'; executionMode?: 'AUTO' | 'REVIEW_DISPATCH'; agentIds?: string[]; templateId?: string | null }) =>
    request<{ space: any }>('/spaces', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  get: (id: string) => request<{ space: any }>(`/spaces/${id}`),
  update: (id: string, data: { name?: string; description?: string | null; instructions?: string | null; executionEngine?: 'native' | 'pi'; executionMode?: 'AUTO' | 'REVIEW_DISPATCH'; hostAgentId?: string | null; activeWorkId?: string | null }) =>
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
      deleted: { messages: number; files: number; memories: number; sessions: number; discussions: number; relays: number; runs: number };
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
  cancelPi: (id: string) =>
    request<{ cancelled: boolean }>(`/spaces/${id}/pi/cancel`, { method: 'POST' }),
  resolvePiSkillApproval: (id: string, approvalId: string, approved: boolean) =>
    request<{ resolved: boolean }>(`/spaces/${id}/pi/approval`, {
      method: 'POST',
      body: JSON.stringify({ approvalId, approved }),
    }),
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
  relays: (id: string) =>
    request<{ relays: SpaceRelay[] }>(`/spaces/${id}/relays`),
  createRelay: (
    id: string,
    data: { kind: 'collaboration' | 'gomoku'; goal: string; participantIds: string[]; approvalMode: 'AUTO' | 'EACH_TURN'; maxTurns: number; completionCriteria?: string[] }
  ) => request<{ relay: SpaceRelay }>(`/spaces/${id}/relays`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateRelay: (spaceId: string, relayId: string, action: 'cancel' | 'approve' | 'reject') =>
    request<{ relay: SpaceRelay }>(`/spaces/${spaceId}/relays/${relayId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
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
  deleteFile: (spaceId: string, fileId: string) =>
    request<{ success: boolean }>(`/spaces/${spaceId}/files/${fileId}`, { method: 'DELETE' }),
  createFilePreview: (spaceId: string, fileId: string, options?: { externalImages?: boolean; externalDependencies?: boolean }) =>
    request<{ url: string; rootUrl: string }>(`/spaces/${spaceId}/files/${fileId}/preview`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    }),
  getFileShare: (spaceId: string, fileId: string) =>
    request<{ enabled: boolean; url: string | null; externalDependencies: boolean }>(`/spaces/${spaceId}/files/${fileId}/share`),
  enableFileShare: (spaceId: string, fileId: string, options?: { externalDependencies?: boolean }) =>
    request<{ enabled: boolean; url: string; externalDependencies: boolean }>(`/spaces/${spaceId}/files/${fileId}/share`, {
      method: 'PUT',
      body: JSON.stringify(options || {}),
    }),
  disableFileShare: (spaceId: string, fileId: string) =>
    request<{ enabled: false; url: null; externalDependencies: boolean }>(`/spaces/${spaceId}/files/${fileId}/share`, { method: 'DELETE' }),
  updateFileText: (spaceId: string, fileId: string, content: string, updatedAt: string | null) =>
    request<{ file: any }>(`/spaces/${spaceId}/files/${fileId}`, {
      method: 'PUT',
      body: JSON.stringify({ content, updatedAt }),
    }),
  runs: (id: string) => request<{ runs: AgentRun[] }>(`/spaces/${id}/runs`),
  works: (id: string) => request<{ works: SpaceWork[] }>(`/spaces/${id}/works`),
  createWork: (spaceId: string, data: { title: string; objective?: string; kind?: string }) =>
    request<{ work: SpaceWork }>(`/spaces/${spaceId}/works`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  renameWork: (spaceId: string, workId: string, title: string) =>
    request<{ work: SpaceWork }>(`/spaces/${spaceId}/works/${workId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  updateWork: (spaceId: string, workId: string, data: { title?: string; objective?: string | null; stage?: string | null; status?: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' }) =>
    request<{ work: SpaceWork }>(`/spaces/${spaceId}/works/${workId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  workVersions: (spaceId: string, workId: string) =>
    request<{ versions: SpaceWorkVersion[] }>(`/spaces/${spaceId}/works/${workId}/versions`),
  createWorkVersion: (spaceId: string, workId: string, data: { summary?: string; runId?: string; taskId?: string } = {}) =>
    request<{ version: SpaceWorkVersion }>(`/spaces/${spaceId}/works/${workId}/versions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  restoreWorkVersion: (spaceId: string, workId: string, versionId: string) =>
    request<{ restored: true; version: SpaceWorkVersion }>(`/spaces/${spaceId}/works/${workId}/versions/${versionId}/restore`, {
      method: 'POST',
    }),
  automations: (spaceId: string) =>
    request<{ automations: SpaceAutomation[] }>(`/spaces/${spaceId}/automations`),
  createAutomation: (spaceId: string, data: { name: string; prompt: string; scheduleType: 'INTERVAL' | 'DAILY' | 'WEEKLY'; intervalMinutes: number; timeZone: string; scheduleHour?: number; scheduleMinute?: number; weekdays?: number[]; workStrategy: 'NEW_WORK' | 'ACTIVE_WORK'; networkPolicy: 'forbidden' | 'allowed' | 'required'; completionAction?: 'NONE' | 'WECHAT_CREATE_DRAFT'; completionConfig?: { themeId?: string } | null; enabled: boolean }) =>
    request<{ automation: SpaceAutomation }>(`/spaces/${spaceId}/automations`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAutomation: (spaceId: string, automationId: string, data: Partial<Pick<SpaceAutomation, 'name' | 'prompt' | 'scheduleType' | 'intervalMinutes' | 'timeZone' | 'scheduleHour' | 'scheduleMinute' | 'weekdays' | 'workStrategy' | 'networkPolicy' | 'completionAction' | 'completionConfig' | 'enabled' | 'nextRunAt'>>) =>
    request<{ automation: SpaceAutomation }>(`/spaces/${spaceId}/automations/${automationId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  triggerAutomation: (spaceId: string, automationId: string) =>
    request<{ automation: SpaceAutomation }>(`/spaces/${spaceId}/automations/${automationId}/trigger`, { method: 'POST' }),
  deleteAutomation: (spaceId: string, automationId: string) =>
    request<{ success: true }>(`/spaces/${spaceId}/automations/${automationId}`, { method: 'DELETE' }),
  actions: (spaceId: string) => request<{ actions: SpaceActionRequest[] }>(`/spaces/${spaceId}/actions`),
  operations: (spaceId: string) => request<{ summary: SpaceOperationsSummary; recentOutcomes: SpaceOperationOutcome[] }>(`/spaces/${spaceId}/operations`),
  requestWechatDraft: (spaceId: string, data: { articleFileId: string; coverFileId: string; themeId: string; requestId: string }) =>
    request<{ action: SpaceActionRequest }>(`/spaces/${spaceId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'WECHAT_CREATE_DRAFT', ...data }),
    }),
  decideAction: (spaceId: string, actionId: string, decision: 'approve' | 'reject', reason?: string) =>
    request<{ action: SpaceActionRequest; work?: SpaceWork | null; followUpAction?: SpaceActionRequest | null }>(`/spaces/${spaceId}/actions/${actionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, reason }),
    }),
  retryConnectorActionStatus: (spaceId: string, actionId: string) =>
    request<{ action: SpaceActionRequest }>(`/spaces/${spaceId}/actions/${actionId}/retry`, { method: 'POST' }),
  connectors: (spaceId: string) =>
    request<{ connectors: SpaceConnector[] }>(`/spaces/${spaceId}/connectors`),
  mcpServers: (spaceId: string) =>
    request<{ servers: SpaceMcpServer[] }>(`/spaces/${spaceId}/mcp`),
  addMcpServer: (spaceId: string, data: { name: string; url: string; headers?: Record<string, string> }) =>
    request<{ server: SpaceMcpServer }>(`/spaces/${spaceId}/mcp`, { method: 'POST', body: JSON.stringify(data) }),
  setMcpServerEnabled: (spaceId: string, serverId: string, enabled: boolean) =>
    request<{ success: true }>(`/spaces/${spaceId}/mcp/${serverId}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  removeMcpServer: (spaceId: string, serverId: string) =>
    request<{ success: true }>(`/spaces/${spaceId}/mcp/${serverId}`, { method: 'DELETE' }),
  configureWechatConnector: (spaceId: string, data: { appId: string; appSecret?: string }) =>
    request<{ connector: SpaceConnector }>(`/spaces/${spaceId}/connectors/wechat`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  validateWechatConnector: (spaceId: string, requestId: string) =>
    request<{ connector: SpaceConnector; action: SpaceActionRequest }>(`/spaces/${spaceId}/connectors/wechat/validate`, {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),
  wechatPublications: (spaceId: string) =>
    request<{ actions: SpaceActionRequest[] }>(`/spaces/${spaceId}/connectors/wechat/publications`),
  setWechatConnectorEnabled: (spaceId: string, enabled: boolean) =>
    request<{ connector: SpaceConnector }>(`/spaces/${spaceId}/connectors/wechat`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  removeWechatConnector: (spaceId: string) =>
    request<{ success: true }>(`/spaces/${spaceId}/connectors/wechat`, { method: 'DELETE' }),
  createRun: (
    id: string,
    input: string,
    proposalMessageId?: string,
    revisedProposal?: { goal: string; steps: string[]; deliverables: string[]; networkPolicy: 'forbidden' | 'allowed' | 'required' },
    workId?: string
  ) =>
    request<{ run: AgentRun; proposal?: SpaceTaskProposal }>(`/spaces/${id}/runs`, {
      method: 'POST',
      body: JSON.stringify({ input, proposalMessageId, revisedProposal, workId }),
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
      checkpoint: {
        updatedAt: string;
        sourceMessageCount: number;
        sourceTokenCount: number;
        throughMessageId: string;
      } | null;
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
  resume: (id: string, answer = '', iterations?: number) =>
    request<{ run: AgentRun }>(`/runs/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify({ answer, iterations }),
    }),
  retry: (id: string) =>
    request<{ run: AgentRun }>(`/runs/${id}/retry`, { method: 'POST' }),
  retryTask: (runId: string, taskId: string) =>
    request<{ run: AgentRun; inheritedWorkspace: boolean }>(`/runs/${runId}/tasks/${taskId}/retry`, { method: 'POST' }),
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
  interactionMode?: 'chat' | 'multi_reply' | 'coordinated_turn' | 'coordination_summary';
  coordinationScope?: {
    scopeId: string;
    mode: 'broadcast' | 'discussion' | 'review' | 'decision' | 'relay';
    topic: string;
    participantIds: string[];
  };
  multiReplyIndex?: number;
  webSearchEnabled?: boolean;
  imageGenerationRequested?: boolean;
  skipPersistUserMessage?: boolean;
  skillId?: string;
  workId?: string;
  signal?: AbortSignal;
}): Promise<{ stream: ReadableStream<Uint8Array>; speakerAgentId?: string; speakerAgentName?: string; workspaceFilesChanged: number; streamFormat?: 'pi-ndjson' }> {
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
      coordinationScope: data.coordinationScope,
      multiReplyIndex: data.multiReplyIndex,
      webSearchEnabled: data.webSearchEnabled,
      imageGenerationRequested: data.imageGenerationRequested,
      skipPersistUserMessage: data.skipPersistUserMessage,
      skillId: data.skillId,
      workId: data.workId,
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
    streamFormat: res.headers.get('x-space-stream-format') === 'pi-ndjson' ? 'pi-ndjson' : undefined,
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
    modelContextWindow?: number;
    customModelEnabled?: boolean;
    imageModelEnabled?: boolean;
    imageModelName?: string | null;
    imageModelSize?: string | null;
    imageModelProtocol?: 'OPENAI_IMAGES' | 'OPENAI_CHAT';
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
