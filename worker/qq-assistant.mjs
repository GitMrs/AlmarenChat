import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QQBot,
  concurrencyGuard,
  contentSanitizer,
  messageFilter,
} from '@tencent-connect/qqbot-nodejs';
import { decryptQQCredential } from '../lib/qq-assistant/credentials.mjs';
import { hashQQWebhookToken, QQ_WEBHOOK_PATH } from '../lib/qq-assistant/webhook.mjs';
import {
  classifyQQCommand,
  qqImageAttachments,
  qqReminderRetryDelayMs,
  sqliteDate,
} from '../lib/qq-assistant/policy.mjs';
import { resolveWorkerDatabasePath } from './runtime/worker-config.mjs';
import { openWorkerDatabase } from './runtime/worker-database.mjs';
import { createScheduler } from '../lib/core/scheduler.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secret = process.env.QQ_ASSISTANT_SECRET || '';
const internalUrl = process.env.QQ_ASSISTANT_INTERNAL_URL
  || `http://127.0.0.1:${process.env.PORT || 8001}/api/internal/assistant/qq/messages`;
const agentInternalUrl = process.env.QQ_AGENT_INTERNAL_URL
  || new URL('/api/internal/agents/qq/messages', internalUrl).toString();
const pollMs = Math.max(2_000, Number(process.env.QQ_ASSISTANT_POLL_MS) || 5_000);
const webhookPort = Math.max(0, Number(process.env.QQ_ASSISTANT_WEBHOOK_PORT) || 8787);
const webhookHost = process.env.QQ_ASSISTANT_WEBHOOK_HOST || '127.0.0.1';
const db = openWorkerDatabase(resolveWorkerDatabasePath(projectRoot));
const clients = new Map();
const recentWebhookEvents = new Map();
let stopping = false;
let reminderLoopRunning = false;
let webhookServer = null;
const scheduler = createScheduler({
  name: 'qq-assistant-scheduler',
  pollMs,
  isStopping: () => stopping,
});

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

function updateAgentAccount(accountId, values) {
  const entries = Object.entries(values);
  if (!entries.length) return;
  const assignments = entries.map(([key]) => `"${key}" = @${key}`).join(', ');
  db.prepare(`UPDATE "QqBotAccount" SET ${assignments}, "updatedAt" = @updatedAt WHERE "id" = @id`)
    .run({ id: accountId, updatedAt: sqliteDate(), ...values });
}

function updateAgentBinding(bindingId, values) {
  const entries = Object.entries(values);
  if (!entries.length) return;
  const assignments = entries.map(([key]) => `"${key}" = @${key}`).join(', ');
  db.prepare(`UPDATE "AgentQQBinding" SET ${assignments}, "updatedAt" = @updatedAt WHERE "id" = @id`)
    .run({ id: bindingId, updatedAt: sqliteDate(), ...values });
}

function agentBindingRows() {
  return db.prepare(`
    SELECT b.*,
           a."appId" AS "accountAppId",
           a."appSecretCiphertext" AS "accountAppSecretCiphertext",
           a."enabled" AS "accountEnabled",
           a."status" AS "accountStatus"
    FROM "AgentQQBinding" b
    JOIN "QqBotAccount" a ON a."id" = b."botAccountId"
  `).all();
}

function agentBindingRow(bindingId) {
  return db.prepare(`
    SELECT b.*,
           a."appId" AS "accountAppId",
           a."appSecretCiphertext" AS "accountAppSecretCiphertext",
           a."enabled" AS "accountEnabled",
           a."status" AS "accountStatus"
    FROM "AgentQQBinding" b
    JOIN "QqBotAccount" a ON a."id" = b."botAccountId"
    WHERE b."id" = ?
  `).get(bindingId);
}

