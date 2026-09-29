import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('agent main conversations have a database uniqueness guard and race recovery', async () => {
  const migration = await readFile(path.join(root, 'prisma/migrations/20260929150000_unique_agent_main_conversation/migration.sql'), 'utf8');
  const mainRoute = await readFile(path.join(root, 'app/api/agents/[agentId]/main-conversation/route.ts'), 'utf8');
  const chatRoute = await readFile(path.join(root, 'app/api/chat/route.ts'), 'utf8');

  assert.match(migration, /CREATE UNIQUE INDEX/);
  assert.match(migration, /"kind" = 'AGENT'/);
  assert.match(migration, /"agentMode" = 'MAIN'/);
  assert.match(mainRoute, /error\?\.code !== 'P2002'/);
  assert.match(chatRoute, /error\?\.code !== 'P2002'/);
});

test('temporary conversation management never mutates the main conversation', async () => {
  const route = await readFile(path.join(root, 'app/api/conversations/[conversationId]/route.ts'), 'utf8');
  assert.match(route, /conversation\.agentMode === 'MAIN'/);
  assert.match(route, /Main conversation cannot be deleted/);
  assert.match(route, /Main conversation cannot be archived/);
});

test('conversation listing can be scoped to one agent', async () => {
  const route = await readFile(path.join(root, 'app/api/conversations/route.ts'), 'utf8');
  const api = await readFile(path.join(root, 'lib/api.ts'), 'utf8');
  assert.match(route, /const agentId = searchParams\.get\('agentId'\)/);
  assert.match(route, /agentId \? \{ agentId \} : \{\}/);
  assert.match(api, /agentId\?: string/);
});

test('agent chat and Space reuse XiaoBan user memory storage', async () => {
  const [memory, chat, space] = await Promise.all([
    readFile(path.join(root, 'lib/personal-assistant/user-memory.ts'), 'utf8'),
    readFile(path.join(root, 'app/api/chat/route.ts'), 'utf8'),
    readFile(path.join(root, 'app/api/spaces/[spaceId]/messages/route.ts'), 'utf8'),
  ]);
  assert.match(memory, /assistantMemoryItem\.findMany/);
  assert.match(chat, /loadUserMemoryItems/);
  assert.match(space, /loadUserMemoryItems/);
});

test('user memories keep XiaoBan global scope separate from Agent-only scope', async () => {
  const [schema, loader, assistantRoute] = await Promise.all([
    readFile(path.join(root, 'prisma/schema.prisma'), 'utf8'),
    readFile(path.join(root, 'lib/personal-assistant/user-memory.ts'), 'utf8'),
    readFile(path.join(root, 'app/api/assistant/route.ts'), 'utf8'),
  ]);
  assert.match(schema, /agentId\s+String\?/);
  assert.match(loader, /\.\.\.\(agentId \? \{ agentId \} : \{ agentId: null \}\)/);
  assert.match(assistantRoute, /where: \{ userId, agentId \}/);
});
