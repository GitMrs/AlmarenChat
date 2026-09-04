import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QQBot,
  concurrencyGuard,
  contentSanitizer,
  messageFilter,
} from '@tencent-connect/qqbot-nodejs';
import { decryptQQCredential } from '../lib/qq-assistant/credentials.mjs';
import { classifyQQCommand, qqReminderRetryDelayMs, sqliteDate } from '../lib/qq-assistant/policy.mjs';
import { resolveWorkerDatabasePath } from './runtime/worker-config.mjs';
import { openWorkerDatabase } from './runtime/worker-database.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secret = process.env.QQ_ASSISTANT_SECRET || '';
const internalUrl = process.env.QQ_ASSISTANT_INTERNAL_URL
  || `http://127.0.0.1:${process.env.PORT || 8001}/api/internal/assistant/qq/messages`;
const pollMs = Math.max(2_000, Number(process.env.QQ_ASSISTANT_POLL_MS) || 5_000);
const db = openWorkerDatabase(resolveWorkerDatabasePath(projectRoot));
const clients = new Map();
let stopping = false;
let reminderLoopRunning = false;

function shortError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function updateBinding(userId, values) {
  const entries = Object.entries(values);
  if (!entries.length) return;
  const assignments = entries.map(([key]) => `"${key}" = @${key}`).join(', ');
  db.prepare(`UPDATE "AssistantQQBinding" SET ${assignments}, "updatedAt" = @updatedAt WHERE "userId" = @userId`)
    .run({ userId, updatedAt: sqliteDate(), ...values });
}

function currentBinding(userId) {
  return db.prepare('SELECT * FROM "AssistantQQBinding" WHERE "userId" = ?').get(userId);
}

function deliveredReminders(userId) {
  return db.prepare(`
    SELECT * FROM "AssistantReminder"
    WHERE "userId" = ?
      AND "status" = 'PENDING'
      AND "qqDeliveredAt" IS NOT NULL
      AND "dueTime" IS NOT NULL
      AND "dueTime" <= ?
    ORDER BY "qqDeliveredAt" DESC
    LIMIT 20
  `).all(userId, sqliteDate());
}

function applyReminderCommand(userId, command, refMsgIdx, eventId) {
  if (!['REMINDER_COMPLETE', 'REMINDER_DISMISS', 'REMINDER_SNOOZE'].includes(command.type)) return null;
  const handled = db.prepare('SELECT 1 FROM "AssistantQQEvent" WHERE "id" = ?').get(eventId);
  if (handled) return '这条操作已经处理过了。';
  const reminders = deliveredReminders(userId);
  const reminder = refMsgIdx
    ? reminders.find((item) => item.qqMessageId === refMsgIdx)
    : reminders.length === 1 ? reminders[0] : null;
  if (!reminder && reminders.length > 1) return '你有多条未完成提醒，请引用需要处理的那一条再回复。';
  if (!reminder) return null;
  const updatedAt = sqliteDate();
  const recordEvent = db.prepare(`
    INSERT INTO "AssistantQQEvent" ("id", "userId", "kind", "createdAt")
    VALUES (?, ?, ?, ?)
  `);

  if (command.type === 'REMINDER_COMPLETE') {
    db.transaction(() => {
      db.prepare('UPDATE "AssistantReminder" SET "status" = ?, "updatedAt" = ? WHERE "id" = ?')
        .run('COMPLETED', updatedAt, reminder.id);
      recordEvent.run(eventId, userId, command.type, updatedAt);
    })();
    return `已完成「${reminder.content}」。`;
  }
  if (command.type === 'REMINDER_DISMISS') {
    db.transaction(() => {
      db.prepare('UPDATE "AssistantReminder" SET "status" = ?, "updatedAt" = ? WHERE "id" = ?')
        .run('DISMISSED', updatedAt, reminder.id);
      recordEvent.run(eventId, userId, command.type, updatedAt);
    })();
    return `已取消「${reminder.content}」的提醒。`;
  }

  const dueTime = sqliteDate(new Date(Date.now() + command.minutes * 60_000));
  db.transaction(() => {
    db.prepare(`
      UPDATE "AssistantReminder"
      SET "dueTime" = ?, "qqDeliveredAt" = NULL, "qqMessageId" = NULL,
          "qqDeliveryAttempts" = 0, "qqNextAttemptAt" = NULL, "qqDeliveryError" = NULL,
          "updatedAt" = ?
      WHERE "id" = ?
    `).run(dueTime, updatedAt, reminder.id);
    recordEvent.run(eventId, userId, command.type, updatedAt);
  })();
  return `好，${command.minutes} 分钟后再提醒你「${reminder.content}」。`;
}