function agentBindingByWebhookHash(hash) {
  return db.prepare(`
    SELECT b.*,
           a."appId" AS "accountAppId",
           a."appSecretCiphertext" AS "accountAppSecretCiphertext",
           a."enabled" AS "accountEnabled",
           a."status" AS "accountStatus",
           c."agentName" AS "agentName"
    FROM "AgentQQBinding" b
    JOIN "QqBotAccount" a ON a."id" = b."botAccountId"
    LEFT JOIN "Conversation" c ON c."id" = b."conversationId"
    WHERE b."webhookTokenHash" = ?
    LIMIT 1
  `).get(hash);
}

function agentIdentity(userId, botAccountId) {
  return db.prepare('SELECT * FROM "QqUserIdentity" WHERE "userId" = ? AND "botAccountId" = ?')
    .get(userId, botAccountId);
}

function ensureAgentIdentity(userId, botAccountId, qqOpenId) {
  const existing = agentIdentity(userId, botAccountId);
  if (existing) return existing;
  const now = sqliteDate();
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO "QqUserIdentity" ("id", "userId", "botAccountId", "qqOpenId", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, userId, botAccountId, qqOpenId, now, now);
  } catch (error) {
    if (!String(error?.code || '').includes('CONSTRAINT')) throw error;
  }
  return agentIdentity(userId, botAccountId);
}

function personalBindingDescriptor(row) {
  return {
    kind: 'PERSONAL',
    key: `personal:${row.userId}`,
    id: row.userId,
    userId: row.userId,
    agentId: null,
    conversationId: row.conversationId,
    appId: row.appId,
    appSecretCiphertext: row.appSecretCiphertext,
    credentialVersion: row.appSecretCiphertext,
    enabled: Boolean(row.enabled),
  };
}

function agentBindingDescriptor(row) {
  return {
    kind: 'AGENT',
    key: `agent:${row.id}`,
    id: row.id,
    userId: row.userId,
    agentId: row.agentId,
    conversationId: row.conversationId,
    botAccountId: row.botAccountId,
    appId: row.accountAppId,
    appSecretCiphertext: row.accountAppSecretCiphertext,
    credentialVersion: row.accountAppSecretCiphertext,
    enabled: Boolean(row.enabled && row.accountEnabled),
  };
}

function setBindingStatus(entry, status, values = {}) {
  if (entry.kind === 'AGENT') {
    updateAgentAccount(entry.botAccountId, { status, ...values });
  } else {
    updateBinding(entry.userId, { status, ...values });
  }
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

async function requestAssistant(binding, message, eventId, attachments, onProgress) {
  const response = await fetch(internalUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qq-assistant-secret': secret,
    },
    body: JSON.stringify({ userId: binding.userId, message, eventId, attachments, stream: true }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `内部小伴接口返回 HTTP ${response.status}`);
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const result = await response.json().catch(() => ({}));
    return { content: result.content || '', streamed: false };
  }
  if (!response.body) throw new Error('内部小伴接口没有返回消息流');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finalContent = '';
  let displayedContent = '';

  const consumeLine = async (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error || 'QQ 小伴回复失败');
    if (event.type === 'status') {
      const nextContent = event.label ? `${content}\n\n_${event.label}_`.trimStart() : content;
      if (nextContent && nextContent !== displayedContent) {
        displayedContent = nextContent;
        await onProgress?.(nextContent);
      }
    }
    if (event.type === 'delta' && typeof event.content === 'string') {
      content += event.content;
      const nextContent = content.trimStart();
      if (nextContent && nextContent !== displayedContent) {
        displayedContent = nextContent;
        await onProgress?.(nextContent);
      }
    }
    if (event.type === 'done' && typeof event.content === 'string') {
      finalContent = event.content;
      if (finalContent && finalContent !== displayedContent) {
        displayedContent = finalContent;
        await onProgress?.(finalContent);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) await consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) await consumeLine(buffer);
  return { content: finalContent || content, streamed: true };
}

