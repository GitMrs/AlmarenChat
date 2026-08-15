import prisma from '@/app/api/_lib/db';
import { appendSpaceMemory } from '@/lib/space-memory-policy.mjs';

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
    select: { id: true, role: true, speakerAgentId: true, content: true, createdAt: true },
  });
  if (messages.length === 0) {
    await prisma.spaceMemory.deleteMany({ where: { spaceId } });
    return;
  }
  let memory: ReturnType<typeof appendSpaceMemory> | null = null;
  for (let index = 0; index < messages.length; index += 100) {
    memory = appendSpaceMemory(memory, messages.slice(index, index + 100).map((message) => ({
      type: message.role === 'user' ? 'user_message' : 'assistant_message',
      actor: message.role === 'user' ? '用户' : message.speakerAgentId || '空间助手',
      summary: message.content,
      at: message.createdAt.toISOString(),
      refId: message.id,
    })));
  }
  await prisma.spaceMemory.upsert({
    where: { spaceId },
    update: memory!,
    create: { spaceId, ...memory! },
  });
}
