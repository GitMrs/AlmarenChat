import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { syncNotifications } from '@/lib/notifications/store.mjs';
export const runtime = 'nodejs';
const failure = (error: any) => NextResponse.json({ error: error.message === 'Unauthorized' ? 'Unauthorized' : '通知操作失败，请重试' }, { status: error.message === 'Unauthorized' ? 401 : 500 });
export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    await syncNotifications(prisma, { userId });
    const search = new URL(request.url).searchParams;
    const page = Number(search.get('page') || 1);
    const filter = search.get('filter') || 'ALL';
    if (!Number.isSafeInteger(page) || page < 1 || !['ALL','UNREAD'].includes(filter)) return NextResponse.json({ error: '无效的筛选或页码' }, { status: 400 });
    const where = { userId, ...(filter === 'UNREAD' ? { readAt: null } : {}) };
    const [total, unread] = await Promise.all([prisma.userNotification.count({ where }), prisma.userNotification.count({ where: { userId, readAt: null } })]);
    const currentPage = Math.min(page, Math.max(1, Math.ceil(total / 20)));
    const notifications = await prisma.userNotification.findMany({ where, include: { deliveries: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, skip: (currentPage - 1) * 20 });
    return NextResponse.json({ notifications, total, unread, page: currentPage, pageSize: 20 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    if (body.action !== 'read-all' && (body.action !== 'read' || typeof body.id !== 'string')) return NextResponse.json({ error: '无效操作' }, { status: 400 });
    const result = await prisma.userNotification.updateMany({ where: { userId, readAt: null, ...(body.action === 'read' ? { id: body.id } : {}) }, data: { readAt: new Date() } });
    return NextResponse.json({ success: true, changed: result.count });
  } catch (error) { return failure(error); }
}
