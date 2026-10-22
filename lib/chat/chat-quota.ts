import prisma from '@/app/api/_lib/db';
import { isAdminEmail } from '@/app/api/_lib/admin';

const DEFAULT_DAILY_CHAT_LIMIT = 30;

function getQuotaDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function reserveChatQuota(options: {
  userId: string;
  email: string;
  dailyChatLimit: number | null;
  usesCustomModel: boolean;
  cost?: number;
}) {
  if (options.usesCustomModel || isAdminEmail(options.email)) return null;

  const limit = options.dailyChatLimit || DEFAULT_DAILY_CHAT_LIMIT;
  const cost = Math.max(1, options.cost || 1);
  const day = getQuotaDay();
  const usage = await prisma.dailyChatUsage.upsert({
    where: { userId_day: { userId: options.userId, day } },
    update: {},
    create: { userId: options.userId, day },
  });

  if (usage.usedCount + cost > limit) {
    return { allowed: false as const, limit, used: usage.usedCount, remaining: Math.max(0, limit - usage.usedCount), cost };
  }

  await prisma.dailyChatUsage.update({
    where: { userId_day: { userId: options.userId, day } },
    data: { usedCount: { increment: cost } },
  });
  return { allowed: true as const, limit, used: usage.usedCount + cost, remaining: Math.max(0, limit - usage.usedCount - cost), cost };
}
