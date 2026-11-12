import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { assertConnectorScope } from '@/app/api/_lib/personal-connectors';
import { listConnectorBindings, setConnectorBinding } from '@/lib/connectors/personal-store.mjs';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const query = new URL(request.url).searchParams;
    const scope = query.get('scope') || '';
    const target = await assertConnectorScope(userId, scope, query.get('scopeId') || undefined);
    return NextResponse.json({ connectorIds: await listConnectorBindings(prisma, userId, scope, target.scopeId) });
  } catch (error: any) { return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 403 }); }
}

export async function PATCH(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    if (typeof body.enabled !== 'boolean' || typeof body.connectorId !== 'string') throw new Error('绑定参数无效');
    const target = await assertConnectorScope(userId, body.scope, body.scopeId);
    await setConnectorBinding(prisma, userId, target.scope, target.scopeId, body.connectorId, body.enabled);
    return NextResponse.json({ ok: true });
  } catch (error: any) { return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 403 }); }
}
