import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_RESEARCH', 'CANCEL_REQUESTED'];
const ACTIVE_RELAY_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'CANCEL_REQUESTED'];

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }
    if (space.runtimeType === 'PI_CODING') return NextResponse.json({ discussions: [] });

    const discussions = await prisma.spaceDiscussion.findMany({
      where: { spaceId, userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return NextResponse.json({ discussions });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    if (space.runtimeType === 'PI_CODING') {
      return NextResponse.json({ error: 'Pi 空间不使用原生多人讨论流程' }, { status: 409 });
    }

    const body = await request.json();
    const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 4000) : '';
    const requestedIds: string[] = Array.isArray(body.participantIds)
      ? body.participantIds.map(String).filter(Boolean)
      : [];
    const memberIds = new Set(space.members.map((member) => member.agentId));
    const participantIds: string[] = [...new Set<string>(requestedIds)].filter((id) => memberIds.has(id)).slice(0, 4);

    if (!topic) return NextResponse.json({ error: '请输入讨论主题' }, { status: 400 });
    if (participantIds.length < 2) return NextResponse.json({ error: '至少选择两位空间成员' }, { status: 400 });

    const [active, activeRelay] = await Promise.all([
      prisma.spaceDiscussion.findFirst({
        where: { spaceId, userId, status: { in: ACTIVE_STATUSES } },
        select: { id: true },
      }),
      prisma.spaceRelay.findFirst({
        where: { spaceId, userId, status: { in: ACTIVE_RELAY_STATUSES } },
        select: { id: true },
      }),
    ]);
    if (active || activeRelay) return NextResponse.json({ error: '当前已有讨论或接力正在进行' }, { status: 409 });

    const result = await prisma.$transaction(async (tx) => {
      await tx.spaceMessage.create({ data: { spaceId, role: 'user', content: topic } });
      const discussion = await tx.spaceDiscussion.create({
        data: {
          spaceId,
          userId,
          topic,
          participantIds,
          transcript: [],
          allowWeb: Boolean(body.allowWeb),
        },
      });
      await tx.space.update({ where: { id: spaceId }, data: { updatedAt: new Date() } });
      return discussion;
    });

    return NextResponse.json({ discussion: result }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
