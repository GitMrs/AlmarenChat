import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { serializeConnector } from '@/lib/connectors/registry.mjs';

export const runtime = 'nodejs';

const PROVIDER = 'WECHAT_OFFICIAL_ACCOUNT';
const OPERATION = 'WECHAT_VALIDATE_CONNECTION';

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const body = await request.json().catch(() => ({}));
    const requestId = typeof body.requestId === 'string' && /^[a-zA-Z0-9_-]{12,100}$/.test(body.requestId)
      ? body.requestId
      : '';
    if (!requestId) return NextResponse.json({ error: '连接校验请求标识无效' }, { status: 400 });

    const timestamp = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const connector = await tx.spaceConnector.findFirst({
        where: { spaceId, provider: PROVIDER, enabled: true, space: { userId } },
      });
      if (!connector) throw new Error('请先配置并启用微信公众号连接器');

      const idempotencyKey = `wechat-validate:${spaceId}:${requestId}`;
      const action = await tx.spaceActionRequest.upsert({
        where: { idempotencyKey },
        create: {
          id: randomUUID(),
          spaceId,
          kind: OPERATION,
          riskLevel: 'LOW',
          title: '验证微信公众号连接',
          status: 'APPROVED',
          payload: { provider: PROVIDER },
          idempotencyKey,
          decidedBy: userId,
          requestedAt: timestamp,
          decidedAt: timestamp,
        },
        update: {},
        include: { connectorExecution: true },
      });
      if (action.connectorExecution) return { connector, action };
      await tx.spaceConnectorExecution.upsert({
        where: { actionRequestId: action.id },
        create: {
          connectorId: connector.id,
          actionRequestId: action.id,
          operation: OPERATION,
          status: 'QUEUED',
          requestSummary: { provider: PROVIDER },
        },
        update: {},
      });
      const updatedConnector = await tx.spaceConnector.update({
        where: { id: connector.id },
        data: { status: 'CHECKING', lastError: null },
      });
      const updatedAction = await tx.spaceActionRequest.findUnique({
        where: { id: action.id },
        include: { connectorExecution: true },
      });
      return { connector: updatedConnector, action: updatedAction };
    });
    return NextResponse.json({ connector: serializeConnector(result.connector), action: result.action }, { status: 202 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.message === '请先配置并启用微信公众号连接器') return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
