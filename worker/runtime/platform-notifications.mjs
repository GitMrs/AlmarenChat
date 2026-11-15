import { sendPlatformQQ } from '../../lib/platform-notifications/qq.mjs';
import { claimDueQQReminder } from './follow-up-qq-notifications.mjs';
import { sqliteDate } from '../../lib/qq-assistant/policy.mjs';

export async function deliverPlatformNotifications(db, sender = sendPlatformQQ) {
  const now = sqliteDate();
  const reminders = db.prepare(`SELECT * FROM "AssistantReminder"
    WHERE "notificationChannel" = 'PLATFORM_QQ' AND "status" = 'PENDING'
      AND "dueTime" <= ? AND "qqDeliveredAt" IS NULL AND "qqDeliveryAttempts" < 3
      AND ("qqNextAttemptAt" IS NULL OR "qqNextAttemptAt" <= ?)
    ORDER BY "dueTime" LIMIT 20`).all(now, now);
  for (const reminder of reminders) {
    if (!claimDueQQReminder(db, reminder)) continue;
    const config = db.prepare('SELECT * FROM "PlatformNotification" WHERE "userId" = ? AND "enabled" = 1').get(reminder.userId);
    const valid = process.env.ENABLE_SPACE_FOLLOW_UPS !== 'false' && db.prepare(`
      SELECT f."id" FROM "SpaceFollowUp" f JOIN "Space" s ON s."id" = f."spaceId"
      JOIN "AssistantReminder" r ON r."id" = f."qqReminderId"
      WHERE r."id" = ? AND r."status" = 'PENDING' AND s."userId" = ? AND f."status" = 'COMPLETED'
        AND s."runtimeType" <> 'PI_CODING' AND s."cryptoAutonomyEnabled" = 1 AND s."cryptoFollowUpQQEnabled" = 1
        AND julianday(f."completedAt") >= julianday('now', '-30 minutes')
    `).get(reminder.id, reminder.userId);
    if (!config || !valid) {
      db.prepare(`UPDATE "AssistantReminder" SET "status" = 'CANCELLED', "qqNextAttemptAt" = NULL,
        "qqDeliveryError" = '平台通知已停用或跟进已失效', "updatedAt" = ? WHERE "id" = ? AND "status" = 'PENDING'`).run(now, reminder.id);
      continue;
    }
    try {
      const result = await sender(config, reminder.content);
      db.prepare(`UPDATE "AssistantReminder" SET "qqDeliveredAt" = ?, "qqMessageId" = ?, "qqNextAttemptAt" = NULL,
        "qqDeliveryError" = NULL, "updatedAt" = ? WHERE "id" = ? AND "status" = 'PENDING' AND "qqDeliveredAt" IS NULL AND "qqDeliveryAttempts" = ?`)
        .run(sqliteDate(), result.messageId, sqliteDate(), reminder.id, reminder.qqDeliveryAttempts + 1);
    } catch {
      const attempts = reminder.qqDeliveryAttempts + 1;
      db.prepare(`UPDATE "AssistantReminder" SET "status" = ?, "qqNextAttemptAt" = ?, "qqDeliveryError" = ?, "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'PENDING' AND "qqDeliveredAt" IS NULL AND "qqDeliveryAttempts" = ?`)
        .run(attempts >= 3 ? 'FAILED' : 'PENDING', attempts >= 3 ? null : sqliteDate(new Date(Date.now() + 60_000 * attempts)),
          attempts >= 3 ? '平台通知发送失败，已达到3次投递上限' : '平台通知发送失败，等待重试', sqliteDate(), reminder.id, reminder.qqDeliveryAttempts + 1);
    }
  }
}
