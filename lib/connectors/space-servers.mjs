import { connectorServer } from './personal-store.mjs';
import { decryptConnectorCredential } from './credentials.mjs';

// Worker uses a synchronous SQLite connection, while web routes use Prisma.
export function resolveSpaceConnectorServersSync(db, userId, spaceId) {
  if (!db.prepare('SELECT "id" FROM "Space" WHERE "id" = ? AND "userId" = ?').get(spaceId, userId)) throw new Error('空间连接器授权无效');
  const personal = db.prepare('SELECT c.* FROM "PersonalConnector" c JOIN "ConnectorBinding" b ON b."connectorId" = c."id" AND b."userId" = c."userId" WHERE c."userId" = ? AND b."scope" = ? AND b."scopeId" = ? ORDER BY c."createdAt", c."id"').all(userId, 'space', spaceId)
    .map(row => connectorServer(row, { scope: 'space', scopeId: spaceId }));
  const legacy = db.prepare('SELECT * FROM "SpaceMcpServer" WHERE "spaceId" = ? AND "enabled" = 1 ORDER BY "createdAt"').all(spaceId)
    .map(row => ({ id: `space_${row.id.replace(/[^A-Za-z0-9_-]/g, '_')}`, url: row.url,
      headers: row.headersCiphertext ? decryptConnectorCredential(row.headersCiphertext, { spaceId, provider: `MCP_${row.name}` }) : {} }));
  return [...personal, ...legacy];
}
