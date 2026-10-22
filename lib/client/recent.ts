const STORAGE_KEY = 'almaren_recent_agents';
const MAX_RECENT = 8;

interface RecentEntry {
  agentId: string;
  lastMessage: string;
  timestamp: number;
}

export function trackRecentAgent(agentId: string, lastMessage: string) {
  if (typeof window === 'undefined') return;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const entries: RecentEntry[] = stored ? JSON.parse(stored) : [];

    const filtered = entries.filter((e) => e.agentId !== agentId);
    filtered.unshift({ agentId, lastMessage, timestamp: Date.now() });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, MAX_RECENT)));
  } catch {
    // ignore localStorage errors
  }
}

export function getRecentAgentIds(): { agentId: string; lastMessage: string }[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const entries: RecentEntry[] = JSON.parse(stored);
    return entries.map((e) => ({ agentId: e.agentId, lastMessage: e.lastMessage }));
  } catch {
    return [];
  }
}