async function requestAssistant(binding, message, eventId) {
  const response = await fetch(internalUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qq-assistant-secret': secret,
    },
    body: JSON.stringify({ userId: binding.userId, message, eventId }),
    signal: AbortSignal.timeout(180_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `内部小伴接口返回 HTTP ${response.status}`);
  return result.content;
}

async function sendReply(bot, target, content) {
  const chunks = String(content || '').match(/[\s\S]{1,4800}/g)?.slice(0, 4) || [];
  for (const chunk of chunks) await bot.sendText(target, chunk);
}

async function handleMessage(entry, msg) {
  if (msg.kind !== 'c2c' || msg.replyTarget.scope !== 'c2c') return;
  const content = msg.content?.trim();
  if (!content) return;

  const binding = currentBinding(entry.userId);
  if (!binding?.enabled || binding.appId !== entry.appId) return;
  if (binding.qqOpenId && binding.qqOpenId !== msg.senderId) return;

  const now = sqliteDate();
  updateBinding(entry.userId, {
    qqOpenId: binding.qqOpenId || msg.senderId,
    lastInboundAt: now,
    status: 'READY',
    lastError: null,
  });

  try {
    const command = classifyQQCommand(content);
    const reminderReply = applyReminderCommand(
      entry.userId,
      command,
      msg.refMsgIdx,
      `${entry.appId}:${msg.messageId}`
    );
    const reply = reminderReply || await requestAssistant(binding, content, msg.messageId);
    await sendReply(entry.bot, msg.replyTarget, reply);
  } catch (error) {
    const message = shortError(error);
    updateBinding(entry.userId, { lastError: message });
    await entry.bot.sendText(msg.replyTarget, `这次回复没有成功：${message}`).catch(() => {});
  }
}

function startBinding(binding) {
  let appSecret;
  try {
    appSecret = decryptQQCredential(binding.appSecretCiphertext, secret);
  } catch (error) {
    updateBinding(binding.userId, { status: 'ERROR', lastError: shortError(error), connectedAt: null });
    return;
  }

  const bot = new QQBot({
    appId: binding.appId,
    appSecret,
    accountId: binding.userId,
    logger: console,
  });
  const entry = {
    userId: binding.userId,
    appId: binding.appId,
    credentialVersion: binding.appSecretCiphertext,
    bot,
    ready: false,
    lastProactiveAt: 0,
  };
  clients.set(binding.userId, entry);
  updateBinding(binding.userId, { status: 'CONNECTING', lastError: null, connectedAt: null });

  bot.use(
    messageFilter({ dedup: { windowMs: 60_000, maxSize: 5_000 } }),
    contentSanitizer(),
    concurrencyGuard({ strategy: 'queue', maxQueue: 5, maxProcessingMs: 190_000 })
  );
  bot.on('ready', () => {
    entry.ready = true;
    updateBinding(binding.userId, { status: 'READY', lastError: null, connectedAt: sqliteDate() });
  });
  bot.on('resumed', () => {
    entry.ready = true;
    updateBinding(binding.userId, { status: 'READY', lastError: null });
  });
  bot.on('error', (error) => {
    updateBinding(binding.userId, { status: entry.ready ? 'READY' : 'ERROR', lastError: shortError(error) });
  });
  bot.on('message', (_ctx, msg) => handleMessage(entry, msg));

  bot.start().catch((error) => {
    updateBinding(binding.userId, { status: 'ERROR', lastError: shortError(error), connectedAt: null });
  }).finally(() => {
    if (clients.get(binding.userId) === entry) clients.delete(binding.userId);
  });
}

