import { createHash } from 'node:crypto';
import { sqliteDate } from '../qq-assistant/policy.mjs';

const idFor = value => createHash('sha256').update(value).digest('hex');
const query = (db, sql, args = []) => db.prepare ? db.prepare(sql).all(...args) : db.$queryRawUnsafe(sql, ...args);
const run = (db, sql, args = []) => db.prepare ? db.prepare(sql).run(...args) : db.$executeRawUnsafe(sql, ...args);
const date = value => new Date(typeof value === 'bigint' ? Number(value) : value);
const titleFor = content => String(content || '').split('\n').map(line => line.replace(/^[#\s]+|[*]/g, '').trim()).find(Boolean)?.slice(0, 120) || '平台通知';

export async function recordNotification(db, input) {
  const id = idFor(`${input.userId}:${input.sourceKey}`);
  const now = sqliteDate(new Date());
  await run(db, `INSERT INTO "UserNotification" ("id","userId","sourceKey","kind","title","content","sourceHref","createdAt","updatedAt")
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT("userId","sourceKey") DO NOTHING`,
  [id, input.userId, input.sourceKey, input.kind, input.title || titleFor(input.content), input.content, input.sourceHref || null, sqliteDate(date(input.createdAt || new Date())), now]);
  if (input.delivery) {
    const delivery = input.delivery;
    await run(db, `INSERT INTO "UserNotificationDelivery" ("id","notificationId","channel","status","error","sentAt","updatedAt") VALUES (?,?,?,?,?,?,?)
      ON CONFLICT("notificationId","channel") DO UPDATE SET "status"=excluded."status", "error"=excluded."error", "sentAt"=excluded."sentAt", "updatedAt"=excluded."updatedAt"
      WHERE "UserNotificationDelivery"."status" <> 'SENT' OR excluded."status" = 'SENT'`,
    [idFor(`${id}:${delivery.channel}`), id, delivery.channel, delivery.status, delivery.error || null, delivery.sentAt ? sqliteDate(date(delivery.sentAt)) : null, now]);
  }
  return id;
}

/** @param {any} db @param {{ userId?: string, now?: Date }} options */
export async function syncNotifications(db, { userId, now = new Date() } = {}) {
  const reminders = await query(db, `SELECT r.*, f."id" AS "followUpTaskId", f."spaceId" AS "followUpSpaceId", f."title" AS "followUpTitle", p."enabled" AS "channelEnabled"
    FROM "AssistantReminder" r LEFT JOIN "SpaceFollowUp" f ON f."qqReminderId"=r."id"
    LEFT JOIN "PlatformNotification" p ON p."userId"=r."userId"
    WHERE r."dueTime" IS NOT NULL AND julianday(r."dueTime") <= julianday(?) ${userId ? 'AND r."userId" = ?' : ''}
      AND (r."status" NOT IN ('COMPLETED','DISMISSED','CANCELLED') OR r."qqDeliveredAt" IS NOT NULL OR r."idempotencyKey" LIKE 'crypto-%')`,
  [sqliteDate(now), ...(userId ? [userId] : [])]);
  for (const r of reminders) {
    const key = r.idempotencyKey || '';
    const kind = key.startsWith('crypto-follow-up:') ? 'FOLLOW_UP' : key.startsWith('crypto-sentinel:') ? 'MARKET' : 'REMINDER';
    const sourceSpace = r.followUpSpaceId || (kind === 'MARKET' ? key.split(':')[1] : null);
    const status = r.qqDeliveredAt ? 'SENT' : r.status === 'CANCELLED' ? 'CANCELLED' : r.status === 'FAILED' || r.qqDeliveryAttempts >= 3 ? 'FAILED'
      : !r.channelEnabled ? 'NOT_CONFIGURED' : r.qqDeliveryError ? 'RETRYING' : 'PENDING';
    await recordNotification(db, { userId: r.userId, sourceKey: r.followUpTaskId ? `follow-up:${r.followUpTaskId}` : `reminder:${r.id}:${date(r.dueTime).toISOString()}`, kind,
      title: r.followUpTitle || (kind === 'REMINDER' ? String(r.content).slice(0, 120) : titleFor(r.content)), content: r.content,
      sourceHref: sourceSpace ? `/spaces/${encodeURIComponent(sourceSpace)}` : '/me?tab=assistant', createdAt: r.dueTime,
      delivery: { channel: 'QQ', status, error: r.qqDeliveryError, sentAt: r.qqDeliveredAt } });
  }
  const reports = await query(db, `SELECT f."id",f."title",f."spaceId",f."completedAt",s."userId",r."content"
    FROM "SpaceFollowUp" f JOIN "Space" s ON s."id"=f."spaceId"
    JOIN "SpaceFollowUpReport" r ON r."taskId"=f."id" WHERE f."status"='COMPLETED'
    ${userId ? 'AND s."userId" = ?' : ''}`, userId ? [userId] : []);
  for (const report of reports) await recordNotification(db, { userId: report.userId, sourceKey: `follow-up:${report.id}`, kind: 'FOLLOW_UP',
    title: report.title, content: report.content, sourceHref: `/spaces/${encodeURIComponent(report.spaceId)}`, createdAt: report.completedAt });
  const executions = await query(db, `SELECT e.*, s."userId", a."spaceId", a."name" AS "automationName", a."completionConfig"
    FROM "SpaceAutomationExecution" e JOIN "SpaceAutomation" a ON a."id"=e."automationId"
    JOIN "Space" s ON s."id"=a."spaceId" WHERE e."status"='COMPLETED' AND a."completionAction"='WEBHOOK_NOTIFY'
    ${userId ? 'AND s."userId" = ?' : ''}`, userId ? [userId] : []);
  for (const e of executions) {
    let config = {}; try { config = JSON.parse(e.completionConfig || '{}'); } catch {}
    const channel = config.target === 'CUSTOM_WEBHOOK' ? 'WEBHOOK' : 'QQ';
    const status = e.deliveryStatus === 'DELIVERED' ? 'SENT' : e.deliveryStatus === 'FAILED' ? 'FAILED' : e.deliveryError ? 'RETRYING' : 'PENDING';
    await recordNotification(db, { userId: e.userId, sourceKey: `automation:${e.id}`, kind: 'AUTOMATION', title: e.automationName || '自动化任务完成',
      content: e.result || '自动化任务已完成，点击查看来源。', sourceHref: `/spaces/${encodeURIComponent(e.spaceId)}`,
      createdAt: e.completedAt || e.updatedAt, delivery: { channel, status, error: e.deliveryError, sentAt: e.deliveredAt } });
  }
}

export async function sendRecordedNotification(db, config, input, sender) {
  const id = await recordNotification(db, { ...input, delivery: { channel: 'QQ', status: config?.enabled ? 'PENDING' : 'NOT_CONFIGURED' } });
  const existing = await query(db, 'SELECT "status" FROM "UserNotificationDelivery" WHERE "notificationId"=? AND "channel"=?', [id, 'QQ']);
  if (existing[0]?.status === 'SENT') return { messageId: null, deduplicated: true };
  if (!config?.enabled) throw new Error('请在账号设置中配置并启用平台通知');
  try {
    const result = await sender(config, input.content);
    await recordNotification(db, { ...input, delivery: { channel: 'QQ', status: 'SENT', sentAt: new Date() } });
    return result;
  } catch {
    await recordNotification(db, { ...input, delivery: { channel: 'QQ', status: 'FAILED', error: '通知渠道发送失败，请检查通道配置与投递记录' } });
    throw new Error('平台通知发送失败，请稍后重试');
  }
}
