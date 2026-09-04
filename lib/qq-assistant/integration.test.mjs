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
  assert.doesNotMatch(schema, /\sappSecret\s+String/);
  assert.match(apiRoute, /encryptQQCredential\(appSecret\)/);
  assert.doesNotMatch(apiRoute, /appSecretCiphertext:\s*binding\.appSecretCiphertext/);
  assert.match(internalRoute, /QQ 私聊中回复用户/);
  assert.match(internalRoute, /assistantReminder\.upsert/);
  assert.match(worker, /msg\.kind !== 'c2c'/);
  assert.match(worker, /sendWakeup\(/);
  assert.match(worker, /qqNextAttemptAt/);
  assert.match(ecosystem, /name: 'almaren-chat-qq'/);
});
