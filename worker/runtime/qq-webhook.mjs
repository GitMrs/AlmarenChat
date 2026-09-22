import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { decryptQQCredential } from '../../lib/qq-assistant/credentials.mjs';
import { buildQQWebhookUrl } from '../../lib/qq-assistant/webhook.mjs';
import { isUnsafeWebhookHostname } from '../../lib/space-automation-policy.mjs';
import { renderWebhookTemplate } from '../../lib/webhook-template.mjs';

function shortError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

const QQ_CONTENT_LIMIT = 1_800;

function readTextArtifact(artifact, context, projectRoot, limit = 12_000) {
  if (!artifact) return null;
  try {
    const spaceRoot = realpathSync(path.resolve(projectRoot, 'data', 'spaces', context.userId, context.spaceId));
    const target = realpathSync(path.resolve(spaceRoot, String(artifact.relativePath || '')));
    if (!target.startsWith(`${spaceRoot}${path.sep}`)) return null;
    const text = readFileSync(target, 'utf8').trim().slice(0, limit);
    return text ? { ...artifact, text } : null;
  } catch {
    return null;
  }
}

export { renderWebhookTemplate } from '../../lib/webhook-template.mjs';

function primaryTextArtifact(db, context, projectRoot) {
  if (!context.workId && !context.runId) return null;
  const file = db.prepare(
    `SELECT "id", "fileName", "mimeType", "relativePath", "size", "shareId", "shareEnabled"
     FROM "SpaceFile"
     WHERE "spaceId" = ? AND "status" = 'READY'
       AND ((? IS NOT NULL AND "runId" = ?) OR (? IS NOT NULL AND "workId" = ?))
       AND (LOWER("fileName") LIKE '%.md' OR LOWER("fileName") LIKE '%.txt')
       AND LOWER("fileName") NOT IN ('notification.txt', 'notification.md')
     ORDER BY CASE WHEN "runId" = ? THEN 0 ELSE 1 END, COALESCE("size", 0) DESC, "createdAt" DESC
     LIMIT 1`
  ).get(context.spaceId, context.runId, context.runId, context.workId, context.workId, context.runId);
  return readTextArtifact(file, context, projectRoot);
}

function notificationTextArtifact(db, context, projectRoot) {
  if (!context.workId && !context.runId) return null;
  const file = db.prepare(
    `SELECT "id", "fileName", "mimeType", "relativePath", "size", "shareId", "shareEnabled"
     FROM "SpaceFile"
     WHERE "spaceId" = ? AND "status" = 'READY'
       AND ((? IS NOT NULL AND "runId" = ?) OR (? IS NOT NULL AND "workId" = ?))
       AND LOWER("fileName") IN ('notification.txt', 'notification.md')
     ORDER BY CASE WHEN "runId" = ? THEN 0 ELSE 1 END, "createdAt" DESC
     LIMIT 1`
  ).get(context.spaceId, context.runId, context.runId, context.workId, context.workId, context.runId);
  return readTextArtifact(file, context, projectRoot, QQ_CONTENT_LIMIT);
}

function publicAppOrigin() {
  const configured = process.env.APP_URL || process.env.QQ_ASSISTANT_WEBHOOK_PUBLIC_URL;
  if (!configured) return null;
  try { return new URL(configured).origin; } catch { return null; }
}

function ensureArtifactShare(db, artifact, timestamp = new Date().toISOString()) {
  if (!artifact?.id || !/\.(?:md|markdown)$/i.test(artifact.fileName || '')) return null;
  const origin = publicAppOrigin();
  if (!origin) return null;
  const shareId = artifact.shareId || randomUUID().replaceAll('-', '');
  if (!artifact.shareEnabled || !artifact.shareId) {
    db.prepare(
      `UPDATE "SpaceFile" SET "shareId" = ?, "shareEnabled" = 1, "sharedAt" = COALESCE("sharedAt", ?), "updatedAt" = ? WHERE "id" = ?`
    ).run(shareId, timestamp, timestamp, artifact.id);
  }
  return `${origin}/share/${shareId}/`;
}

