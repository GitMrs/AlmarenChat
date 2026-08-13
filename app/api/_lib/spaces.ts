import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import { getBuiltInAgents } from '@/lib/agents-data';
import type { Agent } from '@/types';

export type ResolvedSpaceAgent = Pick<
  Agent,
  'id' | 'name' | 'avatar' | 'description' | 'category' | 'tone' | 'systemPrompt'
>;

export const SPACE_COORDINATOR_ID = 'space-coordinator';

export const SPACE_COORDINATOR: ResolvedSpaceAgent = {
  id: SPACE_COORDINATOR_ID,
  name: '空间协调者',
  avatar: '🧭',
  category: '协调者',
  tone: '冷静',
  description: '空间内置调度者，负责理解用户需求、选择合适成员回应，并汇总上下文。',
  systemPrompt: `你是这个空间的协调者，不是普通成员。
你的职责是理解用户当前意图，结合空间说明和成员列表给出回应。
当用户没有 @ 具体成员时，你默认接话：可以直接回答，也可以建议由哪位成员继续处理。
当任务需要某个专业成员处理时，请明确点名建议用户 @ 对应成员；当前版本你不能自动替用户派发多轮任务。
你不冒充任何成员，不声称已经完成未实际完成的工作。`,
};

export function spaceRoot(userId: string, spaceId: string) {
  return path.join(process.cwd(), 'data', 'spaces', userId, spaceId);
}

export async function ensureSpaceRoot(userId: string, spaceId: string) {
  const root = spaceRoot(userId, spaceId);
  await mkdir(path.join(root, 'files'), { recursive: true });
  await mkdir(path.join(root, 'outputs'), { recursive: true });
  return root;
}

export function resolveSpacePath(userId: string, spaceId: string, relativePath: string) {
  const raw = String(relativePath || '').trim().replaceAll('\\', '/');
  if (!raw || raw.startsWith('/') || raw.startsWith('~') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    throw new Error('Invalid project-relative path');
  }
  const parts = raw.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Path traversal is forbidden');
  }

  const root = path.resolve(spaceRoot(userId, spaceId));
  const target = path.resolve(root, raw);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Path outside space is forbidden');
  }
  return target;
}

export async function getSpaceForUser(spaceId: string, userId: string) {
  const space = await prisma.space.findFirst({
    where: { id: spaceId, userId },
    include: {
      members: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!space) return null;
  return {
    ...space,
    hostAgent: SPACE_COORDINATOR,
  };
}

export async function resolveAgent(agentId: string, userId?: string): Promise<ResolvedSpaceAgent | null> {
  if (agentId === SPACE_COORDINATOR_ID || agentId === 'coordinator') return SPACE_COORDINATOR;

  const stored = await prisma.agent.findUnique({ where: { id: agentId } });
  if (stored && userId && !stored.isPublic && stored.creatorId !== userId) return null;
  if (stored) return stored;

  const builtIn = await getBuiltInAgents();
  return builtIn.find((agent) => agent.id === agentId) || null;
}

export async function resolveManyAgents(agentIds: string[], userId?: string) {
  const uniqueIds = [...new Set(agentIds.filter(Boolean))];
  const agents = await Promise.all(uniqueIds.map((agentId) => resolveAgent(agentId, userId)));
  return agents.filter(Boolean) as ResolvedSpaceAgent[];
}

export function resolveMentionTarget(content: string, agents: ResolvedSpaceAgent[]) {
  if (!content.includes('@')) return null;

  const candidates = agents
    .flatMap((agent) => [
      { agent, alias: agent.name },
      { agent, alias: agent.id },
    ])
    .filter((item) => item.alias)
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { agent, alias } of candidates) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`@${escaped}(?=$|\\s|[，。！？、,.;；:：])`, 'i');
    if (pattern.test(content)) return agent;
  }

  return null;
}

export function formatMembersContext(agents: ResolvedSpaceAgent[], targetAgent: ResolvedSpaceAgent) {
  const workers = agents.filter((agent) => agent.id !== SPACE_COORDINATOR_ID);
  const members = workers
    .map((agent) => `- ${agent.name}${agent.category ? `（${agent.category}）` : ''}: ${agent.description || '暂无描述'}`)
    .join('\n');

  return `你正在一个名为“空间”的多 Agent 会话中发言。
当前轮到你以「${targetAgent.name}」的身份回复用户。
你只代表自己发言，不要冒充其他 Agent。
如果你是空间协调者：没有 @ 时由你默认接话，负责理解需求、给出下一步建议，必要时建议用户 @ 具体成员。
如果你是普通成员：用户 @ 了你时，请直接回应用户当前问题；如果提到其他成员，可以引用他们的名字但不要替他们发言。

当前普通成员：
${members || '- 暂无普通成员。'}`;
}
