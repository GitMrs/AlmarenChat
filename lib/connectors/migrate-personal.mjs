import { randomUUID } from 'node:crypto';
import { parseMcpServers } from '../agents/runtime/mcp-config.mjs';
import { encryptConnectorCredential } from './credentials.mjs';
import { connectorCredentialContext } from './personal-store.mjs';

// Called by the deployment upgrade, after the schema migration and database backup.
export function migratePersonalConnectors(db) {
  return db.transaction(() => {
    let count = 0;
    for (const user of db.prepare('SELECT "id", "assistantMcpServers" FROM "User" WHERE "assistantMcpServers" IS NOT NULL').all()) {
      let legacy;
      try { legacy = typeof user.assistantMcpServers === 'string' ? JSON.parse(user.assistantMcpServers) : user.assistantMcpServers; }
      catch { throw new Error('旧 MCP 配置不是有效 JSON，迁移已停止，请先修复原配置'); }
      const servers = parseMcpServers(legacy);
      if (legacy !== null && (!Array.isArray(legacy) || legacy.length !== servers.length)) throw new Error('旧 MCP 配置存在无效条目，迁移已停止，原数据保留');
      for (const server of servers) {
        const existing = db.prepare('SELECT "id" FROM "PersonalConnector" WHERE "userId" = ? AND "toolId" = ?').get(user.id, server.id);
        const id = existing?.id || randomUUID();
        if (!existing) {
          const ciphertext = Object.keys(server.headers).length ? encryptConnectorCredential(server.headers, connectorCredentialContext({ id, userId: user.id })) : null;
          db.prepare('INSERT INTO "PersonalConnector" ("id","userId","toolId","name","url","headersCiphertext","updatedAt") VALUES (?,?,?,?,?,?,?)').run(id, user.id, server.id, server.id, server.url, ciphertext, new Date().toISOString());
          count++;
        }
        if (server.enabled !== false) db.prepare('INSERT OR IGNORE INTO "ConnectorBinding" ("id","connectorId","userId","scope","scopeId") VALUES (?,?,?,?,?)').run(randomUUID(), id, user.id, 'assistant', user.id);
      }
      db.prepare('UPDATE "User" SET "assistantMcpServers" = NULL WHERE "id" = ?').run(user.id);
    }
    return count;
  })();
}
