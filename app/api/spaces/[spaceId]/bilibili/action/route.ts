import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export const runtime = 'nodejs';

const PROVIDER = 'BILIBILI';
const ACTIONS: Record<string, { label: string; verb: string }> = {
  BILIBILI_LIKE: { label: '点赞', verb: '点赞' },
  BILIBILI_COIN: { label: '投币', verb: '投币' },
  BILIBILI_FAVORITE: { label: '收藏', verb: '收藏' },
};
const DAILY_LIMIT = Math.max(1, Number(process.env.BILIBILI_DAILY_WRITE_LIMIT || 50));
const MIN_INTERVAL_MS = 3000;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const body = await request.json().catch(() => ({}));

    const kind = typeof body.kind === 'string' ? body.kind.trim().toUpperCase() : '';
    const action = ACTIONS[kind];
    if (!action) return NextResponse.json({ error: '不支持的动作类型' }, { status: 400 });

    const bvid = typeof body.bvid === 'string' ? body.bvid.trim() : '';
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return NextResponse.json({ error: '视频 ID 无效' }, { status: 400 });

    const title = String(body.title || '').trim().slice(0, 160) || bvid;
    const mediaId = kind === 'BILIBILI_FAVORITE' ? String(body.mediaId || '').trim() : '';
    if (kind === 'BILIBILI_FAVORITE' && !/^\d+$/.test(mediaId)) {
      return NextResponse.json({ error: '请先选择要加入的收藏夹' }, { status: 400 });
    }
    const count = Math.max(1, Math.min(2, Number(body.count) || 1));
    const requestId = typeof body.requestId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId) ? body.requestId : '';
    if (!requestId) return NextResponse.json({ error: '动作请求标识无效' }, { status: 400 });

    const space = await prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true, templateId: true } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    if (space.templateId !== 'bilibili-creator') return NextResponse.json({ error: '当前空间不是 B 站创作室' }, { status: 409 });

    const connector = await prisma.spaceConnector.findUnique({ where: { spaceId_provider: { spaceId, provider: PROVIDER } } });
    if (!connector?.enabled) return NextResponse.json({ error: '请先连接并启用 B 站账号' }, { status: 409 });
    if (connector.status !== 'READY') return NextResponse.json({ error: 'B 站连接不可用，请重新扫码' }, { status: 409 });

    const since = startOfToday();
    const [todayCount, latest, sameKindToday] = await Promise.all([
      prisma.spaceActionRequest.count({
        where: { spaceId, kind: { startsWith: 'BILIBILI_' }, status: { not: 'REJECTED' }, createdAt: { gte: since } },
      }),
      prisma.spaceActionRequest.findFirst({
        where: { spaceId, kind: { startsWith: 'BILIBILI_' }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.spaceActionRequest.findMany({
        where: { spaceId, kind, status: { not: 'REJECTED' }, createdAt: { gte: since } },
        select: { id: true, status: true, payload: true },
      }),
    ]);
    const duplicate = sameKindToday.find((item) => (item.payload as any)?.bvid === bvid) || null;
    if (todayCount >= DAILY_LIMIT) {
      return NextResponse.json({ error: `今天的 B 站操作已达上限（${DAILY_LIMIT} 次）` }, { status: 429 });
    }
    if (latest && Date.now() - latest.createdAt.getTime() < MIN_INTERVAL_MS) {
      return NextResponse.json({ error: '操作太快了，请 3 秒后再试' }, { status: 429 });
    }
    if (duplicate) {
      return NextResponse.json({ error: `这个视频今天已经${action.label}过了` }, { status: 409 });
    }

    const idempotencyKey = `bilibili:${spaceId}:${requestId}`;
    const payload: Record<string, unknown> = { bvid, title, kind };
    if (kind === 'BILIBILI_COIN') payload.count = count;
    if (kind === 'BILIBILI_FAVORITE') payload.mediaId = mediaId;

    const created = await prisma.spaceActionRequest.upsert({
      where: { idempotencyKey },
      create: {
        spaceId,
        kind,
        riskLevel: 'HIGH',
        title: `给「${title}」${action.label}`.slice(0, 160),
        status: 'PENDING',
        idempotencyKey,
        payload: payload as any,
        requestedAt: new Date(),
      },
      update: {},
    });

    await prisma.spaceMessage.create({
      data: {
        spaceId,
        role: 'assistant',
        speakerAgentId: 'space-coordinator',
        content: `我想给「${title}」${action.label}，等你确认。`,
        attachments: [{ type: 'action_request', actionId: created.id, kind }],
        sourceKey: `bilibili-action-request:${created.id}`,
      },
    }).catch(() => null);

    return NextResponse.json({ action: created }, { status: created.status === 'PENDING' ? 201 : 200 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || '创建动作失败' }, { status: 500 });
  }
}
