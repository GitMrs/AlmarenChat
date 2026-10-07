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
  description: '空间内置调度者，负责理解用户需求、组织成员执行任务并汇总交付结果。',
  systemPrompt: `你是这个空间的协调者，不是普通成员。
你的职责是理解用户当前意图，结合空间说明和成员列表给出回应。
当用户没有 @ 具体成员时，你默认接话：普通聊天可以直接回答；需要专业成员形成可验收交付结果时，应生成任务方案。
任务方案经用户确认后，运行时 Coordinator 会根据空间实时成员、依赖关系和执行结果自主派发，你不应要求用户另行 @ 成员。
你不冒充任何成员，不声称已经完成未实际完成的工作。`,
};

export function spaceRoot(userId: string, spaceId: string) {
  return path.join(process.cwd(), 'data', 'spaces', userId, spaceId);
}

export async function ensureSpaceRoot(userId: string, spaceId: string) {
  const root = spaceRoot(userId, spaceId);
  await mkdir(path.join(root, 'files'), { recursive: true });
  await mkdir(path.join(root, 'outputs'), { recursive: true });
  await Promise.all([
    mkdir(path.join(root, 'workspace', 'foundation'), { recursive: true }),
    mkdir(path.join(root, 'workspace', 'inbox'), { recursive: true }),
    mkdir(path.join(root, 'workspace', 'shared'), { recursive: true }),
    mkdir(path.join(root, 'workspace', 'archive'), { recursive: true }),
    mkdir(path.join(root, 'workspace', 'logs'), { recursive: true }),
  ]);
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
  return resolveMentionTargets(content, agents)[0] || null;
}

export function resolveMentionTargets(content: string, agents: ResolvedSpaceAgent[]) {
  if (!content.includes('@')) return [];

  const shortNameCounts = new Map<string, number>();
  for (const agent of agents) {
    const shortName = agent.name.split(/[·•\-_(（]/)[0].trim();
    if (shortName && shortName !== agent.name && shortName.length >= 2) {
      shortNameCounts.set(shortName, (shortNameCounts.get(shortName) || 0) + 1);
    }
  }
  const candidates: Array<{ agent: ResolvedSpaceAgent; alias: string }> = [];
  for (const agent of agents) {
    candidates.push({ agent, alias: agent.name });
    candidates.push({ agent, alias: agent.id });
    const shortName = agent.name.split(/[·•\-_(（]/)[0].trim();
    if (shortName && shortName !== agent.name && shortName.length >= 2 && shortNameCounts.get(shortName) === 1) {
      candidates.push({ agent, alias: shortName });
    }
  }
  candidates.sort((a, b) => b.alias.length - a.alias.length);

  const seen = new Set<string>();
  const matches: Array<{ agent: ResolvedSpaceAgent; index: number }> = [];
  for (const { agent, alias } of candidates) {
    if (seen.has(agent.id)) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isAscii = /^[a-zA-Z0-9_-]+$/.test(alias);
    const pattern = isAscii
      ? new RegExp(`@${escaped}(?=$|[^a-zA-Z0-9_])`, 'i')
      : new RegExp(`@${escaped}`, 'i');
    const match = pattern.exec(content);
    if (match) {
      seen.add(agent.id);
      matches.push({ agent, index: match.index });
    }
  }

  return matches
    .sort((left, right) => left.index - right.index)
    .map(({ agent }) => agent);
}

export function formatMembersContext(
  agents: ResolvedSpaceAgent[],
  targetAgent: ResolvedSpaceAgent,
  options?: { autoBotChat?: boolean }
) {
  const workers = agents.filter((agent) => agent.id !== SPACE_COORDINATOR_ID);
  const otherMembers = workers.filter((agent) => agent.id !== targetAgent.id);
  const membersList = workers
    .map((agent) => `- ${agent.name}${agent.category ? `（${agent.category}）` : ''}: ${agent.description || '暂无描述'}`)
    .join('\n');

  const shortNameCounts = new Map<string, number>();
  for (const agent of workers) {
    const shortName = agent.name.split(/[·•\-_(（]/)[0].trim();
    if (shortName && shortName !== agent.name && shortName.length >= 2) {
      shortNameCounts.set(shortName, (shortNameCounts.get(shortName) || 0) + 1);
    }
  }
  const otherMemberNames = otherMembers.map((agent) => {
    const shortName = agent.name.split(/[·•\-_(（]/)[0].trim();
    return shortName && shortName !== agent.name && shortNameCounts.get(shortName) === 1
      ? `「${agent.name}」（呼叫名：${shortName}）`
      : `「${agent.name}」`;
  });

  const allowAutoRelay = options?.autoBotChat !== false;
  const mentionGuidance = otherMembers.length > 0
    ? `2. 【伙伴称呼与 @ 协作规范】：
   - 当前在场的其他伙伴有：${otherMemberNames.join('、')}。
   - 【自然互动与接力呼叫】：${allowAutoRelay
      ? `当前空间已开启成员自动接力。请严格区分【提及/引用名字】与【传麦唤醒对方接话】：
       * 仅仅提及或引用伙伴（例如：“正如可可之前提到的那样……”、“诺克斯的分析很透彻”）：直接写姓名，【绝对不要带 @】，避免系统误将其判定为转麦指令而强制唤醒对方；
       * 明确需要特定伙伴接力回答/发表见解（例如：“关于这部分细节，请 @诺克斯 补充评估” 或 “@可可 你怎么看？”）：在发言末尾自然地使用「@伙伴名」，系统检测到你的 @ 会自动唤醒该伙伴接力发言；
       * 若当前话题你已完整回答，无需其他人补充接话，请正常收尾，不要使用 @。`
      : '当前空间未开启成员自动接力。若提及在场伙伴请直接称呼姓名（如“可可”、“璐璐”），不要使用 @ 符号。'}
   - 【极其重要】：你只能 @ 上述【实际在场】的伙伴！切勿 @ 任何不在当前群名单中的角色（禁止虚空喊话），不要 @ 你自己。`
    : `2. 【单聊/无其他在场成员】：
   - 当前空间中除你之外没有其他伙伴在场，这是你与用户的单独对话。
   - 请直接与用户交流，不要 @ 任何角色。`;

  return `你正在一个名为“空间”的多 Agent 会话中发言。
当前轮到你以「${targetAgent.name}」的身份发言。
你只代表自己发言，不要冒充其他 Agent。
如果你是空间协调者：没有 @ 时由你默认接话，负责理解需求、给出下一步建议，必要时建议用户 @ 具体成员。
如果你是普通成员：
1. 请根据当前上下文与话题自然回应，保持自己的性格特色与人设风格。
${mentionGuidance}

当前普通成员列表：
${membersList || '- 暂无普通成员。'}`;
}
