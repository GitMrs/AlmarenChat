import { FOLLOW_UP_QQ_MAX_AGE_MS, FOLLOW_UP_QQ_PREFIX, MARKET_QQ_MAX_DELIVERY_ATTEMPTS, isMarketQQNotification } from '../../lib/space/follow-up-notification-policy.mjs';
import { sqliteDate } from '../../lib/qq-assistant/policy.mjs';

// 离线用户不占用本轮的20条发送名额；冷却中的客户端也留待下一轮。
export function selectDueQQReminders(db, userIds, now = new Date()) {
  const recipients = [...new Set(userIds)];
  if (!recipients.length) return [];
  const placeholders = recipients.map(() => '?').join(',');
  const timestamp = sqliteDate(new Date(now));
  return db.prepare(`
    SELECT r.*, b."qqOpenId", b."appId" AS "qqAppId"
    FROM "AssistantReminder" r JOIN "AssistantQQBinding" b ON b."userId" = r."userId"
    WHERE r."userId" IN (${placeholders}) AND r."status" = 'PENDING'
      AND r."dueTime" IS NOT NULL AND r."dueTime" <= ? AND r."qqDeliveredAt" IS NULL
      AND (r."qqNextAttemptAt" IS NULL OR r."qqNextAttemptAt" <= ?)
      AND ((COALESCE(r."idempotencyKey", '') NOT LIKE 'crypto-follow-up:%'
        AND COALESCE(r."idempotencyKey", '') NOT LIKE 'crypto-sentinel:%') OR r."qqDeliveryAttempts" < ?)
      AND b."enabled" = 1 AND b."qqOpenId" IS NOT NULL
    ORDER BY r."dueTime" ASC LIMIT 20
  `).all(...recipients, timestamp, timestamp, MARKET_QQ_MAX_DELIVERY_ATTEMPTS);
}

// 投递前持久化计次，进程中断也不能把已尝试次数清零。
export function claimDueQQReminder(db, reminder, now = new Date()) {
  const timestamp = sqliteDate(new Date(now));
  const leaseUntil = sqliteDate(new Date(new Date(now).getTime() + 5 * 60_000));
  const marketNotice = isMarketQQNotification(reminder);
  const claimed = db.prepare(`
    UPDATE "AssistantReminder" SET "qqNextAttemptAt" = ?, "updatedAt" = ?,
      "qqDeliveryAttempts" = "qqDeliveryAttempts" + ?
    WHERE "id" = ? AND "status" = 'PENDING' AND "dueTime" <= ? AND "qqDeliveredAt" IS NULL
      AND ("qqNextAttemptAt" IS NULL OR "qqNextAttemptAt" <= ?)
      AND (? = 0 OR ("qqDeliveryAttempts" < ? AND "qqDeliveryAttempts" = ?))
  `).run(leaseUntil, timestamp, marketNotice ? 1 : 0, reminder.id, timestamp, timestamp, marketNotice ? 1 : 0, MARKET_QQ_MAX_DELIVERY_ATTEMPTS, reminder.qqDeliveryAttempts || 0);
  return claimed.changes === 1;
}

// 第三次投递后进程若意外退出，租约到期后直接结束，不再次发送。
export function stopExhaustedMarketQQNotifications(db, now = new Date()) {
  const timestamp = sqliteDate(new Date(now));
  return db.prepare(`
    UPDATE "AssistantReminder" SET "status" = 'FAILED', "qqNextAttemptAt" = NULL,
      "qqDeliveryError" = '行情通知已达到最多3次投递上限，停止发送', "updatedAt" = ?
    WHERE "status" = 'PENDING' AND "qqDeliveredAt" IS NULL AND "qqDeliveryAttempts" >= ?
      AND ("idempotencyKey" LIKE 'crypto-follow-up:%' OR "idempotencyKey" LIKE 'crypto-sentinel:%')
      AND ("qqNextAttemptAt" IS NULL OR "qqNextAttemptAt" <= ?)
  `).run(timestamp, MARKET_QQ_MAX_DELIVERY_ATTEMPTS, timestamp).changes;
}

// 即使QQ暂时离线也清理失效短报，避免重连后堆积陈旧通知。
export function cancelUnavailableFollowUpQQNotifications(db, now = new Date()) {
  const timestamp = sqliteDate(new Date(now));
  const earliest = sqliteDate(new Date(new Date(now).getTime() - FOLLOW_UP_QQ_MAX_AGE_MS));
  return db.prepare(`
    UPDATE "AssistantReminder" AS r SET "status" = 'CANCELLED', "qqNextAttemptAt" = NULL,
      "qqDeliveryError" = '空间复查通知已关闭、取消或超过30分钟有效期', "updatedAt" = ?
    WHERE r."status" = 'PENDING' AND r."qqDeliveredAt" IS NULL AND r."idempotencyKey" LIKE ?
      AND NOT EXISTS (
        SELECT 1 FROM "SpaceFollowUp" f JOIN "Space" s ON s."id" = f."spaceId"
        WHERE f."qqReminderId" = r."id" AND s."userId" = r."userId" AND f."status" = 'COMPLETED'
          AND s."runtimeType" <> 'PI_CODING'
          AND s."cryptoAutonomyEnabled" = 1 AND s."cryptoFollowUpQQEnabled" = 1
          AND julianday(f."completedAt") >= julianday(?) AND ? = 1
      )
  `).run(timestamp, `${FOLLOW_UP_QQ_PREFIX}%`, earliest, process.env.ENABLE_SPACE_FOLLOW_UPS === 'false' ? 0 : 1).changes;
}

// 发送前重新检查，防止队列中的旧通知在开关关闭或空间删除后继续投递。
export function canDeliverFollowUpQQNotification(db, reminder, now = new Date()) {
  if (!reminder.idempotencyKey?.startsWith(FOLLOW_UP_QQ_PREFIX)) return true;
  if (process.env.ENABLE_SPACE_FOLLOW_UPS === 'false') return false;
  const row = db.prepare(`
    SELECT f."status", f."completedAt", s."cryptoAutonomyEnabled", s."cryptoFollowUpQQEnabled", s."templateId", s."runtimeType"
    FROM "SpaceFollowUp" f JOIN "Space" s ON s."id" = f."spaceId"
    JOIN "AssistantReminder" r ON r."id" = f."qqReminderId"
    JOIN "AssistantQQBinding" b ON b."userId" = r."userId"
    WHERE f."qqReminderId" = ? AND s."userId" = ? AND r."userId" = s."userId"
      AND r."status" = 'PENDING' AND r."qqDeliveredAt" IS NULL
      AND b."enabled" = 1 AND b."qqOpenId" = ? AND b."appId" = ?
  `).get(reminder.id, reminder.userId, reminder.qqOpenId || null, reminder.qqAppId || null);
  return !!row && row.status === 'COMPLETED'
    && row.runtimeType !== 'PI_CODING' && !!row.cryptoAutonomyEnabled && !!row.cryptoFollowUpQQEnabled
    && new Date(row.completedAt).getTime() >= new Date(now).getTime() - FOLLOW_UP_QQ_MAX_AGE_MS;
}

export function formatQQReminderMessage(reminder) {
  if (reminder.idempotencyKey?.startsWith(FOLLOW_UP_QQ_PREFIX)) return reminder.content;
  return `提醒你：${reminder.content}\n\n引用本条提醒并回复“完成了”、“延后10分钟”或“取消提醒”可以直接处理。`;
}
