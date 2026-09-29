import prisma from '@/app/api/_lib/db';

export async function loadUserMemoryItems(userId: string, agentId?: string | null, limit = 30) {
  return prisma.assistantMemoryItem.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      ...(agentId ? { agentId } : { agentId: null }),
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { category: true, content: true },
  });
}

export function buildUserMemoryContext(memories: Array<{ category: string; content: string }>) {
  if (memories.length === 0) return '';
  return `与用户相关的长期信息（仅在有帮助时使用）：\n${memories.map((memory) => `- [${memory.category}] ${memory.content}`).join('\n')}`;
}
