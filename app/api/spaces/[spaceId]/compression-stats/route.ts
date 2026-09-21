import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import {
  buildContextCheckpointSummary,
  estimateTokens,
  estimateMessagesTokens,
  compressConversationContext,
} from '@/lib/context-compression';

/**
 * GET /api/spaces/[spaceId]/compression-stats
 * 获取空间的上下文压缩统计（感知增量检查点）
 */
export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;

    // 验证空间权限
    const space = await prisma.space.findFirst({
      where: { id: spaceId, userId },
      include: { user: { select: { contextMessageLimit: true } } },
    });

    if (!space) {
      return NextResponse.json({ error: '空间不存在或无权限' }, { status: 404 });
    }

    const contextMessageLimit = Math.max(1, Math.min(80, space.user.contextMessageLimit || 40));
    let checkpoint: any = null;
    try {
      checkpoint = await prisma.spaceContextCheckpoint.findUnique({ where: { spaceId } });
    } catch (error: any) {
      if (!/no such table/i.test(String(error?.message || ''))) throw error;
    }

    const totalMessageCount = await prisma.spaceMessage.count({ where: { spaceId } });

    if (totalMessageCount === 0) {
      return NextResponse.json({
        originalCount: 0,
        originalTokens: 0,
        compressedCount: 0,
        compressedTokens: 0,
        reductionCount: 0,
        reductionTokens: 0,
        reductionPercentage: 0,
        compressionLevel: 'none',
        budgetExceeded: false,
        messageCount: 0,
        compressionHistory: [],
        lastCompressedAt: null,
        checkpoint: null,
      });
    }

    // 获取历史压缩统计（从 AgentRunEvent 中读取）
    let compressionEvents: unknown[] = [];
    try {
      compressionEvents = await prisma.$queryRaw<any[]>`
        SELECT
          event.payload,
          event.createdAt
        FROM AgentRunEvent AS event
        INNER JOIN AgentRun AS run ON run.id = event.runId
        WHERE run.spaceId = ${spaceId}
          AND event.type = 'CONTEXT_COMPRESSED'
        ORDER BY event.createdAt DESC
        LIMIT 10
      `;
    } catch (error: any) {
      if (!/no such table/i.test(String(error?.message || ''))) throw error;
    }

    const compressionHistory = (compressionEvents as any[]).map((event: any) => {
      try {
        const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
        return {
          timestamp: event.createdAt,
          reductionPercentage: payload?.reductionPercentage ?? payload?.reductionRatio ?? 0,
          level: payload?.compressionLevel || 'moderate',
          originalTokens: payload?.originalTokens || 0,
          compressedTokens: payload?.compressedTokens || 0,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    // 如果已建立增量检查点，按检查点计算真实的归档压缩率
    if (checkpoint) {
      const recentMessages = await prisma.spaceMessage.findMany({
        where: {
          spaceId,
          OR: [
            { createdAt: { gt: checkpoint.throughCreatedAt } },
            { createdAt: checkpoint.throughCreatedAt, id: { gt: checkpoint.throughMessageId } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      const checkpointTokens = estimateTokens(checkpoint.summary) + 20;
      const recentTokens = estimateMessagesTokens(recentMessages);
      const activeTokens = checkpointTokens + recentTokens;
      const originalTokens = checkpoint.sourceTokenCount + recentTokens;
      const reductionTokens = Math.max(0, originalTokens - activeTokens);
      const reductionPercentage = originalTokens > 0
        ? Math.round((reductionTokens / originalTokens) * 100)
        : 0;
      const originalCount = checkpoint.sourceMessageCount + recentMessages.length;
      const compressedCount = 1 + recentMessages.length;
      const level = reductionPercentage >= 60 ? 'aggressive' : reductionPercentage >= 30 ? 'moderate' : 'light';

      return NextResponse.json({
        originalCount,
        originalTokens,
        compressedCount,
        compressedTokens: activeTokens,
        reductionCount: Math.max(0, originalCount - compressedCount),
        reductionTokens,
        reductionPercentage,
        compressionLevel: level,
        budgetExceeded: false,
        messageCount: totalMessageCount,
        compressionHistory,
        lastCompressedAt: checkpoint.updatedAt,
        checkpoint: {
          updatedAt: checkpoint.updatedAt,
          sourceMessageCount: checkpoint.sourceMessageCount,
          sourceTokenCount: checkpoint.sourceTokenCount,
          throughMessageId: checkpoint.throughMessageId,
        },
      });
    }

    // 未建立检查点时，按常规滑动窗口计算
    const messages = await prisma.spaceMessage.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(80, contextMessageLimit * 2)),
    });
    const orderedMessages = messages.reverse();

    const compressionResult = compressConversationContext(orderedMessages, {
      maxMessages: contextMessageLimit,
      targetTokens: 6000,
      preserveRecent: Math.max(1, Math.floor(contextMessageLimit * 0.4)),
      aggressiveAfter: Math.floor(contextMessageLimit * 1.5),
      preserveSystem: false,
    });

    return NextResponse.json({
      ...compressionResult.stats,
      messageCount: totalMessageCount,
      compressionHistory,
      lastCompressedAt: compressionHistory.length > 0 ? compressionHistory[0].timestamp : null,
      checkpoint: null,
    });
  } catch (e: any) {
    console.error('获取压缩统计失败:', e);
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message || '获取压缩统计失败' }, { status: 500 });
  }
}

/**
 * POST /api/spaces/[spaceId]/compression-stats
 * 手动为空间创建/更新上下文检查点摘要（深度压缩）
 */
export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;

    const space = await prisma.space.findFirst({
      where: { id: spaceId, userId },
      include: { user: { select: { contextMessageLimit: true } } },
    });

    if (!space) {
      return NextResponse.json({ error: '空间不存在或无权限' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const preserveRecent = typeof body?.preserveRecent === 'number'
      ? Math.max(2, Math.min(30, Math.floor(body.preserveRecent)))
      : Math.max(5, Math.min(15, Math.floor((space.user.contextMessageLimit || 40) * 0.2)));

    const allMessages = await prisma.spaceMessage.findMany({
      where: { spaceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (allMessages.length <= preserveRecent) {
      return NextResponse.json({
        error: `空间当前仅有 ${allMessages.length} 条消息，少于保留阈值（${preserveRecent}条），无需归档。`,
      }, { status: 400 });
    }

    const boundary = Math.max(1, allMessages.length - preserveRecent);
    const checkpointSource = allMessages.slice(0, boundary);
    const recentMessages = allMessages.slice(boundary);
    const throughMessage = checkpointSource[checkpointSource.length - 1];

    if (!throughMessage) {
      return NextResponse.json({ error: '没有可归档的早期消息' }, { status: 400 });
    }

    const summary = buildContextCheckpointSummary(checkpointSource);
    const sourceTokenCount = estimateMessagesTokens(checkpointSource);

    const checkpoint = await prisma.spaceContextCheckpoint.upsert({
      where: { spaceId },
      create: {
        id: randomUUID(),
        spaceId,
        throughMessageId: throughMessage.id,
        throughCreatedAt: new Date(throughMessage.createdAt),
        summary,
        sourceMessageCount: checkpointSource.length,
        sourceTokenCount,
      },
      update: {
        throughMessageId: throughMessage.id,
        throughCreatedAt: new Date(throughMessage.createdAt),
        summary,
        sourceMessageCount: checkpointSource.length,
        sourceTokenCount,
        updatedAt: new Date(),
      },
    });

    await prisma.space.update({
      where: { id: spaceId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      checkpoint: {
        id: checkpoint.id,
        updatedAt: checkpoint.updatedAt,
        sourceMessageCount: checkpoint.sourceMessageCount,
        sourceTokenCount: checkpoint.sourceTokenCount,
        throughMessageId: checkpoint.throughMessageId,
      },
      archivedCount: checkpointSource.length,
      preservedCount: recentMessages.length,
    });
  } catch (e: any) {
    console.error('创建上下文检查点失败:', e);
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message || '创建检查点失败' }, { status: 500 });
  }
}

/**
 * DELETE /api/spaces/[spaceId]/compression-stats
 * 清除空间的增量检查点，恢复原始滑动窗口
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;

    const space = await prisma.space.findFirst({
      where: { id: spaceId, userId },
    });
    if (!space) {
      return NextResponse.json({ error: '空间不存在或无权限' }, { status: 404 });
    }

    await prisma.spaceContextCheckpoint.deleteMany({
      where: { spaceId },
    });

    await prisma.space.update({
      where: { id: spaceId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message || '清除检查点失败' }, { status: 500 });
  }
}
