import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('agent memory schema and API keep memory scoped by user and agent', async () => {
  const [schema, route, agentRoute] = await Promise.all([
    readFile(path.join(root, 'prisma/schema.prisma'), 'utf8'),
    readFile(path.join(root, 'app/api/agents/[agentId]/memory/route.ts'), 'utf8'),
    readFile(path.join(root, 'app/api/agents/[agentId]/route.ts'), 'utf8'),
  ]);
  assert.match(schema, /model AgentExperience/);
  assert.match(schema, /model AgentMemoryRule/);
  assert.match(schema, /@@unique\(\[userId, agentId, taskId\]\)/);
  assert.match(schema, /@@unique\(\[userId, agentId, key\]\)/);
  assert.match(route, /where: \{ userId, agentId \}/);
  assert.match(route, /findFirst\(\{ where: \{ id, userId, agentId \} \}\)/);
  assert.match(agentRoute, /agentExperience\.deleteMany\(\{ where: \{ agentId, userId \} \}\)/);
  assert.match(agentRoute, /agentMemoryRule\.deleteMany\(\{ where: \{ agentId, userId \} \}\)/);
});

test('confirmed agent memory reaches every employee execution entry point', async () => {
  const [chat, space, pi, worker, harness, discussion, relay] = await Promise.all([
    readFile(path.join(root, 'app/api/chat/route.ts'), 'utf8'),
    readFile(path.join(root, 'app/api/spaces/[spaceId]/messages/route.ts'), 'utf8'),
    readFile(path.join(root, 'lib/pi-runtime/space-session.mjs'), 'utf8'),
    readFile(path.join(root, 'worker/agent-runtime.mjs'), 'utf8'),
    readFile(path.join(root, 'worker/harness/agent-harness.mjs'), 'utf8'),
    readFile(path.join(root, 'worker/runtime/discussion-runtime.mjs'), 'utf8'),
    readFile(path.join(root, 'worker/runtime/relay-runtime.mjs'), 'utf8'),
  ]);
  assert.match(chat, /loadAgentMemoryContext/);
  assert.match(space, /agentMemoryContext: agentMemory/);
  assert.match(pi, /options\.agentMemoryContext/);
  assert.match(worker, /loadAgentMemoryContextSync/);
  assert.match(worker, /run\.input \|\| run\.topic \|\| run\.goal/);
  assert.match(harness, /agent\.memoryContext/);
  assert.match(discussion, /currentAgent\.memoryContext/);
  assert.match(relay, /currentAgent\.memoryContext/);
});

test('task rework records a pending employee correction in the same transaction', async () => {
  const review = await readFile(path.join(root, 'app/api/runs/[runId]/tasks/[taskId]/review/route.ts'), 'utf8');
  assert.match(review, /const reviewEvent = await appendAgentRunEvent\(transaction/);
  assert.match(review, /await recordAgentCorrection\(transaction/);
  assert.match(review, /eventId: reviewEvent\.id/);
});

test('agent growth records are managed from the editor instead of the public detail page', async () => {
  const [editor, detail] = await Promise.all([
    readFile(path.join(root, 'app/create-agent/page.tsx'), 'utf8'),
    readFile(path.join(root, 'app/agents/[agentId]/page.tsx'), 'utf8'),
  ]);
  assert.match(editor, /import AgentGrowthPanel/);
  assert.match(editor, /id: 'growth', label: '成长档案'/);
  assert.match(editor, /<AgentGrowthPanel agentId=\{editingAgentId!\}/);
  assert.doesNotMatch(detail, /AgentGrowthPanel/);
  assert.doesNotMatch(detail, /成长档案/);
});
