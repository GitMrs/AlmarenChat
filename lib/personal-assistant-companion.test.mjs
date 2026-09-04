import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyActivityTimestamps, resolveActivityRange } from './personal-assistant/activity-query.mjs';
import { isDuplicateMemory, memoryFingerprint } from './personal-assistant/memory-dedup.mjs';
import { shouldSkipEventFollowUp } from './personal-assistant/proactive-follow-up.mjs';
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

test('activity questions support week, month, and recent day ranges', () => {
  const now = new Date('2026-09-03T08:00:00.000Z');

  assert.deepEqual(
    [resolveActivityRange('上周我做了什么？', now)?.start.toISOString(), resolveActivityRange('上周我做了什么？', now)?.end.toISOString()],
    ['2026-08-23T16:00:00.000Z', '2026-08-30T16:00:00.000Z']
  );
  assert.deepEqual(
    [resolveActivityRange('这个月有什么进展？', now)?.start.toISOString(), resolveActivityRange('这个月有什么进展？', now)?.end.toISOString()],
    ['2026-08-31T16:00:00.000Z', '2026-09-03T08:00:00.000Z']
  );
  assert.equal(resolveActivityRange('最近7天我忙了什么？', now)?.start.toISOString(), '2026-08-27T08:00:00.000Z');
});

test('activity evidence distinguishes created, updated, and completed timestamps', () => {
  const range = {
    start: new Date('2026-09-01T00:00:00.000Z'),
    end: new Date('2026-09-02T00:00:00.000Z'),
  };
  const activities = classifyActivityTimestamps({
    createdAt: new Date('2026-09-01T01:00:00.000Z'),
    updatedAt: new Date('2026-09-01T02:00:00.000Z'),
    completedAt: new Date('2026-09-01T03:00:00.000Z'),
  }, range);

  assert.deepEqual(activities.map((item) => item.label), ['创建', '更新', '完成']);
});

