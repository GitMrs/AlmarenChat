import { createHash } from 'node:crypto';
import prisma from '@/app/api/_lib/db';
import { FOLLOW_UP_QQ_CATEGORIES, FOLLOW_UP_QQ_COOLDOWN_MS, FOLLOW_UP_QQ_MAX_AGE_MS, FOLLOW_UP_QQ_PREFIX, followUpSpaceLink, normalizeFollowUpNotification } from './follow-up-notification-policy.mjs';

export async function getFollowUpQQAvailability(userId: string, db: any = prisma) {
  const binding = await db.assistantQQBinding.findUnique({ where: { userId }, select: { enabled: true, qqOpenId: true, status: true } });
  if (!binding?.enabled) return { ready: false, reason: '现有个人 QQ 通知通道未启用' };
  if (!binding.qqOpenId) return { ready: false, reason: '请先私聊现有 QQ 机器人，完成接收人绑定' };
  return { ready: true, reason: binding.status === 'READY' ? '复用现有 QQ 通知通道' : 'QQ 通道当前未连接，通知将排队等待重连' };
}

export const followUpNotificationTool = {
  type: 'function', function: {
    name: 'request_sentinel_qq_notification',
    description: '自主复查发现重要变化时，交给鹰眼通过用户已开启的现有 QQ 通道通知。仅提出通知，随本轮复查一起保存；普通复查不要调用。',
    parameters: { type: 'object', additionalProperties: false, required: ['category', 'eventKey', 'title', 'summary', 'reason'], properties: {
      category: { type: 'string', enum: FOLLOW_UP_QQ_CATEGORIES },
      eventKey: { type: 'string', maxLength: 160, description: '稳定事件标识，如 BTC:1H:BELOW:67064；同一事件多次复查使用同一标识，不包含当前时间或措辞变化。' },
      title: { type: 'string', maxLength: 100 },
      summary: { type: 'string', maxLength: 1000, description: '简明说明标的、发生的变化、核验依据及行情数据时间。仅用本次取得的数据，不把建议写成已执行操作。' },
      reason: { type: 'string', maxLength: 300, description: '为什么这个变化现在值得打扰用户，而不是只留在空间里。' },
    } },
  },
};

export function followUpNotificationToolForDomain(isCrypto: boolean) {
  if (isCrypto) return followUpNotificationTool;
  return { ...followUpNotificationTool, function: { ...followUpNotificationTool.function,
    name: 'request_follow_up_qq_notification', description: '本次跟进发现重要变化、目标完成或需要用户决定时，提出一条QQ通知；普通进度不通知。系统保存报告后才入队。',
    parameters: { ...followUpNotificationTool.function.parameters, properties: {
      ...followUpNotificationTool.function.parameters.properties,
      eventKey: { type: 'string', maxLength: 160, description: '稳定事件标识，同一成果或目标的同一变化使用同一标识，不包含本轮时间或措辞变化。' },
      summary: { type: 'string', maxLength: 1000, description: '简明说明目标、重要变化、实际核验依据和资料时间，不把提议写成已执行操作。' },
    } },
  } };
}

// 在保存分析结果的同一事务中排队；实际投递由现有 QQ Worker 完成。
export async function queueFollowUpQQNotification(tx: any, task: any, input: any, analystName: string, now: Date) {
  const space = await tx.space.findUnique({ where: { id: task.spaceId } });
  const isCrypto = task.domain ? task.domain === 'CRYPTO' : space?.templateId === 'crypto-contract-trading';
  const label = isCrypto ? '鹰眼通知' : '跟进通知';
  if (!space?.followUpEnabled || !space.followUpQQEnabled || space.runtimeType === 'PI_CODING') {
    return { note: `${label}：当前空间 QQ 通知已关闭，本次结果仅保留在空间。` };
  }
  const notice = normalizeFollowUpNotification(input);
  const availability = await getFollowUpQQAvailability(space.userId, tx);
  if (!availability.ready) return { note: `${label}未排队：${availability.reason}。` };
  const fingerprint = createHash('sha256').update(`${notice.category}:${notice.eventKey}`).digest('hex').slice(0, 24);
  const prefix = `${FOLLOW_UP_QQ_PREFIX}${task.spaceId}:`;
  const eventPrefix = `${prefix}${fingerprint}:`;
  const duplicate = await tx.assistantReminder.findFirst({ where: {
    userId: space.userId, status: { not: 'CANCELLED' },
    idempotencyKey: { startsWith: eventPrefix }, createdAt: { gte: new Date(now.getTime() - FOLLOW_UP_QQ_MAX_AGE_MS) },
  } });
  if (duplicate) return { note: `${label}：同一事件近期已通知或已排队，本次不重复发送。` };
  const recent = await tx.assistantReminder.findFirst({ where: {
    userId: space.userId, status: { not: 'CANCELLED' },
    idempotencyKey: { startsWith: prefix }, createdAt: { gte: new Date(now.getTime() - FOLLOW_UP_QQ_COOLDOWN_MS) },
  } });
  if (recent) return { note: `${label}：当前空间处于5分钟通知冷却期，本次结果请在空间查看。` };
  const checkedAt = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const link = followUpSpaceLink(space.id);
  const content = [
    isCrypto ? '🦅【鹰眼·自主复查重要速报】' : '【自主跟进·重要变化速报】', notice.title,
    `空间：${space.name}`, `分析成员：${analystName || task.agentId}`,
    `${isCrypto ? '复查' : '核验'}时间：${checkedAt}（北京时间）`, '', notice.summary,
    `提醒原因：${notice.reason}`, '', link ? `查看完整报告：${link}` : '请回到对应空间查看完整报告。',
  ].join('\n');
  const reminder = await tx.assistantReminder.upsert({
    where: { userId_idempotencyKey: { userId: space.userId, idempotencyKey: `${eventPrefix}${task.id}` } },
    update: {}, create: { userId: space.userId, content, dueTime: now, createdAt: now, idempotencyKey: `${eventPrefix}${task.id}` },
  });
  await tx.spaceFollowUp.update({ where: { id: task.id }, data: { qqReminderId: reminder.id } });
  return { note: `${isCrypto ? '鹰眼通知' : '跟进通知'}：已加入现有 QQ 通知队列，投递状态可在跟进记录查看。`, reminderId: reminder.id };
}
