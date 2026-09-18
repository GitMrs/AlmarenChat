import { decryptQQCredential } from '../../lib/qq-assistant/credentials.mjs';
import { buildQQWebhookUrl } from '../../lib/qq-assistant/webhook.mjs';
import { isUnsafeWebhookHostname } from '../../lib/space-automation-policy.mjs';
import { renderWebhookTemplate } from '../../lib/webhook-template.mjs';

function shortError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export { renderWebhookTemplate } from '../../lib/webhook-template.mjs';

export async function notifyWebhookCompletion(db, { runId, status, result }) {
  const context = db.prepare(
    `SELECT run."userId", run."spaceId", run."result", run."completedAt",
            automation."id" AS "automationId", automation."name" AS "automationName",
            automation."completionAction", automation."completionConfig",
            execution."scheduledFor"
     FROM "AgentRun" run
     JOIN "SpaceAutomationExecution" execution ON execution."runId" = run."id"
     JOIN "SpaceAutomation" automation ON automation."id" = execution."automationId"
     WHERE run."id" = ? LIMIT 1`
  ).get(runId);
  if (!context || context.completionAction !== 'WEBHOOK_NOTIFY') return { skipped: true };

  let config = {};
  try { config = context.completionConfig ? JSON.parse(String(context.completionConfig)) : {}; } catch { config = {}; }
  const target = String(config.target || 'PERSONAL_QQ').toUpperCase();
  const content = String(result || context.result || '').trim().slice(0, 12_000);
  if (!content) return { skipped: true, reason: '任务没有可发送的结果' };
  const idempotencyKey = `space-automation:${context.spaceId}:${runId}:webhook`;
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
    run: { runId, status, scheduledFor: context.scheduledFor || null },
    content: { title: context.automationName || '空间自动化', text: content, markdown: content },
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

  const baseUrl = process.env.QQ_ASSISTANT_WEBHOOK_INTERNAL_URL
    || `http://127.0.0.1:${process.env.QQ_ASSISTANT_WEBHOOK_PORT || 8787}`;

  const token = decryptQQCredential(binding.webhookTokenCiphertext);
  const response = await fetch(buildQQWebhookUrl(token, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
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
