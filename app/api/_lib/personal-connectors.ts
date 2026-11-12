import prisma from './db';
import { getBuiltInAgents } from '@/lib/agents/data/agents-data';
import { findCompanionAgent } from '@/lib/companion/agents';
import { connectorScope, resolvePersonalConnectorServers, connectorServer } from '@/lib/connectors/personal-store.mjs';
import { createAssistantToolBroker } from '@/lib/personal-assistant/tool-broker.mjs';
import { decryptConnectorCredential } from '@/lib/connectors/credentials.mjs';

export async function assertConnectorScope(userId: string, scope: string, scopeId?: string) {
  const target = connectorScope(userId, scope, scopeId);
  if (scope === 'space') {
    if (!await prisma.space.findFirst({ where: { id: target.scopeId, userId }, select: { id: true } })) throw new Error('无权管理此空间的连接器');
  } else if (scope === 'agent') {
    const builtIn = (await getBuiltInAgents()).some(agent => agent.id === target.scopeId) || findCompanionAgent(target.scopeId);
    if (!builtIn && !await prisma.agent.findFirst({ where: { id: target.scopeId, OR: [{ creatorId: userId }, { isPublic: true }] }, select: { id: true } })) throw new Error('无权使用此 Agent');
  }
  return target;
}

export async function resolveScopeServers(userId: string, scope: string, scopeId?: string) {
  const target = await assertConnectorScope(userId, scope, scopeId);
  const personal = await resolvePersonalConnectorServers(prisma, userId, scope, target.scopeId);
  if (scope !== 'space') return personal;
  const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "SpaceMcpServer" WHERE "spaceId" = ? AND "enabled" = 1 ORDER BY "createdAt"', target.scopeId);
  const legacy = rows.map(row => ({ id: `space_${row.id.replace(/[^A-Za-z0-9_-]/g, '_')}`, url: row.url,
    headers: row.headersCiphertext ? decryptConnectorCredential(row.headersCiphertext, { spaceId: target.scopeId, provider: `MCP_${row.name}` }) : {} }));
  return [...personal, ...legacy];
}

export async function createScopedConnectorBroker(userId: string, scope: string, scopeId?: string) {
  return createAssistantToolBroker({
    servers: await resolveScopeServers(userId, scope, scopeId),
    authorizeServer: async (serverId: string) => {
      const current = (await resolveScopeServers(userId, scope, scopeId)).find(server => server.id === serverId);
      if (!current) throw new Error('此连接器已关闭或删除');
      return current;
    },
  });
}

export async function testPersonalConnector(userId: string, id: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "PersonalConnector" WHERE "id" = ? AND "userId" = ?', id, userId);
  if (!rows[0]) throw new Error('连接器不存在');
  return connectorServer(rows[0]);
}
