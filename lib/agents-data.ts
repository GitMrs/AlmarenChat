import type { Agent } from '@/types';

const CATEGORY_MAP: Record<string, string> = {
  academic: '奇幻冒险',
  career: '都市剧情',
  copywriting: '浪漫言情',
  design: '奇幻冒险',
  education: '奇幻冒险',
  emotions: '心理博弈',
  entertainment: '喜剧搞笑',
  games: '社交推理',
  general: '都市剧情',
  life: '都市剧情',
  marketing: '浪漫言情',
  office: '都市剧情',
  programming: '科幻探索',
  translation: '浪漫言情',
};

const CATEGORY_TONE_MAP: Record<string, string> = {
  悬疑推理: '悬疑',
  浪漫言情: '浪漫',
  奇幻冒险: '史诗',
  都市剧情: '沉浸',
  社交推理: '紧张',
  心理博弈: '黑暗',
  喜剧搞笑: '幽默',
  恐怖惊悚: '紧张',
  科幻探索: '沉浸',
};

export interface RawAgent {
  identifier: string;
  meta: {
    avatar: string;
    description: string;
    tags: string[];
    title: string;
    category: string;
  };
  description?: string;
}

export function transformAgent(raw: RawAgent): Agent {
  const category = CATEGORY_MAP[raw.meta.category] || '都市剧情';

  return {
    id: raw.identifier,
    name: raw.meta.title,
    avatar: raw.meta.avatar,
    description: raw.meta.description,
    category,
    tone: CATEGORY_TONE_MAP[category] || '沉浸',
    greeting: `你好，我是 ${raw.meta.title}。${raw.meta.description}`,
    systemPrompt: raw.description || '',
    isPublic: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: raw.meta.tags,
  };
}

let agentsCache: Agent[] | null = null;

export async function getBuiltInAgents(): Promise<Agent[]> {
  if (agentsCache) return agentsCache;

  try {
    const rawAgents: RawAgent[] = await import('@/src/lib/agent.json').then((m) => m.default);
    agentsCache = rawAgents.map(transformAgent);
    return agentsCache;
  } catch {
    return [];
  }
}

export function getAgentsByCategory(agents: Agent[], category: string): Agent[] {
  if (category === '全部') return agents;
  return agents.filter((agent) => agent.category === category);
}

export function searchAgents(agents: Agent[], query: string): Agent[] {
  const q = query.toLowerCase();

  return agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(q) ||
      agent.description?.toLowerCase().includes(q) ||
      agent.category?.toLowerCase().includes(q)
  );
}

export function getFeaturedAgents(agents: Agent[], count = 1): Agent[] {
  const categories = ['悬疑推理', '浪漫言情', '奇幻冒险', '都市剧情', '社交推理', '心理博弈', '喜剧搞笑', '恐怖惊悚', '科幻探索'];
  const featured: Agent[] = [];

  for (const category of categories) {
    const categoryAgents = agents.filter((agent) => agent.category === category);
    featured.push(...categoryAgents.slice(0, count));
  }

  return featured;
}

export function getAgentsGroupedByCategory(agents: Agent[]): Record<string, Agent[]> {
  const groups: Record<string, Agent[]> = {};

  for (const agent of agents) {
    const category = agent.category || '其他';
    if (!groups[category]) groups[category] = [];
    groups[category].push(agent);
  }

  return groups;
}
