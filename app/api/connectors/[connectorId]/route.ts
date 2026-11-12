import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { deletePersonalConnector, savePersonalConnector } from '@/lib/connectors/personal-store.mjs';

type Context = { params: Promise<{ connectorId: string }> };
export async function PATCH(request: Request, { params }: Context) {
  try {
    const userId = requireAuth(request);
    return NextResponse.json({ connector: await savePersonalConnector(prisma, userId, await request.json(), (await params).connectorId) });
  } catch (error: any) { return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 400 }); }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    await deletePersonalConnector(prisma, requireAuth(request), (await params).connectorId);
    return NextResponse.json({ ok: true });
  } catch (error: any) { return NextResponse.json({ error: error.message === 'Unauthorized' ? 'Unauthorized' : '删除连接器失败' }, { status: error.message === 'Unauthorized' ? 401 : 400 }); }
}
