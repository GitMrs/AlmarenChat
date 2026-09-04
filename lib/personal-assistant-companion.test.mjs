import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveActivityRange } from './personal-assistant/activity-query.mjs';
import { classifyReminderRequest } from './personal-assistant/reminder-intent.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('activity questions resolve to exact UTC+8 day ranges', () => {
  const now = new Date('2026-09-03T08:00:00.000Z');
  const yesterday = resolveActivityRange('昨天我干啥了？', now);

  assert.equal(yesterday?.label, '昨天');
  assert.equal(yesterday?.start.toISOString(), '2026-09-01T16:00:00.000Z');
  assert.equal(yesterday?.end.toISOString(), '2026-09-02T16:00:00.000Z');
  assert.equal(resolveActivityRange('昨天天气怎么样？', now), null);
});

test('reminder intent separates explicit commands from implicit schedules', () => {
  assert.deepEqual(classifyReminderRequest('我有点累'), { explicit: false, hasCue: false });
  assert.deepEqual(classifyReminderRequest('下午3点有个会'), { explicit: false, hasCue: true });
  assert.deepEqual(classifyReminderRequest('下午3点提醒我开会'), { explicit: true, hasCue: true });
  assert.deepEqual(classifyReminderRequest('帮我记一下买牛奶'), { explicit: true, hasCue: true });
});

test('reminder parsing is read only', async () => {
  const source = await readFile(path.join(projectRoot, 'app/api/assistant/reminders/parse/route.ts'), 'utf8');

  assert.doesNotMatch(source, /assistantReminder\.create/);
  assert.match(source, /explicit: reminderIntent\.explicit/);
  assert.match(source, /candidates,/);
});

test('proactive greetings use persistent source keys and delivery ids', async () => {
  const source = await readFile(path.join(projectRoot, 'app/api/assistant/proactive/route.ts'), 'utf8');

  assert.match(source, /sourceKey = `message:\$\{uMsg\.id\}`/);
  assert.match(source, /deliveryId: delivery\.id/);
  assert.match(source, /where: \{ id: deliveryId, userId \}/);
  assert.match(source, /status: 'OPENING'/);
  assert.doesNotMatch(source, /pattern\.regex\.test\(m\.content\)/);
});

test('personal assistant Ollama mode never falls back to the hosted model', async () => {
  const [provider, messagesRoute, memoriesRoute, remindersRoute, proactiveRoute] = await Promise.all([
    readFile(path.join(projectRoot, 'components/assistant/PersonalAssistantProvider.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/messages/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/memories/extract/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/reminders/parse/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/proactive/route.ts'), 'utf8'),
  ]);

  assert.match(provider, /readBrowserModelConfig\(data\.conversationId\)/);
  assert.match(provider, /streamBrowserModel\(/);
  assert.match(provider, /prepareLocalMessage\(/);
  assert.ok(messagesRoute.indexOf('if (localMode)') < messagesRoute.indexOf('const client = createModelClient('));
  assert.match(memoriesRoute, /const hasLocalResponse = typeof body\.localResponse === 'string'/);
  assert.match(remindersRoute, /const hasLocalResponse = typeof body\.localResponse === 'string'/);
  assert.match(proactiveRoute, /if \(!allowOnlineModel\) return fallback/);
});
