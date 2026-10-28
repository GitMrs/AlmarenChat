import prisma from '@/app/api/_lib/db';
import { resolveAgent } from '@/app/api/_lib/spaces';

export async function ensureAgentMainConversation(
  userId: string,
  agentId: string
) {
  const resolved = await resolveAgent(agentId, userId);
  if (!resolved?.name) throw new Error('Agent not found');

  const existing = await prisma.conversation.findFirst({
    where: { userId, agentId, kind: 'AGENT', agentMode: 'MAIN' },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return { conversation: existing, created: false };

  let created = true;
  const conversation = await prisma.conversation.create({
    data: {
      userId,
      agentId,
      agentMode: 'MAIN',
      agentName: resolved.name || null,
      agentAvatar: resolved.avatar || null,
      agentCategory: resolved.category || null,
      agentTone: resolved.tone || null,
      agentDescription: resolved.description || null,
      agentSystemPrompt: resolved.systemPrompt || null,
      agentVoice: resolved.voice || null,
      title: `${resolved.name}的主聊天`,
    },
  }).catch(async (error: any) => {
    if (error?.code !== 'P2002') throw error;
    created = false;
    return prisma.conversation.findFirstOrThrow({
      where: { userId, agentId, kind: 'AGENT', agentMode: 'MAIN' },
    });
  });

  return { conversation, created };
}