export function qqNotificationText(content, shareUrl = null) {
  const plain = String(content || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const footer = shareUrl ? `\n\n完整简报：${shareUrl}` : '';
  if (plain.length + footer.length <= QQ_CONTENT_LIMIT) return `${plain}${footer}`;
  const budget = Math.max(0, QQ_CONTENT_LIMIT - footer.length - 2);
  const sliced = plain.slice(0, budget);
  const lineBreak = sliced.lastIndexOf('\n');
  const preview = (lineBreak >= Math.floor(budget * 0.6) ? sliced.slice(0, lineBreak) : sliced).trimEnd();
  return `${preview}\n…${footer}`;
}

export async function notifyWebhookCompletion(db, { executionId = null, runId = null, status, result, projectRoot = process.cwd() }) {
  if (status !== 'COMPLETED') return { skipped: true, reason: '任务未成功完成，不发送完成通知' };
  const context = db.prepare(
    `SELECT space."userId", automation."spaceId", run."result", run."completedAt",
            automation."id" AS "automationId", automation."name" AS "automationName",
            automation."completionAction", automation."completionConfig",
            execution."id" AS "executionId", execution."runId", execution."workId", execution."scheduledFor",
            execution."result" AS "executionResult"
     FROM "SpaceAutomationExecution" execution
     JOIN "SpaceAutomation" automation ON automation."id" = execution."automationId"
     JOIN "Space" space ON space."id" = automation."spaceId"
     LEFT JOIN "AgentRun" run ON run."id" = execution."runId"
     WHERE ${executionId ? 'execution."id"' : 'execution."runId"'} = ? LIMIT 1`
  ).get(executionId || runId);
  if (!context || context.completionAction !== 'WEBHOOK_NOTIFY') return { skipped: true };

  let config = {};
  try { config = context.completionConfig ? JSON.parse(String(context.completionConfig)) : {}; } catch { config = {}; }
  const target = String(config.target || 'PERSONAL_QQ').toUpperCase();
  const summary = String(result || context.executionResult || context.result || '').trim().slice(0, 12_000);
  const artifact = primaryTextArtifact(db, context, projectRoot);
  const content = artifact?.text || summary;
  if (!content) return { skipped: true, reason: '任务没有可发送的结果' };
  const idempotencyKey = `space-automation:${context.spaceId}:${context.executionId}:webhook`;
  const payload = {
    version: '1',
    event: 'space.automation.completed',
    idempotencyKey,
    occurredAt: context.completedAt || new Date().toISOString(),
    source: {
      spaceId: context.spaceId,
      automationId: context.automationId,
      automationName: context.automationName || '空间自动化',
    },
    run: { runId: context.runId || runId || null, status, scheduledFor: context.scheduledFor || null },
    content: {
      title: context.automationName || '空间自动化',
      text: content,
      markdown: content,
      summary,
      artifact: artifact ? { fileName: artifact.fileName, relativePath: artifact.relativePath } : null,
    },
  };

  if (target === 'CUSTOM_WEBHOOK') {
    const configured = db.prepare(
      `SELECT "url", "bodyTemplate", "enabled" FROM "SpaceWebhook" WHERE "id" = ? AND "spaceId" = ? LIMIT 1`
    ).get(String(config.webhookId || ''), context.spaceId);
    if (!configured?.enabled) return { skipped: true, reason: '空间通知 Webhook 未配置或已停用' };
    let url;
    try { url = new URL(String(configured.url || '')); } catch { return { skipped: true, reason: '自定义 Webhook 地址无效' }; }
    if (url.protocol !== 'https:' || url.username || url.password || isUnsafeWebhookHostname(url.hostname)) {
      return { skipped: true, reason: '自定义 Webhook 只支持不含账号密码、且不指向本机或内网的 HTTPS 地址' };
    }
    let bodyTemplate = configured.bodyTemplate;
    if (typeof bodyTemplate === 'string') {
      try { bodyTemplate = JSON.parse(bodyTemplate); } catch { bodyTemplate = null; }
    }
    bodyTemplate = bodyTemplate && typeof bodyTemplate === 'object' ? bodyTemplate : payload;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'AlmarenChat-SpaceWebhook/1',
        'x-almaren-event': payload.event,
        'x-almaren-delivery': idempotencyKey,
      },
      body: JSON.stringify(renderWebhookTemplate(bodyTemplate, payload)),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`自定义 Webhook 返回 HTTP ${response.status}`);
    db.prepare('UPDATE "SpaceWebhook" SET "lastUsedAt" = ?, "lastError" = NULL WHERE "id" = ?').run(new Date().toISOString(), String(config.webhookId));
    return { sent: true, target };
  }

  if (target !== 'PERSONAL_QQ') return { skipped: true, reason: 'Webhook 通知目标无效' };

  const binding = db.prepare(
    `SELECT "webhookTokenCiphertext", "enabled", "qqOpenId"
     FROM "AssistantQQBinding" WHERE "userId" = ? LIMIT 1`
  ).get(context.userId);
  if (!binding?.enabled || !binding.qqOpenId || !binding.webhookTokenCiphertext) {
    return { skipped: true, reason: 'QQ Webhook 未配置或 QQ 接收方未绑定' };
  }

  const notification = notificationTextArtifact(db, context, projectRoot);
  const shareUrl = ensureArtifactShare(db, artifact);
  const qqContent = qqNotificationText(notification?.text || content, shareUrl);

  const baseUrl = process.env.QQ_ASSISTANT_WEBHOOK_INTERNAL_URL
    || `http://127.0.0.1:${process.env.QQ_ASSISTANT_WEBHOOK_PORT || 8787}`;

  const token = decryptQQCredential(binding.webhookTokenCiphertext);
  const response = await fetch(buildQQWebhookUrl(token, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      content: { ...payload.content, text: qqContent, markdown: qqContent, shareUrl },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `QQ Webhook 返回 HTTP ${response.status}`);
  }
  return { sent: true, target };
}

export const notifyQQCompletion = notifyWebhookCompletion;

export { shortError as qqWebhookError };
