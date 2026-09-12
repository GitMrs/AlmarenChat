import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';

export const runtime = 'nodejs';

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string; serverId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, serverId } = await params;
    if (!await getSpaceForUser(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const body = await request.json();
    if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'enabled 必须是布尔值' }, { status: 400 });
    await prisma.$executeRawUnsafe(`UPDATE "SpaceMcpServer" SET "enabled" = ?, "updatedAt" = ? WHERE "id" = ? AND "spaceId" = ?`, body.enabled ? 1 : 0, new Date().toISOString(), serverId, spaceId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string; serverId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, serverId } = await params;
    if (!await getSpaceForUser(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    await prisma.$executeRawUnsafe(`DELETE FROM "SpaceMcpServer" WHERE "id" = ? AND "spaceId" = ?`, serverId, spaceId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
