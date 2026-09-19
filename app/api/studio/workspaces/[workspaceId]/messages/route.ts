import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { workspaceId } = await params;

    const workspace = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });

    if (!workspace) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const before = searchParams.get('before');
    const all = searchParams.get('all') === 'true';

    // 1. Total tokens across the whole workspace (accurate for token gauge)
    const tokenAgg = await prisma.studioMessage.aggregate({
      where: { workspaceId, userId },
      _sum: { tokens: true },
    });
    const totalTokens = tokenAgg._sum.tokens || 0;

    const totalCount = await prisma.studioMessage.count({
      where: { workspaceId, userId },
    });

    if (all) {
      const messages = await prisma.studioMessage.findMany({
        where: { workspaceId, userId },
        orderBy: { createdAt: 'asc' },
      });
      return NextResponse.json({
        messages,
        hasMore: false,
        nextCursor: null,
        totalCount,
        totalTokens,
      });
    }

    const limit = Math.min(100, Math.max(1, parseInt(limitParam || '30', 10)));

    let whereClause: any = { workspaceId, userId };
    if (before) {
      const cursorMsg = await prisma.studioMessage.findUnique({
        where: { id: before },
        select: { createdAt: true },
      });
      if (cursorMsg) {
        whereClause.createdAt = { lt: cursorMsg.createdAt };
      }
    }

    // Fetch the latest 'limit' messages before cursor in descending order
    const rawMessages = await prisma.studioMessage.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Reverse to chronological order (oldest to newest)
    const messages = rawMessages.reverse();

    // Check if there are still more older messages
    const oldestInBatch = messages.length > 0 ? messages[0] : null;
    let hasMore = false;
    let nextCursor: string | null = null;

    if (oldestInBatch) {
      const remainingCount = await prisma.studioMessage.count({
        where: {
          workspaceId,
          userId,
          createdAt: { lt: oldestInBatch.createdAt },
        },
      });
      hasMore = remainingCount > 0;
      nextCursor = oldestInBatch.id;
    }

    return NextResponse.json({
      messages,
      hasMore,
      nextCursor,
      totalCount,
      totalTokens,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { workspaceId } = await params;

    const workspace = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });

    if (!workspace) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('messageId');

    if (messageId) {
      await prisma.studioMessage.deleteMany({
        where: { id: messageId, workspaceId, userId },
      });
      return NextResponse.json({ success: true, workspaceId, messageId });
    }

    await prisma.studioMessage.deleteMany({
      where: { workspaceId, userId },
    });

    return NextResponse.json({ success: true, workspaceId });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}
