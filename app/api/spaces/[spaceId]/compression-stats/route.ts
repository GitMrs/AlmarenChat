import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import {
  buildContextCheckpointSummary,
  estimateTokens,
  estimateMessagesTokens,
  calculateTextBytes,
  calculateMessagesBytes,
} from '@/lib/context-compression';
import { modelTokenLimits } from '@/lib/model-limits.mjs';

/**
 * GET /api/spaces/[spaceId]/compression-stats
 * 获取空间对话的估算 Token 用量，与自动压缩使用相同预算。
 */
export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;

    // 验证空间权限
    const space = await prisma.space.findFirst({
      where: { id: spaceId, userId },
      include: { user: { select: { contextMessageLimit: true, modelName: true, modelContextWindow: true } } },
    });

    if (!space) {
      return NextResponse.json({ error: '空间不存在或无权限' }, { status: 404 });
    }

    const limits = modelTokenLimits(space.user.modelName, space.user.modelContextWindow);
    const thresholdTokens = limits.compactionTriggerTokens;
    const formatTokens = (tokens: number) => `${tokens.toLocaleString('en-US')} Token`;

    let checkpoint: any = null;
    try {
      checkpoint = await prisma.spaceContextCheckpoint.findUnique({ where: { spaceId } });
    } catch (error: any) {
      if (!/no such table/i.test(String(error?.message || ''))) throw error;
    }

    const allMessages = await prisma.spaceMessage.findMany({
      where: { spaceId },
      select: { id: true, content: true, role: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const totalMessageCount = allMessages.length;
    const totalBytes = calculateMessagesBytes(allMessages);

    const totalTokens = estimateMessagesTokens(allMessages);
    const historyLimit = Math.max(1, Math.min(240, space.user.contextMessageLimit * 4));
    let activeHistory = allMessages.slice(-historyLimit);
    let activeBytes = calculateMessagesBytes(activeHistory);
    let savedBytes = 0;
    let isCompressed = false;
    let activeMessages = activeHistory.length;
    let archivedMessages = 0;

    if (checkpoint) {
      const recentMessages = allMessages.filter((m) =>
        new Date(m.createdAt) > new Date(checkpoint.throughCreatedAt) ||
        (new Date(m.createdAt).getTime() === new Date(checkpoint.throughCreatedAt).getTime() && m.id > checkpoint.throughMessageId)
      ).slice(0, historyLimit);
      activeHistory = [{ id: `checkpoint:${spaceId}`, role: 'system', content: checkpoint.summary, createdAt: checkpoint.updatedAt }, ...recentMessages];
      const checkpointSummaryBytes = calculateTextBytes(checkpoint.summary);
      const recentBytes = calculateMessagesBytes(recentMessages);
      activeBytes = checkpointSummaryBytes + recentBytes;
      savedBytes = Math.max(0, totalBytes - activeBytes);
      isCompressed = true;
      activeMessages = recentMessages.length;
      archivedMessages = checkpoint.sourceMessageCount;
    }

    const activeTokens = estimateMessagesTokens(activeHistory);
    const savedTokens = Math.max(0, totalTokens - activeTokens);
    const usagePercentage = Math.min(100, Math.round((activeTokens / thresholdTokens) * 100));

    return NextResponse.json({
      totalBytes,
      activeBytes,
      thresholdTokens,
      modelContextWindow: limits.contextWindow,
      totalTokens,
      activeTokens,
      savedTokens,
      savedBytes,
      usagePercentage,
      isCompressed,
      totalMessages: totalMessageCount,
      activeMessages,
      archivedMessages,
      formattedTotal: formatTokens(totalTokens),
      formattedActive: formatTokens(activeTokens),
      formattedThreshold: formatTokens(thresholdTokens),
      formattedSaved: formatTokens(savedTokens),
      checkpoint: checkpoint ? {
        updatedAt: checkpoint.updatedAt,
        sourceMessageCount: checkpoint.sourceMessageCount,
        sourceTokenCount: checkpoint.sourceTokenCount,
        throughMessageId: checkpoint.throughMessageId,
      } : null,
      // 兼容字段
      originalCount: totalMessageCount,
      originalTokens: totalTokens,
      compressedTokens: activeTokens,
      compressedCount: activeHistory.length,
      reductionPercentage: totalTokens > 0 ? Math.round((savedTokens / totalTokens) * 100) : 0,
      compressionLevel: isCompressed ? 'moderate' : (usagePercentage >= 80 ? 'light' : 'none'),
      messageCount: totalMessageCount,
      lastCompressedAt: checkpoint ? checkpoint.updatedAt : null,
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
    const defaultPreserve = 10;
    const preserveRecent = typeof body?.preserveRecent === 'number'
      ? Math.max(2, Math.min(30, Math.floor(body.preserveRecent)))
      : defaultPreserve;

    const allMessages = await prisma.spaceMessage.findMany({
      where: { spaceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (allMessages.length < 4) {
      return NextResponse.json({
        error: `空间当前仅有 ${allMessages.length} 条消息，暂无需压缩归档。`,
      }, { status: 400 });
    }

    const actualPreserve = Math.min(preserveRecent, Math.max(2, allMessages.length - 2));
    const boundary = Math.max(1, allMessages.length - actualPreserve);
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
