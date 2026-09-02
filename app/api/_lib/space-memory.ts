import prisma from '@/app/api/_lib/db';
import { appendSpaceMemory } from '@/lib/space-memory-policy.mjs';

const TRUSTED_MEMORY_POLICY = 'trusted-space-memory-v2';

function parsedRecentActivity(memory: { recentActivity?: unknown } | null | undefined) {
  const value = memory?.recentActivity;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function spaceMemoryNeedsTrustedRebuild(memory: { recentActivity?: unknown } | null | undefined) {
  return !parsedRecentActivity(memory).some((activity) => (
    activity && typeof activity === 'object' && (activity as { refId?: unknown }).refId === TRUSTED_MEMORY_POLICY
  ));
}

export async function persistSpaceMemory(spaceId: string, activities: Array<Record<string, unknown>>) {
  await prisma.$transaction(async (transaction) => {
    const current = await transaction.spaceMemory.findUnique({ where: { spaceId } });
    const next = appendSpaceMemory(current, activities);
    await transaction.spaceMemory.upsert({
      where: { spaceId },
      update: next,
      create: { spaceId, ...next },
    });
  });
}

export async function rebuildSpaceMemory(spaceId: string) {
  const messages = await prisma.spaceMessage.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, speakerAgentId: true, content: true, attachments: true, createdAt: true },
  });
  let memory: ReturnType<typeof appendSpaceMemory> | null = appendSpaceMemory(null, [{
    type: 'memory_policy',
    actor: '系统',
    summary: '长期项目记忆仅保留用户要求和结构化任务记录。',
    refId: TRUSTED_MEMORY_POLICY,
    at: new Date(0).toISOString(),
  }]);
  const trustedActivities = messages.flatMap((message) => {
    if (message.role === 'user') {
      return [{
        type: 'user_message',
        actor: '用户',
        summary: message.content,
        at: message.createdAt.toISOString(),
        refId: message.id,
      }];
    }
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const structured = attachments.find((attachment) => (
      attachment && typeof attachment === 'object'
      && ['task_proposal', 'run_result'].includes(String((attachment as { type?: unknown }).type || ''))
    ));
    if (!structured || typeof structured !== 'object') return [];
    const type = String((structured as { type?: unknown }).type || '');
    const title = String((structured as { title?: unknown }).title || '').trim();
    const summary = String((structured as { summary?: unknown }).summary || '').trim();
    return [{
      type,
      actor: message.speakerAgentId || '空间协调者',
      summary: type === 'task_proposal' ? [title, summary].filter(Boolean).join('：') : message.content,
      at: message.createdAt.toISOString(),
      refId: message.id,
    }];
  });
  for (let index = 0; index < trustedActivities.length; index += 100) {
    memory = appendSpaceMemory(memory, trustedActivities.slice(index, index + 100));
  }
  await prisma.spaceMemory.upsert({
    where: { spaceId },
    update: memory!,
    create: { spaceId, ...memory! },
  });
}
