import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export const runtime = 'nodejs';

function serializePersonal(binding: any) {
  return {
    id: binding.userId,
    kind: 'PERSONAL' as const,
    provider: 'QQ' as const,
    appId: binding.appId,
    enabled: Boolean(binding.enabled),
    peerBound: Boolean(binding.qqOpenId),
    status: binding.enabled ? binding.status : 'DISABLED',
    lastError: binding.lastError || null,
    connectedAt: binding.connectedAt?.toISOString?.() || null,
    lastInboundAt: binding.lastInboundAt?.toISOString?.() || null,
    updatedAt: binding.updatedAt.toISOString(),
    agentId: null,
    agentName: '个人小伴',
    agentAvatar: null,
    conversationId: binding.conversationId,
  };
}

function serializeAgent(binding: any) {
  const account = binding.botAccount;
  const identity = account?.identities?.find((item: any) => item.userId === binding.userId);
  return {
    id: binding.id,
    kind: 'AGENT' as const,
    provider: 'QQ' as const,
    appId: account.appId,
    enabled: Boolean(binding.enabled && account.enabled),
    peerBound: Boolean(identity?.qqOpenId),
    status: account.enabled ? account.status : 'DISABLED',
    lastError: account.lastError || null,
    connectedAt: account.connectedAt?.toISOString?.() || null,
    lastInboundAt: binding.lastInboundAt?.toISOString?.() || null,
    updatedAt: binding.updatedAt.toISOString(),
    agentId: binding.agentId,
    agentName: binding.conversation?.agentName || binding.agentId,
    agentAvatar: binding.conversation?.agentAvatar || null,
    conversationId: binding.conversationId,
  };
}

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const [personal, agentBindings] = await Promise.all([
      prisma.assistantQQBinding.findUnique({ where: { userId } }),
      prisma.agentQQBinding.findMany({
        where: { userId },
        include: {
          botAccount: { include: { identities: true } },
          conversation: { select: { agentName: true, agentAvatar: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const bindings = [
      ...(personal ? [serializePersonal(personal)] : []),
      ...agentBindings.map(serializeAgent),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return NextResponse.json({ bindings });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || 'Failed to load Bot bindings' }, { status: 500 });
  }
}
