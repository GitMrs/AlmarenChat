import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { canRetryConnectorStatus } from '@/lib/connectors/registry.mjs';

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string; actionId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, actionId } = await params;
    const timestamp = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const action = await tx.spaceActionRequest.findFirst({
        where: { id: actionId, spaceId, space: { userId } },
        include: { connectorExecution: true },
      });
      if (!action) throw new Error('动作请求不存在');
      if (!canRetryConnectorStatus(action)) {
        throw new Error('当前动作不能安全地重新查询');
      }
      await tx.spaceConnectorExecution.update({
        where: { id: action.connectorExecution.id },
        data: { status: 'WAITING_PROVIDER', nextPollAt: timestamp, error: null, completedAt: null },
      });
      return tx.spaceActionRequest.update({
        where: { id: action.id },
        data: { status: 'APPROVED', error: null, completedAt: null },
        include: {
          work: true,
          run: { select: { status: true, result: true, error: true, completedAt: true } },
          connectorExecution: true,
        },
      });
    });
    return NextResponse.json({ action: result });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === '动作请求不存在') return NextResponse.json({ error: error.message }, { status: 404 });
    if (error.message === '当前动作不能安全地重新查询') return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
