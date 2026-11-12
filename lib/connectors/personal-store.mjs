import { randomUUID } from 'node:crypto';
import { parseMcpServers } from '../agents/runtime/mcp-config.mjs';
import { decryptConnectorCredential, encryptConnectorCredential } from './credentials.mjs';
import { CONNECTOR_CATALOG } from './catalog.mjs';
import { FEISHU_URL } from './feishu-cli.mjs';

export function connectorScope(userId, scope, scopeId) {
  if (!userId || !['assistant', 'agent', 'space'].includes(scope)) throw new Error('连接器作用域无效');
  const id = scope === 'assistant' ? userId : String(scopeId || '').trim();
  if (!id || id.length > 150) throw new Error('连接器作用域无效');
  return { userId, scope, scopeId: id };
}

export function connectorCredentialContext(row) {
  return { spaceId: `personal:${row.userId}`, provider: `MCP_${row.id}` };
}

export function connectorHeaders(row) {
  return row.headersCiphertext ? decryptConnectorCredential(row.headersCiphertext, connectorCredentialContext(row)) : {};
}

export function publicConnector(row) {
  return { id: row.id, toolId: row.toolId, name: row.name, url: row.url, catalogId: row.catalogId,
    hasHeaders: Boolean(row.headersCiphertext), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function listPersonalConnectors(db, userId) {
  const rows = await db.$queryRawUnsafe('SELECT * FROM "PersonalConnector" WHERE "userId" = ? ORDER BY "createdAt", "id"', userId);
  return rows.map(publicConnector);
}

export async function savePersonalConnector(db, userId, input, id) {
  return db.$transaction(async (tx) => {
    const existing = id ? (await tx.$queryRawUnsafe('SELECT * FROM "PersonalConnector" WHERE "id" = ? AND "userId" = ?', id, userId))[0] : null;
    if (id && !existing) throw new Error('连接器不存在');
    if (existing && input.catalogId && input.catalogId !== existing.catalogId) throw new Error('不能修改已有连接器的类型');
    if (!id) {
      const rows = await tx.$queryRawUnsafe('SELECT "id" FROM "PersonalConnector" WHERE "userId" = ?', userId);
      if (rows.length >= 8) throw new Error('最多添加 8 个连接器');
    }
    const toolId = existing?.toolId || String(input.toolId || '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(toolId)) throw new Error('连接标识只能包含字母、数字、下划线和短横线，最多 40 字符');
    if (input.headers !== undefined && (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers)
      || Object.keys(input.headers).length > 16 || Object.entries(input.headers).some(([key, value]) => !/^[A-Za-z0-9-]{1,80}$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value)))) throw new Error('请求头格式无效');
    const isFeishu = (existing?.catalogId || input.catalogId) === 'feishu-cli';
    const parsed = isFeishu ? [{ url: FEISHU_URL }] : parseMcpServers([{ id: toolId, url: input.url }]);
    if (parsed.length !== 1) throw new Error('连接地址必须使用 HTTPS，或服务器本机的 HTTP localhost/127.0.0.1');
    const name = String(input.name || toolId).trim().slice(0, 80);
    const row = { id: existing?.id || randomUUID(), userId };
    if (input.catalogId && !CONNECTOR_CATALOG.some(item => item.id === input.catalogId)) throw new Error('内置连接器类型无效');
    const catalogId = existing?.catalogId || input.catalogId || null;
    if (!existing && catalogId && (await tx.$queryRawUnsafe('SELECT "id" FROM "PersonalConnector" WHERE "userId" = ? AND "catalogId" = ?', userId, catalogId)).length) throw new Error('此内置连接器已添加');
    const headers = input.headers;
    if (isFeishu && headers !== undefined && (!/^cli_[A-Za-z0-9]{1,80}$/.test(headers.appId || '') || !headers.appSecret || headers.appSecret.length > 4096 || Object.keys(headers).some(key => !['appId', 'appSecret'].includes(key)))) throw new Error('请填写有效的飞书 App ID 和 App Secret');
    if (isFeishu && !existing && !headers) throw new Error('请填写飞书应用凭据');
    if (!isFeishu && input.url === FEISHU_URL) throw new Error('请通过内置飞书连接器添加');
    const ciphertext = headers === undefined ? (existing?.headersCiphertext || null) : Object.keys(headers).length
      ? encryptConnectorCredential(headers, connectorCredentialContext(row)) : null;
    const now = new Date().toISOString();
    if (existing) await tx.$executeRawUnsafe('UPDATE "PersonalConnector" SET "name" = ?, "url" = ?, "headersCiphertext" = ?, "updatedAt" = ? WHERE "id" = ? AND "userId" = ?', name, parsed[0].url, ciphertext, now, row.id, userId);
    else await tx.$executeRawUnsafe('INSERT INTO "PersonalConnector" ("id","userId","toolId","name","url","catalogId","headersCiphertext","updatedAt") VALUES (?,?,?,?,?,?,?,?)', row.id, userId, toolId, name, parsed[0].url, catalogId, ciphertext, now);
    return publicConnector((await tx.$queryRawUnsafe('SELECT * FROM "PersonalConnector" WHERE "id" = ? AND "userId" = ?', row.id, userId))[0]);
  });
}

export async function setConnectorBinding(db, userId, scope, scopeId, connectorId, enabled) {
  const target = connectorScope(userId, scope, scopeId);
  return db.$transaction(async (tx) => {
    const connector = (await tx.$queryRawUnsafe('SELECT "id" FROM "PersonalConnector" WHERE "id" = ? AND "userId" = ?', connectorId, userId))[0];
    if (!connector) throw new Error('连接器不存在');
    if (enabled) await tx.$executeRawUnsafe('INSERT OR IGNORE INTO "ConnectorBinding" ("id","connectorId","userId","scope","scopeId") VALUES (?,?,?,?,?)', randomUUID(), connectorId, userId, target.scope, target.scopeId);
    else await tx.$executeRawUnsafe('DELETE FROM "ConnectorBinding" WHERE "connectorId" = ? AND "userId" = ? AND "scope" = ? AND "scopeId" = ?', connectorId, userId, target.scope, target.scopeId);
  });
}

export async function listConnectorBindings(db, userId, scope, scopeId) {
  const target = connectorScope(userId, scope, scopeId);
  const rows = await db.$queryRawUnsafe('SELECT "connectorId" FROM "ConnectorBinding" WHERE "userId" = ? AND "scope" = ? AND "scopeId" = ?', userId, target.scope, target.scopeId);
  return rows.map(row => row.connectorId);
}

export async function deletePersonalConnector(db, userId, id) {
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('DELETE FROM "ConnectorBinding" WHERE "connectorId" = ? AND "userId" = ?', id, userId);
    await tx.$executeRawUnsafe('DELETE FROM "PersonalConnector" WHERE "id" = ? AND "userId" = ?', id, userId);
  });
}

export async function resolvePersonalConnectorServers(db, userId, scope, scopeId) {
  const target = connectorScope(userId, scope, scopeId);
  const rows = await db.$queryRawUnsafe('SELECT c.* FROM "PersonalConnector" c JOIN "ConnectorBinding" b ON b."connectorId" = c."id" AND b."userId" = c."userId" WHERE c."userId" = ? AND b."scope" = ? AND b."scopeId" = ? ORDER BY c."createdAt", c."id"', userId, target.scope, target.scopeId);
  return rows.map(row => connectorServer(row, target));
}

export function connectorServer(row, target = {}) {
  return { id: row.toolId, url: row.url, headers: connectorHeaders(row), ...(row.catalogId === 'feishu-cli' ? { connectorId: row.id, userId: row.userId, scope: target.scope, scopeId: target.scopeId } : {}) };
}
