import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getBuiltInAgents } from '@/lib/agents/data/agents-data';

// Names and binding state are available even before the CLI has been installed.
export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const [builtins, agents, spaces, bindings] = await Promise.all([
      getBuiltInAgents(),
      prisma.agent.findMany({ where: { OR: [{ creatorId: userId }, { isPublic: true }] }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.space.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.$queryRawUnsafe<{ scope: string; scopeId: string; connectorId: string }[]>('SELECT "scope", "scopeId", "connectorId" FROM "ConnectorBinding" WHERE "userId" = ?', userId),
    ]);
    const allAgents = [...new Map([...builtins, ...agents].map(agent => [agent.id, agent])).values()];
    const targets = [
      { scope: 'assistant', scopeId: userId, name: '小伴' },
      ...allAgents.map(agent => ({ scope: 'agent', scopeId: agent.id, name: agent.name })),
      ...spaces.map(space => ({ scope: 'space', scopeId: space.id, name: space.name })),
    ].map(target => ({ ...target, connectorIds: bindings.filter(binding => binding.scope === target.scope && binding.scopeId === target.scopeId).map(binding => binding.connectorId) }));
    return NextResponse.json({ targets }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message === 'Unauthorized' ? 'Unauthorized' : '读取可用入口失败' }, { status: error.message === 'Unauthorized' ? 401 : 500 });
  }
}