async function requestAgentAssistant(entry, message, eventId, attachments, onProgress) {
  const response = await fetch(agentInternalUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qq-assistant-secret': secret,
    },
    body: JSON.stringify({
      bindingId: entry.id,
      userId: entry.userId,
      agentId: entry.agentId,
      conversationId: entry.conversationId,
      message,
      eventId,
      attachments,
      stream: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `内部 Agent QQ 接口返回 HTTP ${response.status}`);
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const result = await response.json().catch(() => ({}));
    return { content: result.content || '', streamed: false };
  }
  if (!response.body) throw new Error('内部 Agent QQ 接口没有返回消息流');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finalContent = '';
  let displayedContent = '';

  const consumeLine = async (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.error || 'Agent QQ 回复失败');
    if (event.type === 'status') {
      const nextContent = event.label ? `${content}\n\n_${event.label}_`.trimStart() : content;
      if (nextContent && nextContent !== displayedContent) {
        displayedContent = nextContent;
        await onProgress?.(nextContent);
      }
    }
    if (event.type === 'delta' && typeof event.content === 'string') {
      content += event.content;
      const nextContent = content.trimStart();
      if (nextContent && nextContent !== displayedContent) {
        displayedContent = nextContent;
        await onProgress?.(nextContent);
      }
    }
    if (event.type === 'done' && typeof event.content === 'string') {
      finalContent = event.content;
      if (finalContent && finalContent !== displayedContent) {
        displayedContent = finalContent;
        await onProgress?.(finalContent);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) await consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) await consumeLine(buffer);
  return { content: finalContent || content, streamed: true };
}

async function sendMarkdownReply(bot, target, content) {
  const chunks = String(content || '').match(/[\s\S]{1,4800}/g)?.slice(0, 4) || [];
  for (const chunk of chunks) await bot.sendMarkdown(target, chunk);
}

async function removeWebSearchMenu(bot, appId) {
  try {
    const response = await bot.api.get('/v2/menu');
    const menu = response?.menu && typeof response.menu === 'object' ? response.menu : {};
    const items = Array.isArray(menu.items) ? menu.items : [];
    const nextItems = items.filter((item) => !(item?.type === 'switch' && item.switch?.switch_id === 'web_search'));
    if (JSON.stringify(nextItems) === JSON.stringify(items)) return;
    await bot.api.put('/v2/menu', { menu: { ...menu, items: nextItems } });
    console.info(`[qqbot:${appId}] 已移除废弃的联网查询菜单`);
  } catch (error) {
    console.warn(`[qqbot:${appId}] 废弃联网查询菜单移除失败：${shortError(error)}`);
  }
}

async function handleMessage(entry, msg) {
  if (msg.kind !== 'c2c' || msg.replyTarget.scope !== 'c2c') return;
  const attachments = qqImageAttachments(msg.attachments);
  const content = msg.content?.trim() || (attachments.length ? '请分析这张图片。' : '');
  if (!content) return;

  const now = sqliteDate();
  let binding;
  if (entry.kind === 'AGENT') {
    binding = agentBindingRow(entry.id);
    if (!binding?.enabled || !binding.accountEnabled || binding.accountAppId !== entry.appId) return;
    const identity = agentIdentity(entry.userId, entry.botAccountId);
    if (identity && identity.qqOpenId !== msg.senderId) return;
    const boundIdentity = ensureAgentIdentity(entry.userId, entry.botAccountId, msg.senderId);
    if (!boundIdentity || boundIdentity.qqOpenId !== msg.senderId) return;
    updateAgentBinding(entry.id, { lastInboundAt: now });
    updateAgentAccount(entry.botAccountId, { status: 'READY', lastError: null });
  } else {
    binding = currentBinding(entry.userId);
    if (!binding?.enabled || binding.appId !== entry.appId) return;
    if (binding.qqOpenId && binding.qqOpenId !== msg.senderId) return;
    updateBinding(entry.userId, {
      qqOpenId: binding.qqOpenId || msg.senderId,
      lastInboundAt: now,
      status: 'READY',
      lastError: null,
    });
  }

  try {
    if (entry.kind === 'PERSONAL') {
      const command = classifyQQCommand(content);
      const reminderReply = applyReminderCommand(
        entry.userId,
        command,
        msg.refMsgIdx,
        `${entry.appId}:${msg.messageId}`
      );
      if (reminderReply) {
        await sendMarkdownReply(entry.bot, msg.replyTarget, reminderReply);
        return;
      }
    }

    const qqStream = entry.bot.openStream({ target: msg.replyTarget });
    let streamError = null;
    const onProgress = async (fullContent) => {
      if (streamError || !fullContent) return;
      try {
        await qqStream.update(fullContent);
      } catch (error) {
        streamError = error;
        qqStream.cancel();
      }
    };
    const result = entry.kind === 'AGENT'
      ? await requestAgentAssistant(entry, content, msg.messageId, attachments, onProgress)
      : await requestAssistant(binding, content, msg.messageId, attachments, onProgress);

    if (streamError || !result.streamed) {
      qqStream.cancel();
      await sendMarkdownReply(entry.bot, msg.replyTarget, result.content);
      return;
    }

    try {
      await qqStream.complete();
    } catch {
      qqStream.cancel();
      await sendMarkdownReply(entry.bot, msg.replyTarget, result.content);
    }
  } catch (error) {
    const message = shortError(error);
    if (entry.kind === 'AGENT') updateAgentAccount(entry.botAccountId, { lastError: message });
    else updateBinding(entry.userId, { lastError: message });
    await entry.bot.sendText(msg.replyTarget, `这次回复没有成功：${message}`).catch(() => {});
  }
}