function reconcileBindings() {
  if (stopping || secret.length < 32) return;
  const bindings = db.prepare('SELECT * FROM "AssistantQQBinding"').all();
  const activeUserIds = new Set(bindings.filter((item) => item.enabled).map((item) => item.userId));

  for (const [userId, entry] of clients) {
    const binding = bindings.find((item) => item.userId === userId);
    const changed = !binding
      || !binding.enabled
      || binding.appId !== entry.appId
      || binding.appSecretCiphertext !== entry.credentialVersion;
    if (changed) {
      entry.bot.stop();
      clients.delete(userId);
    }
  }

  for (const binding of bindings) {
    if (binding.enabled && activeUserIds.has(binding.userId) && !clients.has(binding.userId)) {
      startBinding(binding);
    }
  }
}

async function deliverDueReminders() {
  if (stopping || secret.length < 32 || reminderLoopRunning) return;
  reminderLoopRunning = true;
  try {
    const now = sqliteDate();
    const reminders = db.prepare(`
      SELECT r.*, b."qqOpenId"
      FROM "AssistantReminder" r
      JOIN "AssistantQQBinding" b ON b."userId" = r."userId"
      WHERE r."status" = 'PENDING'
        AND r."dueTime" IS NOT NULL
        AND r."dueTime" <= ?
        AND r."qqDeliveredAt" IS NULL
        AND (r."qqNextAttemptAt" IS NULL OR r."qqNextAttemptAt" <= ?)
        AND b."enabled" = 1
        AND b."qqOpenId" IS NOT NULL
      ORDER BY r."dueTime" ASC
      LIMIT 20
    `).all(now, now);

    for (const reminder of reminders) {
      const entry = clients.get(reminder.userId);
      if (!entry?.ready) continue;
      if (Date.now() - entry.lastProactiveAt < pollMs) continue;
      const leaseUntil = sqliteDate(new Date(Date.now() + 5 * 60_000));
      const claimed = db.prepare(`
        UPDATE "AssistantReminder"
        SET "qqNextAttemptAt" = ?, "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'PENDING' AND "dueTime" <= ? AND "qqDeliveredAt" IS NULL
          AND ("qqNextAttemptAt" IS NULL OR "qqNextAttemptAt" <= ?)
      `).run(leaseUntil, now, reminder.id, now, now);
      if (claimed.changes !== 1) continue;
      entry.lastProactiveAt = Date.now();

      try {
        const sent = await entry.bot.sendWakeup(
          { scope: 'c2c', targetId: reminder.qqOpenId },
          `提醒你：${reminder.content}\n\n引用本条提醒并回复“完成了”、“延后10分钟”或“取消提醒”可以直接处理。`
        );
        db.prepare(`
          UPDATE "AssistantReminder"
          SET "qqDeliveredAt" = ?, "qqMessageId" = ?, "qqDeliveryError" = NULL,
              "qqNextAttemptAt" = NULL, "updatedAt" = ?
          WHERE "id" = ? AND "qqDeliveredAt" IS NULL
        `).run(now, sent?.ext_info?.ref_idx || sent?.id || null, now, reminder.id);
      } catch (error) {
        const attempts = (reminder.qqDeliveryAttempts || 0) + 1;
        const nextAttemptAt = sqliteDate(new Date(Date.now() + qqReminderRetryDelayMs(attempts - 1)));
        db.prepare(`
          UPDATE "AssistantReminder"
          SET "qqDeliveryAttempts" = ?, "qqNextAttemptAt" = ?, "qqDeliveryError" = ?, "updatedAt" = ?
          WHERE "id" = ? AND "qqDeliveredAt" IS NULL
        `).run(attempts, nextAttemptAt, shortError(error), now, reminder.id);
      }
    }
  } finally {
    reminderLoopRunning = false;
  }
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(bindingTimer);
  clearInterval(reminderTimer);
  for (const entry of clients.values()) entry.bot.stop();
  clients.clear();
  db.close();
}

if (secret.length < 32) {
  console.warn('[qq-assistant] QQ_ASSISTANT_SECRET 未配置，QQ Bot Worker 保持待命。');
} else {
  reconcileBindings();
  void deliverDueReminders();
}

const bindingTimer = setInterval(reconcileBindings, pollMs);
const reminderTimer = setInterval(() => void deliverDueReminders(), pollMs);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
