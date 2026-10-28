import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReminderExtractionPrompt, parseReminderExtraction } from '../personal-assistant/reminder-extraction.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('reminder extraction is shared by web and QQ with normalized dates', () => {
  const now = new Date('2026-09-04T04:00:00.000Z');
  assert.match(buildReminderExtractionPrompt('下午三点提醒我买菜', now), /2026-09-04T12:00:00\.000\+08:00/);
  assert.deepEqual(parseReminderExtraction('```json\n{"hasReminder":true,"items":[{"content":"买菜","dueTime":"2026-09-04T15:00:00+08:00"}]}\n```'), [
    { content: '买菜', dueTime: new Date('2026-09-04T07:00:00.000Z') },
  ]);
  assert.deepEqual(parseReminderExtraction('not-json'), []);
});

test('QQ integration keeps secrets server-side and runs as a PM2 worker', async () => {
  const [schema, apiRoute, internalRoute, worker, ecosystem] = await Promise.all([
    readFile(path.join(projectRoot, 'prisma/schema.prisma'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/assistant/qq/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/internal/assistant/qq/messages/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'worker/qq-assistant.mjs'), 'utf8'),
    readFile(path.join(projectRoot, 'ecosystem.config.cjs'), 'utf8'),
  ]);

  assert.match(schema, /appSecretCiphertext\s+String/);
  assert.match(schema, /webhookTokenHash\s+String\?/);
  assert.match(schema, /webhookTokenCiphertext\s+String\?/);
  assert.doesNotMatch(schema, /\sappSecret\s+String/);
  assert.match(apiRoute, /encryptQQCredential\(appSecret\)/);
  assert.match(apiRoute, /generate-webhook/);
  assert.match(apiRoute, /reveal-webhook/);
  assert.match(apiRoute, /bcrypt\.compare\(password, user\.passwordHash\)/);
  assert.match(apiRoute, /decryptQQCredential\(existing\.webhookTokenCiphertext\)/);
  assert.match(apiRoute, /hashQQWebhookToken/);
  assert.doesNotMatch(apiRoute, /appSecretCiphertext:\s*binding\.appSecretCiphertext/);
  assert.match(internalRoute, /QQ 私聊中回复用户/);
  assert.match(internalRoute, /createChatWebTools\(/);
  assert.match(internalRoute, /webEnabled:\s*true/);
  assert.match(internalRoute, /type:\s*'image_url'/);
  assert.match(internalRoute, /attachments:\s*imageAttachments\.length/);
  assert.match(internalRoute, /body\.stream === true/);
  assert.match(internalRoute, /application\/x-ndjson/);
  assert.match(internalRoute, /assistantReminder\.upsert/);
  assert.match(worker, /msg\.kind !== 'c2c'/);
  assert.match(worker, /removeWebSearchMenu\(bot, binding\.appId\)/);
  assert.match(worker, /switch_id === 'web_search'/);
  assert.match(worker, /qqImageAttachments\(msg\.attachments\)/);
  assert.match(worker, /attachments, stream:\s*true/);
  assert.match(worker, /openStream\(/);
  assert.match(worker, /sendMarkdown\(/);
  assert.match(worker, /sendWakeup\(/);
  assert.match(worker, /QQ_WEBHOOK_PATH/);
  assert.match(worker, /webhookTokenHash/);
  assert.match(worker, /QQ_ASSISTANT_WEBHOOK_PORT\) \|\| 8787/);
  assert.match(worker, /qqNextAttemptAt/);
  assert.match(ecosystem, /name: 'almaren-chat-qq'/);
  assert.match(ecosystem, /QQ_ASSISTANT_WEBHOOK_PORT/);
});

test('Agent QQ bots use isolated bindings and share the Agent main conversation', async () => {
  const [schema, apiRoute, testRoute, internalRoute, worker, clientApi, detailsPanel, settingsUi, docs, envExample, bindingsRoute, botManager, mePage] = await Promise.all([
    readFile(path.join(projectRoot, 'prisma/schema.prisma'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/agents/[agentId]/qq/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/agents/[agentId]/qq/test/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/internal/agents/qq/messages/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'worker/qq-assistant.mjs'), 'utf8'),
    readFile(path.join(projectRoot, 'lib/client/api.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'components/chat/AgentDetailsPanel.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'components/chat/AgentQQSettings.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'docs/qq-assistant.md'), 'utf8'),
    readFile(path.join(projectRoot, '.env.example'), 'utf8'),
    readFile(path.join(projectRoot, 'app/api/qq/bindings/route.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'components/settings/BotBindingsManager.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'app/me/page.tsx'), 'utf8'),
  ]);

  assert.match(schema, /model QqBotAccount/);
  assert.match(schema, /model QqUserIdentity/);
  assert.match(schema, /model AgentQQBinding/);
  assert.match(schema, /@@unique\(\[userId, agentId\]\)/);
  assert.match(schema, /conversationId\s+String\s+@unique/);
  assert.match(apiRoute, /resolveAgent\(agentId, userId\)/);
  assert.match(apiRoute, /ensureAgentMainConversation\(userId, agentId\)/);
  assert.match(apiRoute, /QQ_MAX_BOTS_PER_USER/);
  assert.match(apiRoute, /encryptQQCredential\(appSecret\)/);
  assert.match(apiRoute, /prisma\.qqUserIdentity\.deleteMany/);
  assert.match(apiRoute, /agentQQBinding\.count/);
  assert.match(testRoute, /QQ_ASSISTANT_WEBHOOK_INTERNAL_URL/);
  assert.match(internalRoute, /bindingId/);
  assert.match(internalRoute, /binding\.agentId !== agentId/);
  assert.match(internalRoute, /binding\.conversationId !== conversationId/);
  assert.match(internalRoute, /type:\s*'delta'/);
  assert.match(internalRoute, /type:\s*'done'/);
  assert.match(internalRoute, /eventMessageId\('assistant', eventScope, eventId\)/);
  assert.match(worker, /agentBindingRows\(/);
  assert.match(worker, /agent:\$\{binding\.id\}/);
  assert.match(worker, /requestAgentAssistant\(entry, content, msg\.messageId/);
  assert.match(worker, /AgentQQBinding/);
  assert.match(worker, /QqUserIdentity/);
  assert.match(worker, /agentBindingByWebhookHash/);
  assert.match(clientApi, /saveQQBinding/);
  assert.match(detailsPanel, /接入 Bot 通道/);
  assert.match(settingsUi, /接入 QQ Bot/);
  assert.match(settingsUi, /消息不会互相串线/);
  assert.match(docs, /Agent 独立 QQ Bot/);
  assert.match(docs, /QQ_AGENT_INTERNAL_URL/);
  assert.match(envExample, /QQ_MAX_BOTS_PER_USER/);
  assert.match(bindingsRoute, /assistantQQBinding\.findUnique/);
  assert.match(bindingsRoute, /agentQQBinding\.findMany/);
  assert.match(botManager, /解除这个 Bot 绑定/);
  assert.match(botManager, /查看 Agent/);
  assert.match(mePage, /Bot 管理/);
});
