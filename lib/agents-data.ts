import type { Agent } from '@/types';

const CATEGORY_MAP: Record<string, string> = {
  academic: '学习',
  career: '生活',
  copywriting: '写作',
  design: '创意',
  education: '学习',
  emotions: '心理',
  entertainment: '娱乐',
  games: '娱乐',
  general: '工具',
  life: '生活',
  marketing: '写作',
  office: '工具',
  programming: '编程',
  translation: '写作',
};

const CATEGORY_TONE_MAP: Record<string, string> = {
  学习: '专业',
  写作: '详细',
  编程: '冷静',
  心理: '温柔',
  创意: '热情',
  生活: '友好',
  工具: '简洁',
  娱乐: '幽默',
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
  const category = CATEGORY_MAP[raw.meta.category] || '工具';

  return {
    id: raw.identifier,
    name: raw.meta.title,
    avatar: raw.meta.avatar,
    description: raw.meta.description,
    category,
    tone: CATEGORY_TONE_MAP[category] || '专业',
    greeting: `你好，我是 ${raw.meta.title}。${raw.meta.description}`,
    systemPrompt: raw.description || '',
    isPublic: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
  const categories = ['写作', '编程', '学习', '心理', '创意', '生活', '工具', '娱乐'];
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