function startBinding(binding) {
  let appSecret;
  try {
    appSecret = decryptQQCredential(binding.appSecretCiphertext, secret);
  } catch (error) {
    if (binding.kind === 'AGENT') {
      updateAgentAccount(binding.botAccountId, { status: 'ERROR', lastError: shortError(error), connectedAt: null });
    } else {
      updateBinding(binding.userId, { status: 'ERROR', lastError: shortError(error), connectedAt: null });
    }
    return;
  }

  const bot = new QQBot({
    appId: binding.appId,
    appSecret,
    accountId: binding.kind === 'PERSONAL' ? binding.userId : binding.key,
    logger: console,
  });
  const entry = {
    ...binding,
    bot,
    ready: false,
    lastProactiveAt: 0,
  };
  clients.set(binding.key, entry);
  setBindingStatus(entry, 'CONNECTING', { lastError: null, connectedAt: null });

  bot.use(
    messageFilter({ dedup: { windowMs: 60_000, maxSize: 5_000 } }),
    contentSanitizer(),
    concurrencyGuard({ strategy: 'queue', maxQueue: 5, maxProcessingMs: 190_000 })
  );
  bot.on('ready', () => {
    entry.ready = true;
    setBindingStatus(entry, 'READY', { lastError: null, connectedAt: sqliteDate() });
    void removeWebSearchMenu(bot, binding.appId);
  });
  bot.on('resumed', () => {
    entry.ready = true;
    setBindingStatus(entry, 'READY', { lastError: null });
  });
  bot.on('error', (error) => {
    setBindingStatus(entry, entry.ready ? 'READY' : 'ERROR', { lastError: shortError(error) });
  });
  bot.on('message', (_ctx, msg) => handleMessage(entry, msg));

  bot.start().catch((error) => {
    setBindingStatus(entry, 'ERROR', { lastError: shortError(error), connectedAt: null });
  }).finally(() => {
    if (clients.get(binding.key) === entry) clients.delete(binding.key);
  });
}

