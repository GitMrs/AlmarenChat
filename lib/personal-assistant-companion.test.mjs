import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyActivityTimestamps, resolveActivityRange } from './personal-assistant/activity-query.mjs';
import { isDuplicateMemory, memoryFingerprint } from './personal-assistant/memory-dedup.mjs';
import { shouldExtractMemorySuggestion } from './personal-assistant/memory-intent.mjs';
import { shouldSkipEventFollowUp } from './personal-assistant/proactive-follow-up.mjs';
import { resolveProactiveBackoff, resolveProactiveWait } from './personal-assistant/proactive-schedule.mjs';
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

test('long-term memory suggestions only spend a model call on likely personal facts', () => {
  assert.equal(shouldExtractMemorySuggestion('帮我查一下北京天气'), false);
  assert.equal(shouldExtractMemorySuggestion('解释一下这段代码'), false);
  assert.equal(shouldExtractMemorySuggestion('我平时喝咖啡不加糖'), true);
  assert.equal(shouldExtractMemorySuggestion('请记住我的生日是 3 月 2 日'), true);
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

test('proactive care backs off after unanswered deliveries', () => {
  assert.equal(resolveProactiveBackoff(0).cooldownMs, 75 * 60 * 1000);
  assert.equal(resolveProactiveBackoff(1).cooldownMs, 3 * 60 * 60 * 1000);
  assert.equal(resolveProactiveBackoff(2).cooldownMs, 8 * 60 * 60 * 1000);
  assert.equal(resolveProactiveBackoff(3).cooldownMs, 24 * 60 * 60 * 1000);
  assert.equal(resolveProactiveBackoff(20).cooldownMs, 24 * 60 * 60 * 1000);
});

test('a new user interaction resets proactive care to the first interval', () => {
  const now = new Date('2026-09-04T12:00:00.000Z').getTime();
  const wait = resolveProactiveWait({
    now,
    lastUserAt: new Date(now - 30 * 60 * 1000),
    unansweredDeliveries: [],
  });

  assert.equal(wait.level, 0);
  assert.equal(wait.retryAfterMs, 45 * 60 * 1000);
});

test('an unanswered greeting anchors the next backoff window', () => {
  const now = new Date('2026-09-04T12:00:00.000Z').getTime();
  const wait = resolveProactiveWait({
    now,
    lastUserAt: new Date(now - 4 * 60 * 60 * 1000),
    unansweredDeliveries: [{ createdAt: new Date(now - 60 * 60 * 1000) }],
  });

  assert.equal(wait.level, 1);
  assert.equal(wait.retryAfterMs, 2 * 60 * 60 * 1000);
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
  assert.match(messagesRoute, /\.\.\.\(!localMode \? \{[\s\S]*summarize:/);
  assert.match(messagesRoute, /if \(localMode\) \{[\s\S]*return NextResponse\.json\(\{ messages, conversationId, conversationMode \}\)/);
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
  assert.match(api, /deleteMessage: \(messageId: string, conversationId: string\)/);
  assert.match(messagesRoute, /id: requestedConversationId \|\| profile\.conversationId/);
  assert.match(messagesRoute, /where: \{ id: messageId, conversationId: conversation\.id \}/);
  assert.match(messagesRoute, /assistantExperienceId: null/);
  assert.match(messagesRoute, /data: \{ id: assistantMessageId, conversationId, role: 'assistant', source: 'WEB'/);
});

test('assistant main and temporary chats have explicit server-side boundaries', async () => {
  const [schema, conversationsRoute, switchRoute, messagesRoute, memoryRoute, qqRoute, qqMessages, provider] = await Promise.all([
    readFile(path.join(projectRoot, 'prisma/schema.prisma'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/conversations/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/conversations/[conversationId]/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/messages/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/memories/extract/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/qq/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/internal/assistant/qq/messages/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'components/assistant/PersonalAssistantProvider.tsx'), 'utf8'),
  ]);

  assert.match(schema, /assistantMode\s+String\?/);
  assert.match(schema, /source\s+String\s+@default\("WEB"\)/);
  assert.match(conversationsRoute, /assistantMode: 'TEMPORARY'/);
  assert.doesNotMatch(conversationsRoute, /personalAssistantProfile\.update/);
  assert.doesNotMatch(switchRoute, /personalAssistantProfile\.update/);
  assert.match(switchRoute, /主聊天不能删除/);
  assert.match(messagesRoute, /const requestedConversationId = typeof body\.conversationId/);
  assert.match(memoryRoute, /assistantMode: 'MAIN'/);
  assert.match(qqRoute, /conversationId: profile\.conversationId/);
  assert.match(qqMessages, /source: 'QQ'/);
  assert.match(qqMessages, /storedBinding\.conversationId === profile\.conversationId/);
  assert.match(qqMessages, /QQ 与网页共用同一个主聊天上下文/);
  assert.doesNotMatch(qqMessages, /QQ 使用独立话题/);
  assert.doesNotMatch(qqMessages, /data: \{ id: conversationId, userId, kind: 'PERSONAL_ASSISTANT'/);
  assert.match(provider, /data\.conversationMode === 'MAIN'/);
  assert.match(provider, /返回长期连续的主聊天/);
});

test('assistant experience memory archives only the main timeline and remains inspectable', async () => {
  const [schema, memoryRuntime, messagesRoute, qqMessages, bootstrapRoute, experienceRoute, settings] = await Promise.all([
    readFile(path.join(projectRoot, 'prisma/schema.prisma'), 'utf8'),
    readFile(path.join(projectRoot, 'lib/personal-assistant/experience-memory.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/messages/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/internal/assistant/qq/messages/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/experiences/[experienceId]/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'components/assistant/PersonalAssistantSettings.tsx'), 'utf8'),
  ]);

  assert.match(schema, /model AssistantExperience/);
  assert.match(schema, /assistantExperienceId\s+String\?/);
  assert.match(memoryRuntime, /EXPERIENCE_ARCHIVE_TRIGGER = 64/);
  assert.match(memoryRuntime, /EXPERIENCE_ARCHIVE_BATCH = 48/);
  assert.match(memoryRuntime, /assistantMode: 'MAIN'/);
  assert.match(memoryRuntime, /assistantExperienceId: null/);
  assert.match(memoryRuntime, /buildDeterministicExperienceSummary/);
  assert.match(messagesRoute, /conversationMode === 'MAIN'/);
  assert.match(messagesRoute, /includeExperiences: conversationMode === 'MAIN'/);
  assert.match(qqMessages, /includeExperiences: true/);
  assert.match(bootstrapRoute, /prisma\.assistantExperience\.findMany/);
  assert.match(experienceRoute, /where: \{ id: experienceId, userId \}/);
  assert.match(experienceRoute, /messages:/);
  assert.match(settings, /自动经历/);
  assert.match(settings, /临时聊天不会进入这里/);
  assert.match(settings, /查看经历原文/);
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
  assert.match(proactiveRoute, /resolveProactiveWait/);
  assert.match(proactiveRoute, /reason: 'server_backoff'/);
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
