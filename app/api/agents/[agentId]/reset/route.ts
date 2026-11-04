import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';
import { getBuiltInAgents } from '@/lib/agents/data/agents-data';

/** Reset one user's relationship state with an Agent while keeping the Agent itself configured. */
export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const builtInAgent = (await getBuiltInAgents()).find((candidate) => candidate.id === agentId);
    const agent = builtInAgent || await requireAgentMemoryAccess(userId, agentId);

    const conversations = await prisma.conversation.findMany({
      where: { userId, agentId, kind: 'AGENT' },
      select: { id: true },
    });
    const conversationIds = conversations.map((conversation) => conversation.id);

    await prisma.$transaction(async (tx) => {
      if (conversationIds.length > 0) {
        await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await tx.recentState.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await tx.conversationContextState.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await tx.conversation.updateMany({
          where: { id: { in: conversationIds } },
          data: {
            agentName: agent.name || null,
            agentAvatar: agent.avatar || null,
            agentCategory: agent.category || null,
            agentTone: agent.tone || null,
            agentDescription: agent.description || null,
            agentSystemPrompt: agent.systemPrompt || null,
            agentVoice: agent.voice || null,
            updatedAt: new Date(),
          },
        });
      }
      await tx.agentMemoryItem.deleteMany({ where: { userId, agentId } });
      await tx.agentMemoryRule.deleteMany({ where: { userId, agentId } });
      await tx.agentExperience.deleteMany({ where: { userId, agentId } });
      await tx.agentGrowthEvent.deleteMany({ where: { userId, agentId } });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500 });
  }
}
