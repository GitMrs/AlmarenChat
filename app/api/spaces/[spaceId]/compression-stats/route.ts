import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { estimateMessagesTokens, compressConversationContext } from '@/lib/context-compression';

/**
 * GET /api/spaces/[spaceId]/compression-stats
 * 获取空间的上下文压缩统计
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

    // 与聊天请求使用相同的候选历史窗口
    const messages = await prisma.spaceMessage.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(80, contextMessageLimit * 2)),
    });

    if (messages.length === 0) {
      return NextResponse.json({
        originalCount: 0,
        originalTokens: 0,
        compressedCount: 0,
        compressedTokens: 0,
        reductionPercentage: 0,
        compressionLevel: 'none',
        budgetExceeded: false,
        messageCount: 0,
        compressionHistory: [],
        lastCompressedAt: null,
      });
    }

    // 按时间正序排列
    const orderedMessages = messages.reverse();

    // 计算原始统计
    const originalTokens = estimateMessagesTokens(orderedMessages);

    // 执行压缩分析
    const compressionResult = compressConversationContext(orderedMessages, {
      maxMessages: contextMessageLimit,
      targetTokens: 6000,
      preserveRecent: Math.max(1, Math.floor(contextMessageLimit * 0.4)),
      aggressiveAfter: Math.floor(contextMessageLimit * 1.5),
      preserveSystem: false,
    });

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
      // Spaces can be used before the optional Agent runtime migration is applied.
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

    return NextResponse.json({
      ...compressionResult.stats,
      messageCount: orderedMessages.length,
      compressionHistory,
      lastCompressedAt: compressionHistory.length > 0
        ? compressionHistory[0].timestamp
        : null,
    });
  } catch (e: any) {
    console.error('获取压缩统计失败:', e);
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message || '获取压缩统计失败' }, { status: 500 });
  }
}
