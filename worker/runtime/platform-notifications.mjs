import { sendPlatformQQ } from '../../lib/platform-notifications/qq.mjs';
import { FOLLOW_UP_QQ_PREFIX, isMarketQQNotification } from '../../lib/space/follow-up-notification-policy.mjs';
import { sqliteDate } from '../../lib/qq-assistant/policy.mjs';

export function selectPlatformReminders(db, now = new Date()) {
  const timestamp = sqliteDate(now);
  // 旧 PERSONAL_QQ 队列也由平台通道处理；未配置的用户不占用发送名额。
  return db.prepare(`SELECT r.* FROM "AssistantReminder" r JOIN "PlatformNotification" p ON p."userId" = r."userId"
    WHERE p."enabled" = 1 AND r."status" = 'PENDING' AND r."dueTime" <= ?
      AND r."qqDeliveredAt" IS NULL AND r."qqDeliveryAttempts" < 3
      AND (r."qqNextAttemptAt" IS NULL OR r."qqNextAttemptAt" <= ?)
    ORDER BY r."dueTime" LIMIT 20`).all(timestamp, timestamp);
}

export async function deliverPlatformNotifications(db, sender = sendPlatformQQ, clock = () => new Date()) {
  const now = sqliteDate(clock());
  db.prepare(`UPDATE "AssistantReminder" SET "status" = CASE
      WHEN "idempotencyKey" LIKE 'crypto-follow-up:%' OR "idempotencyKey" LIKE 'crypto-sentinel:%' OR "idempotencyKey" LIKE 'space-automation:%' THEN 'FAILED'
      ELSE "status" END, "qqNextAttemptAt" = NULL,
    "qqDeliveryError" = '平台通知已达到3次投递上限', "updatedAt" = ?
    WHERE "status" = 'PENDING' AND "qqDeliveredAt" IS NULL AND "qqDeliveryAttempts" >= 3 AND ("qqDeliveryError" IS NULL OR "qqNextAttemptAt" IS NOT NULL)
      AND ("qqNextAttemptAt" IS NULL OR "qqNextAttemptAt" <= ?)` ).run(now, now);
  const reminders = selectPlatformReminders(db, clock());
  for (const reminder of reminders) {
    const attempts = reminder.qqDeliveryAttempts + 1;
    const claimed = db.prepare(`UPDATE "AssistantReminder" SET "qqNextAttemptAt" = ?, "updatedAt" = ?, "qqDeliveryAttempts" = "qqDeliveryAttempts" + 1
      WHERE "id" = ? AND "status" = 'PENDING' AND "qqDeliveredAt" IS NULL AND "qqDeliveryAttempts" = ?
        AND ("qqNextAttemptAt" IS NULL OR "qqNextAttemptAt" <= ?)`)
      .run(sqliteDate(new Date(clock().getTime() + 5 * 60_000)), now, reminder.id, reminder.qqDeliveryAttempts, now);
    if (!claimed.changes) continue;
    const config = db.prepare('SELECT * FROM "PlatformNotification" WHERE "userId" = ? AND "enabled" = 1').get(reminder.userId);
    const followUp = reminder.idempotencyKey?.startsWith(FOLLOW_UP_QQ_PREFIX);
    const valid = !followUp || (process.env.ENABLE_SPACE_FOLLOW_UPS !== 'false' && db.prepare(`
      SELECT f."id" FROM "SpaceFollowUp" f JOIN "Space" s ON s."id" = f."spaceId"
      JOIN "AssistantReminder" r ON r."id" = f."qqReminderId"
      WHERE r."id" = ? AND r."status" = 'PENDING' AND s."userId" = ? AND f."status" = 'COMPLETED'
        AND s."runtimeType" <> 'PI_CODING' AND s."cryptoAutonomyEnabled" = 1 AND s."cryptoFollowUpQQEnabled" = 1
        AND julianday(f."completedAt") >= julianday(?)
    `).get(reminder.id, reminder.userId, sqliteDate(new Date(clock().getTime() - 30 * 60_000))));
    if (!config || !valid) {
      db.prepare(`UPDATE "AssistantReminder" SET "status" = 'CANCELLED', "qqNextAttemptAt" = NULL,
        "qqDeliveryError" = '平台通知已停用或跟进已失效', "updatedAt" = ? WHERE "id" = ? AND "status" = 'PENDING' AND "qqDeliveryAttempts" = ?`).run(now, reminder.id, attempts);
      continue;
    }
    const message = isMarketQQNotification(reminder) || reminder.idempotencyKey?.startsWith('space-automation:')
      ? reminder.content : `【平台待办提醒】${reminder.content}\n\n请在个人助理的待办列表中处理此提醒。`;
    try {
      const result = await sender(config, message);
      db.prepare(`UPDATE "AssistantReminder" SET "qqDeliveredAt" = ?, "qqMessageId" = ?, "qqNextAttemptAt" = NULL,
        "qqDeliveryError" = NULL, "updatedAt" = ? WHERE "id" = ? AND "status" = 'PENDING' AND "qqDeliveredAt" IS NULL AND "qqDeliveryAttempts" = ?`)
        .run(sqliteDate(clock()), result.messageId, sqliteDate(clock()), reminder.id, attempts);
    } catch {
      db.prepare(`UPDATE "AssistantReminder" SET "status" = ?, "qqNextAttemptAt" = ?, "qqDeliveryError" = ?, "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'PENDING' AND "qqDeliveredAt" IS NULL AND "qqDeliveryAttempts" = ?`)
        .run(attempts >= 3 && (isMarketQQNotification(reminder) || reminder.idempotencyKey?.startsWith('space-automation:')) ? 'FAILED' : 'PENDING', attempts >= 3 ? null : sqliteDate(new Date(clock().getTime() + 60_000 * attempts)),
          attempts >= 3 ? '平台通知发送失败，已达到3次投递上限' : '平台通知发送失败，等待重试', sqliteDate(clock()), reminder.id, attempts);
    }
  }
}
