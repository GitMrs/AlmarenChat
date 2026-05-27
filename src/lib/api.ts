const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

function setToken(token: string) {
  localStorage.setItem('token', token);
}

function clearToken() {
  localStorage.removeItem('token');
}

async function request(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Auth
export async function register(email: string, password: string, name: string) {
  const data = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
  setToken(data.token);
  return data;
}

export async function login(email: string, password: string) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export function logout() {
  clearToken();
}

export async function getMe() {
  return request('/auth/me');
}

// Users
export async function getUsers() {
  return request('/users');
}

export async function searchUsers(query: string) {
  return request(`/users/search?q=${encodeURIComponent(query)}`);
}

export async function updateProfile(data: { name?: string; avatar?: string }) {
  return request('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Friends
export async function getFriends() {
  return request('/friends');
}

export async function getFriendRequests() {
  return request('/friends/requests');
}

export async function sendFriendRequest(userId: string) {
  return request(`/friends/request/${userId}`, { method: 'POST' });
}

export async function acceptFriendRequest(friendshipId: string) {
  return request(`/friends/accept/${friendshipId}`, { method: 'POST' });
}

export async function rejectFriendRequest(friendshipId: string) {
  return request(`/friends/reject/${friendshipId}`, { method: 'POST' });
}

export async function deleteFriend(userId: string) {
  return request(`/friends/${userId}`, { method: 'DELETE' });
}

// Chats
export async function getChats() {
  return request('/chats');
}

export async function createChat(data: { targetUserId?: string; agentId?: string; title?: string }) {
  return request('/chats', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getChatDetail(chatId: string) {
  return request(`/chats/${chatId}`);
}

export async function getMessages(chatId: string, cursor?: string) {
  const params = cursor ? `?cursor=${cursor}` : '';
  return request(`/chats/${chatId}/messages${params}`);
}

export async function sendMessage(chatId: string, content: string, type = 'text') {
  return request(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, type }),
  });
}

// Agents
export async function getAgents() {
  return request('/agents');
}

export async function createAgent(data: { name: string; avatar?: string; description?: string; systemPrompt?: string; apiBaseUrl?: string; apiKey?: string; modelName?: string }) {
  return request('/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateAgent(agentId: string, data: { name?: string; avatar?: string; description?: string; systemPrompt?: string; apiBaseUrl?: string; apiKey?: string; modelName?: string }) {
  return request(`/agents/${agentId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(agentId: string) {
  return request(`/agents/${agentId}`, { method: 'DELETE' });
}

export async function getAgentDetail(agentId: string) {
  return request(`/agents/${agentId}`);
}

// AI Chat (streaming)
export async function streamChat(message: string, history: any[], context?: string, agentConfig?: { apiBaseUrl?: string; apiKey?: string; modelName?: string }) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, history, context, ...agentConfig }),
  });

  if (!res.ok) {
    throw new Error(`Chat request failed: ${res.status}`);
  }

  return res.body;
}

export { getToken, setToken, clearToken };