test('assistant platform context sources are independently configurable', async () => {
  const [schema, profileRoute, bootstrapRoute, messagesRoute, settings, platformContext] = await Promise.all([
    readFile(path.join(projectRoot, 'prisma/schema.prisma'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/profile/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/messages/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'components/assistant/PersonalAssistantSettings.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'lib/personal-assistant/platform-context.ts'), 'utf8'),
  ]);

  for (const field of ['includeSpaceContext', 'includeTaskContext', 'includeChatContext']) {
    assert.match(schema, new RegExp(`${field}\\s+Boolean\\s+@default\\(true\\)`));
    assert.match(profileRoute, new RegExp(`body\\.${field}`));
    assert.match(bootstrapRoute, new RegExp(`profile\\.${field}`));
    assert.match(messagesRoute, new RegExp(`profile\\.${field}`));
    assert.match(settings, new RegExp(field));
  }
  assert.match(platformContext, /enabledSources: sources/);
  assert.match(platformContext, /sources\.spaces \? prisma\.space\.findMany/);
  assert.match(platformContext, /sources\.tasks \? prisma\.agentRun\.findMany/);
  assert.match(platformContext, /sources\.chats \? prisma\.conversation\.findMany/);
});

test('reminder intent separates explicit commands from implicit schedules', () => {
  assert.deepEqual(classifyReminderRequest('我有点累'), { explicit: false, hasCue: false });
  assert.deepEqual(classifyReminderRequest('下午3点有个会'), { explicit: false, hasCue: true });
  assert.deepEqual(classifyReminderRequest('下午3点提醒我开会'), { explicit: true, hasCue: true });
  assert.deepEqual(classifyReminderRequest('帮我记一下买牛奶'), { explicit: true, hasCue: true });
});

test('memory fingerprints collapse common equivalent wording', () => {
  assert.equal(memoryFingerprint('我平时爱喝咖啡。'), memoryFingerprint('喜欢喝咖啡'));
  assert.equal(isDuplicateMemory('通常使用 TypeScript', ['使用 TypeScript']), true);
  assert.equal(isDuplicateMemory('喜欢喝茶', ['喜欢喝咖啡']), false);
});

test('reminder parsing is read only', async () => {
  const source = await readFile(path.join(projectRoot, 'app/api/assistant/reminders/parse/route.ts'), 'utf8');

  assert.doesNotMatch(source, /assistantReminder\.create/);
  assert.match(source, /explicit: reminderIntent\.explicit/);
  assert.match(source, /candidates,/);
});

test('proactive follow-up skips canceled, resolved, and rejected topics', () => {
  assert.equal(shouldSkipEventFollowUp('我明天下午要去面试'), false);
  assert.equal(shouldSkipEventFollowUp('我没有去面试'), true);
  assert.equal(shouldSkipEventFollowUp('我不想去面试了'), true);
  assert.equal(shouldSkipEventFollowUp('面试取消了'), true);
  assert.equal(shouldSkipEventFollowUp('我下午去面试', ['已经面完了，感觉还不错']), true);
  assert.equal(shouldSkipEventFollowUp('我下午去面试', ['我没通过这次面试']), true);
  assert.equal(shouldSkipEventFollowUp('我下午去面试', ['这件事别再问了']), true);
  assert.equal(shouldSkipEventFollowUp('我下午去面试', ['今天压力很大，想静静']), true);
});

test('proactive greetings use persistent source keys and delivery ids', async () => {
  const [source, provider] = await Promise.all([
    readFile(path.join(projectRoot, 'app/api/assistant/proactive/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'components/assistant/PersonalAssistantProvider.tsx'), 'utf8'),
  ]);

  assert.match(source, /sourceKey = `message:\$\{uMsg\.id\}`/);
  assert.match(source, /deliveryId: delivery\.id/);
  assert.match(source, /where: \{ id: deliveryId, userId \}/);
  assert.match(source, /status: 'OPENING'/);
  assert.match(source, /body\.action === 'shown'/);
  assert.match(source, /activeKey: status === 'SKIPPED' \? null : 'ACTIVE'/);
  assert.match(source, /status: \{ in: \['PENDING', 'SHOWN'\] \}/);
  assert.match(source, /body\.action === 'expire' \? 'EXPIRED' : 'DISMISSED'/);
  assert.match(source, /recovered: true/);
  assert.match(provider, /setProactiveGreetingCollapsed\(true\)/);
  assert.match(provider, /!proactiveGreeting \|\| activeReminderAlert \|\| open \|\| hidden \|\| !loggedIn/);
  assert.match(provider, /markProactiveGreetingShown\(proactiveGreeting\.deliveryId\)/);
  assert.match(provider, /dismissProactiveGreeting\(delivery\.deliveryId\)/);
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

  assert.match(provider, /readBrowserModelConfigForScope\('GLOBAL'\)/);
  assert.match(provider, /streamBrowserModel\(/);
  assert.match(provider, /prepareLocalMessage\(/);
  assert.ok(messagesRoute.indexOf('if (localMode)') < messagesRoute.indexOf('const client = createModelClient('));
  assert.match(memoriesRoute, /const hasLocalResponse = typeof body\.localResponse === 'string'/);
  assert.match(remindersRoute, /const hasLocalResponse = typeof body\.localResponse === 'string'/);
  assert.match(proactiveRoute, /if \(!allowOnlineModel\) return \{ greeting: fallback, modelMessages \}/);
  assert.match(provider, /completeLocalProactiveGreeting\(res\.deliveryId, localResponse\)/);
});

test('global browser model settings live in personal center while agent settings stay read only', async () => {
  const [settings, agentPanel, chatRoom] = await Promise.all([
    readFile(path.join(projectRoot, 'components/settings/SettingsPanel.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'components/chat/AgentDetailsPanel.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'components/chat/ChatRoom.tsx'), 'utf8'),
  ]);

  assert.match(settings, /saveBrowserModelConfig\(browserModelConfig, 'GLOBAL'\)/);
  assert.match(settings, /本地模式仅保存在当前浏览器/);
  assert.match(settings, /Agent 和小助手默认直连 Ollama/);
  assert.match(agentPanel, /跟随个人中心的全局设置/);
  assert.match(agentPanel, /href="\/me\?tab=settings"/);
  assert.doesNotMatch(agentPanel, /当前对话覆盖/);
  assert.match(chatRoom, /readBrowserModelConfigForScope\('GLOBAL'\)/);
  assert.doesNotMatch(chatRoom, /saveBrowserModelConfig/);
});

test('personal assistant messages expose shared actions and scoped single-message deletion', async () => {
  const [provider, api, messagesRoute] = await Promise.all([
    readFile(path.join(projectRoot, 'components/assistant/PersonalAssistantProvider.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'lib/api.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/messages/route.ts'), 'utf8'),
  ]);

  assert.match(provider, /<MessageActions/);
  assert.match(provider, /canRegenerate=\{false\}/);
  assert.match(provider, /navigator\.clipboard\.writeText\(content\)/);
  assert.match(api, /deleteMessage: \(messageId: string\)/);
  assert.match(messagesRoute, /conversationId: profile\.conversationId,[\s\S]*\.\.\.\(messageId \? \{ id: messageId \} : \{\}\)/);
  assert.match(messagesRoute, /data: \{ id: assistantMessageId, conversationId: profile\.conversationId/);
});

test('assistant reminders are idempotent and optimistic failures roll back', async () => {
  const [provider, api, remindersRoute, schema] = await Promise.all([
    readFile(path.join(projectRoot, 'components/assistant/PersonalAssistantProvider.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'lib/api.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/reminders/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'prisma/schema.prisma'), 'utf8'),
  ]);

  assert.match(schema, /@@unique\(\[userId, idempotencyKey\]\)/);
  assert.match(remindersRoute, /assistantReminder\.upsert/);
  assert.match(api, /source: \{ sourceMessageId: string; idempotencyKey: string \}/);
  assert.match(provider, /idempotencyKey: `assistant-reminders:\$\{sourceMessageId\}`/);
  assert.match(provider, /status: item\.status/);
  assert.match(provider, /if \(wasActive\) setActiveReminderAlert\(item\)/);
  assert.match(provider, /if \(previousAlert\) setActiveReminderAlert\(previousAlert\)/);
});

test('interrupted assistant streams preserve and label partial replies', async () => {
  const [provider, messagesRoute] = await Promise.all([
    readFile(path.join(projectRoot, 'components/assistant/PersonalAssistantProvider.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/messages/route.ts'), 'utf8'),
  ]);

  assert.match(messagesRoute, /modelAbortController\.abort\(\)/);
  assert.match(messagesRoute, /await persistAssistantMessage\(\)\.catch/);
  assert.match(messagesRoute, /_回复已中止_/);
  assert.match(provider, /persistLocalMessage\(localConversationId, interruptedAnswer, assistantMessage\.id\)/);
  assert.match(provider, /_回复已中止_/);
});

test('proactive greetings honor persona, server frequency, and expiry', async () => {
  const [provider, proactiveRoute] = await Promise.all([
    readFile(path.join(projectRoot, 'components/assistant/PersonalAssistantProvider.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/proactive/route.ts'), 'utf8'),
  ]);

  assert.match(proactiveRoute, /profile\.soul/);
  assert.match(proactiveRoute, /profile\.identity/);
  assert.match(proactiveRoute, /buildDailyPrompt\(/);
  assert.match(proactiveRoute, /MAX_PROACTIVE_PER_DAY = 5/);
  assert.match(proactiveRoute, /PROACTIVE_COOLDOWN_MS = 75 \* 60 \* 1000/);
  assert.match(proactiveRoute, /data: \{ status: 'EXPIRED', activeKey: null \}/);
  assert.match(proactiveRoute, /expiresAt: deliveryExpiresAt/);
  assert.match(proactiveRoute, /if \(!json\) return null/);
  assert.match(proactiveRoute, /return \{ greeting: null \}/);
  assert.match(provider, /skipProactiveGreeting\(res\.deliveryId\)/);
  assert.match(provider, /assistant\.expireProactiveGreeting\(deliveryId\)/);
});

test('memory routes use normalized duplicate detection and platform guidance is current', async () => {
  const [memoryRoute, extractRoute, promptBuilder] = await Promise.all([
    readFile(path.join(projectRoot, 'app/api/assistant/memories/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/memories/extract/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'lib/personal-assistant/prompt-builder.ts'), 'utf8'),
  ]);

  assert.match(memoryRoute, /isDuplicateMemory/);
  assert.match(extractRoute, /memoryFingerprint/);
  assert.match(promptBuilder, /本地 Ollama 配置只保存在当前浏览器/);
  assert.doesNotMatch(promptBuilder, /全平台生效|独立 Key/);
});