function reconcileBindings() {
  if (stopping || secret.length < 32) return;
  const personal = db.prepare('SELECT * FROM "AssistantQQBinding"').all().map(personalBindingDescriptor);
  const agent = agentBindingRows().map(agentBindingDescriptor);
  const desired = new Map(
    [...personal, ...agent]
      .filter((binding) => binding.enabled)
      .map((binding) => [binding.key, binding])
  );

  for (const [key, entry] of clients) {
    const binding = desired.get(key);
    const changed = !binding
      || binding.appId !== entry.appId
      || binding.credentialVersion !== entry.credentialVersion
      || binding.conversationId !== entry.conversationId;
    if (changed) {
      entry.bot.stop();
      clients.delete(key);
    }
  }

  const activeAppIds = new Set(
    [...clients.values()]
      .filter((entry) => entry.ready || entry.bot)
      .map((entry) => entry.appId)
  );
  for (const [key, binding] of desired) {
    if (clients.has(key)) continue;
    if (activeAppIds.has(binding.appId)) {
      console.warn(`[qq-assistant] AppID ${binding.appId} 被多个绑定复用，已跳过 ${key}`);
      continue;
    }
    activeAppIds.add(binding.appId);
    startBinding(binding);
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
      const entry = clients.get(`personal:${reminder.userId}`);
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

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonRequest(request, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        reject(Object.assign(new Error('请求内容过大'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error('请求内容不是有效 JSON'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function cleanupWebhookEvents(now = Date.now()) {
  for (const [key, expiresAt] of recentWebhookEvents) {
    if (expiresAt <= now) recentWebhookEvents.delete(key);
  }
}

async function handleAgentWebhookRequest(response, binding, body) {
  const identity = agentIdentity(binding.userId, binding.botAccountId);
  const entry = clients.get(`agent:${binding.id}`);
  if (!entry?.ready || !identity?.qqOpenId) {
    writeJson(response, 409, {
      error: identity?.qqOpenId ? 'QQ Bot 当前未连接' : '请先在 QQ 中私聊这个 Agent 的机器人完成接收方绑定',
    });
    return;
  }

  const content = typeof body.content === 'string'
    ? body.content.trim().slice(0, 12_000)
    : typeof body.content?.text === 'string' ? body.content.text.trim().slice(0, 12_000) : '';
  if (!content) {
    writeJson(response, 400, { error: '通知内容不能为空' });
    return;
  }
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim().slice(0, 240) : '';
  cleanupWebhookEvents();
  const eventKey = idempotencyKey ? `agent:${binding.id}:${idempotencyKey}` : '';
  if (eventKey && recentWebhookEvents.has(eventKey)) {
    writeJson(response, 200, { sent: true, deduplicated: true });
    return;
  }

  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim().slice(0, 160)
    : typeof body.content?.title === 'string' && body.content.title.trim()
      ? body.content.title.trim().slice(0, 160) : `${binding.agentName || 'Agent'} 通知`;
  const status = typeof body.status === 'string' && body.status.trim()
    ? body.status.trim().slice(0, 40)
    : typeof body.run?.status === 'string' && body.run.status.trim()
      ? body.run.status.trim().slice(0, 40) : 'COMPLETED';
  const message = `【${binding.agentName || 'Agent'}】${title}\n状态：${status}\n\n${content}`;
  try {
    const sent = await entry.bot.sendWakeup(
      { scope: 'c2c', targetId: identity.qqOpenId },
      message
    );
    updateAgentBinding(binding.id, { webhookLastUsedAt: sqliteDate() });
    if (eventKey) recentWebhookEvents.set(eventKey, Date.now() + 10 * 60_000);
    writeJson(response, 200, { sent: true, messageId: sent?.ext_info?.ref_idx || sent?.id || null });
  } catch (error) {
    updateAgentAccount(binding.botAccountId, { lastError: shortError(error) });
    writeJson(response, 502, { error: shortError(error) });
  }
}

async function handleWebhookRequest(request, response) {
  const url = new URL(request.url || '/', 'http://localhost');
  const prefix = `${QQ_WEBHOOK_PATH}/`;
  if (request.method !== 'POST' || !url.pathname.startsWith(prefix)) {
    writeJson(response, 404, { error: 'Not found' });
    return;
  }

  let token;
  try {
    token = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    writeJson(response, 404, { error: 'Webhook 地址无效' });
    return;
  }
  if (!token || token.includes('/')) {
    writeJson(response, 404, { error: 'Webhook 地址无效' });
    return;
  }
  const webhookHash = hashQQWebhookToken(token);
  const agentBinding = agentBindingByWebhookHash(webhookHash);
  const binding = agentBinding
    || db.prepare('SELECT * FROM "AssistantQQBinding" WHERE "webhookTokenHash" = ? LIMIT 1').get(webhookHash);
  if (!binding) {
    writeJson(response, 401, { error: 'Webhook 地址无效或已失效' });
    return;
  }
  if (agentBinding) {
    if (!agentBinding.enabled || !agentBinding.accountEnabled) {
      writeJson(response, 409, { error: 'QQ Bot 已停用' });
      return;
    }
  } else if (!binding.enabled) {
    writeJson(response, 409, { error: 'QQ Bot 已停用' });
    return;
  }

  let body;
  try {
    body = await readJsonRequest(request);
  } catch (error) {
    writeJson(response, error?.statusCode || 400, { error: shortError(error) });
    return;
  }

  if (agentBinding) {
    await handleAgentWebhookRequest(response, agentBinding, body);
    return;
  }

  const content = typeof body.content === 'string'
    ? body.content.trim().slice(0, 12_000)
    : typeof body.content?.text === 'string' ? body.content.text.trim().slice(0, 12_000) : '';
  if (!content) {
    writeJson(response, 400, { error: '通知内容不能为空' });
    return;
  }
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim().slice(0, 240) : '';
  cleanupWebhookEvents();
  const eventKey = idempotencyKey ? `${binding.userId}:${idempotencyKey}` : '';
  if (eventKey && recentWebhookEvents.has(eventKey)) {
    writeJson(response, 200, { sent: true, deduplicated: true });
    return;
  }

  const entry = clients.get(`personal:${binding.userId}`);
  if (!entry?.ready || !binding.qqOpenId) {
    writeJson(response, 409, { error: binding.qqOpenId ? 'QQ Bot 当前未连接' : '请先在 QQ 中私聊机器人完成接收方绑定' });
    return;
  }

  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim().slice(0, 160)
    : typeof body.content?.title === 'string' && body.content.title.trim()
      ? body.content.title.trim().slice(0, 160) : '空间任务通知';
  const status = typeof body.status === 'string' && body.status.trim()
    ? body.status.trim().slice(0, 40)
    : typeof body.run?.status === 'string' && body.run.status.trim()
      ? body.run.status.trim().slice(0, 40) : 'COMPLETED';
  const message = `【空间通知】${title}\n状态：${status}\n\n${content}`;
  try {
    const sent = await entry.bot.sendWakeup(
      { scope: 'c2c', targetId: binding.qqOpenId },
      message
    );
    const now = sqliteDate();
    updateBinding(binding.userId, { webhookLastUsedAt: now });
    if (eventKey) recentWebhookEvents.set(eventKey, Date.now() + 10 * 60_000);
    writeJson(response, 200, { sent: true, messageId: sent?.ext_info?.ref_idx || sent?.id || null });
  } catch (error) {
    updateBinding(binding.userId, { lastError: shortError(error) });
    writeJson(response, 502, { error: shortError(error) });
  }
}

function startWebhookServer() {
  if (!webhookPort) return;
  webhookServer = createServer((request, response) => {
    void handleWebhookRequest(request, response).catch((error) => {
      if (!response.headersSent) writeJson(response, 500, { error: shortError(error) });
      else response.end();
    });
  });
  webhookServer.on('error', (error) => console.error('[qq-assistant] Webhook server error:', error));
  webhookServer.listen(webhookPort, webhookHost, () => {
    console.info(`[qq-assistant] Webhook listening on http://${webhookHost}:${webhookPort}${QQ_WEBHOOK_PATH}/...`);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  scheduler.stop();
  webhookServer?.close();
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

scheduler.register('reconcile-bindings', reconcileBindings);
scheduler.register('deliver-reminders', deliverDueReminders);
scheduler.start();
startWebhookServer();
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
