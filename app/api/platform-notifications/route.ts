import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { normalizePlatformConfig, encryptPlatformToken, sendPlatformQQ } from '@/lib/platform-notifications/qq.mjs';

export const runtime = 'nodejs';
const serialize = (config: any) => config ? { baseUrl: config.baseUrl, targetType: config.targetType, targetId: config.targetId, enabled: config.enabled, tokenConfigured: true } : null;
const failure = (error: any) => NextResponse.json({ error: error.message === 'Unauthorized' ? 'Unauthorized' : error.message }, { status: error.message === 'Unauthorized' ? 401 : 400 });
const cancelPending = (tx: any, userId: string) => tx.assistantReminder.updateMany({ where: { userId, status: 'PENDING', qqDeliveredAt: null, OR: [{ idempotencyKey: { startsWith: 'crypto-follow-up:' } }, { idempotencyKey: { startsWith: 'crypto-sentinel:' } }, { idempotencyKey: { startsWith: 'space-automation:' } }] }, data: { status: 'CANCELLED', qqNextAttemptAt: null, qqDeliveryError: '平台通知配置已变更，请重新安排通知' } });

export async function GET(request: Request) {
  try { return NextResponse.json({ config: serialize(await prisma.platformNotification.findUnique({ where: { userId: requireAuth(request) } })) }); }
  catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    const data = normalizePlatformConfig(body);
    const previous = await prisma.platformNotification.findUnique({ where: { userId } });
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token && !previous) throw new Error('请输入 X-Auth-Key');
    const tokenCiphertext = token ? encryptPlatformToken(token) : previous!.tokenCiphertext;
    const config = await prisma.$transaction(async tx => {
      await cancelPending(tx, userId);
      return tx.platformNotification.upsert({ where: { userId }, create: { userId, ...data, tokenCiphertext }, update: { ...data, tokenCiphertext } });
    });
    return NextResponse.json({ config: serialize(config) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const config = await prisma.platformNotification.findUnique({ where: { userId: requireAuth(request) } });
    if (!config?.enabled) throw new Error('请先保存并启用平台通知');
    await sendPlatformQQ(config, '【Almaren 平台通知】测试消息：通知通道连接成功。');
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const userId = requireAuth(request);
    await prisma.$transaction(async tx => { await cancelPending(tx, userId); await tx.platformNotification.deleteMany({ where: { userId } }); });
    return NextResponse.json({ success: true });
  } catch (error) { return failure(error); }
}
