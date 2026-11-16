// 空间通知借用提醒表投递，不属于小伴待办；个人提醒也可能使用平台 QQ 通道。
export const PERSONAL_REMINDER_FILTER = {
  OR: [
    { idempotencyKey: null },
    { NOT: { OR: [
      { idempotencyKey: { startsWith: 'crypto-follow-up:' } },
      { idempotencyKey: { startsWith: 'crypto-sentinel:' } },
      { idempotencyKey: { startsWith: 'space-automation:' } },
    ] } },
  ],
};
