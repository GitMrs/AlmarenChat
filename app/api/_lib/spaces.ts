import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import { getBuiltInAgents } from '@/lib/agents/data/agents-data';
import { createModelClient, resolveModelName, DEFAULT_BASE_URL, DEFAULT_MODEL } from '@/lib/core/model-client';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';
import type { Agent } from '@/types';

export type ResolvedSpaceAgent = Pick<
  Agent,
  'id' | 'name' | 'avatar' | 'description' | 'category' | 'tone' | 'systemPrompt' | 'voice'
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
  options?: { canAskUser?: boolean; canMentionPeer?: boolean }
) {
  const workers = agents.filter((agent) => agent.id !== SPACE_COORDINATOR_ID);
  const membersList = workers
    .map((agent) => `- ${agent.name}${agent.category ? `（${agent.category}）` : ''}: ${agent.description || '暂无描述'}`)
    .join('\n');

  const mentionGuidance = [
    '2. 先结合上下文判断自己是否理解了用户的意思。如果仍有会影响下一步的疑问，先问用户，本轮停在问题处。等用户回复后再判断；若只解答了一部分，就只问剩余疑问。意思清楚时直接推进。',
    options?.canAskUser ? '需要澄清时用 ask_space_user 发出问题，等待期间不要 @ 伙伴。' : '',
    options?.canMentionPeer
      ? '理解清楚且下一步确实需要其他成员时，在回复末尾另起一行写「@伙伴名 具体事项」。平时提到伙伴直接写名字。'
      : '本轮直接回应，不发起伙伴接力。',
  ].filter(Boolean).join('\n');
  return `你正在一个名为“空间”的多 Agent 会话中发言。
当前轮到你以「${targetAgent.name}」的身份发言。
你只代表自己发言，不要冒充其他 Agent。
如果你是空间协调者：没有 @ 时由你默认接话，负责理解需求、给出下一步建议；需要专业成员参与时生成任务方案，由运行时 Coordinator 根据实时成员和依赖关系派发，不要求用户另外 @ 成员。
如果你是普通成员：
1. 请根据当前上下文与话题自然回应，保持自己的性格特色与人设风格。
${mentionGuidance}

当前普通成员列表：
${membersList || '- 暂无普通成员。'}`;
}

export interface SpaceMemberModelConfig {
  space: any;
  currentAgent: ResolvedSpaceAgent | null;
  agentName: string;
  agentPersona: string;
  agentTone: string;
  effectiveApiBaseUrl: string;
  effectiveApiKey: string | null;
  effectiveModelName: string;
  client: ReturnType<typeof createModelClient> | null;
  model: string;
  hasApiKey: boolean;
}

/**
 * 统一解析空间成员在当前空间与用户上下文下的生效大模型配置与客户端
 * 优先级：空间成员独立配置 > 当前用户的角色默认配置 > 用户全局配置 > 系统默认
 */
export async function resolveSpaceMemberModelConfig(options: {
  spaceId: string;
  agentId: string;
  userId?: string | null;
  space?: any;
}): Promise<SpaceMemberModelConfig> {
  const { spaceId, agentId } = options;
  let space = options.space;

  if (!space) {
    space = options.userId
      ? await getSpaceForUser(spaceId, options.userId)
      : await prisma.space.findUnique({
          where: { id: spaceId },
          include: {
            members: {
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            },
          },
      });
  }
  if (!space) throw Object.assign(new Error('Space not found'), { status: 404 });

  const effectiveUserId = options.userId || space?.userId || null;
  const [user, currentAgent, agentSetting] = await Promise.all([
    effectiveUserId
      ? prisma.user.findUnique({
          where: { id: effectiveUserId },
          select: {
            customModelEnabled: true,
            apiBaseUrl: true,
            apiKey: true,
            modelName: true,
          },
        })
      : null,
    resolveAgent(agentId, effectiveUserId || undefined),
    effectiveUserId ? loadAgentModelSetting(effectiveUserId, agentId) : null,
  ]);

  const targetMember = space?.members?.find((m: any) => m.agentId === agentId);
  const config = resolveUserModelConfig(user, agentSetting, targetMember);
  const effectiveApiBaseUrl = config.apiBaseUrl || DEFAULT_BASE_URL;
  const effectiveApiKey = config.apiKey;
  const effectiveModelName = config.modelName || DEFAULT_MODEL;

  const model = resolveModelName(effectiveModelName);
  const hasApiKey = Boolean(effectiveApiKey);
  const client = hasApiKey ? createModelClient(effectiveApiBaseUrl, effectiveApiKey) : null;

  const agentName = currentAgent?.name || '搭子牌友';
  const agentPersona = currentAgent?.systemPrompt || currentAgent?.description || '性格鲜明的空间搭子';
  const agentTone = currentAgent?.tone || '个性鲜明';

  return {
    space,
    currentAgent,
    agentName,
    agentPersona,
    agentTone,
    effectiveApiBaseUrl,
    effectiveApiKey,
    effectiveModelName,
    client,
    model,
    hasApiKey,
  };
}
