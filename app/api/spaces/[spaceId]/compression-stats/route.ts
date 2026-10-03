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
  formatKB,
  DEFAULT_COMPRESSION_THRESHOLD_KB,
} from '@/lib/context-compression';

/**
 * GET /api/spaces/[spaceId]/compression-stats
 * 获取空间的上下文容量与压缩统计（基于真实 KB 体积）
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

    const { searchParams } = new URL(request.url);
    const thresholdKB = Math.max(10, Math.min(500, parseInt(searchParams.get('thresholdKB') || String(DEFAULT_COMPRESSION_THRESHOLD_KB), 10) || DEFAULT_COMPRESSION_THRESHOLD_KB));
    const thresholdBytes = thresholdKB * 1024;

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

    if (totalMessageCount === 0) {
      return NextResponse.json({
        totalBytes: 0,
        activeBytes: 0,
        thresholdBytes,
        thresholdKB,
        savedBytes: 0,
        usagePercentage: 0,
        isCompressed: false,
        totalMessages: 0,
        activeMessages: 0,
        archivedMessages: 0,
        formattedTotal: '0 KB',
        formattedActive: '0 KB',
        formattedThreshold: `${thresholdKB} KB`,
        formattedSaved: '0 KB',
        originalCount: 0,
        compressedCount: 0,
        reductionPercentage: 0,
        compressionLevel: 'none',
        messageCount: 0,
        checkpoint: null,
      });
    }

    let activeBytes = totalBytes;
    let savedBytes = 0;
    let isCompressed = false;
    let activeMessages = totalMessageCount;
    let archivedMessages = 0;

    if (checkpoint) {
      const recentMessages = allMessages.filter((m) =>
        new Date(m.createdAt) > new Date(checkpoint.throughCreatedAt) ||
        (new Date(m.createdAt).getTime() === new Date(checkpoint.throughCreatedAt).getTime() && m.id > checkpoint.throughMessageId)
      );
      const checkpointSummaryBytes = calculateTextBytes(checkpoint.summary);
      const recentBytes = calculateMessagesBytes(recentMessages);
      activeBytes = checkpointSummaryBytes + recentBytes;
      savedBytes = Math.max(0, totalBytes - activeBytes);
      isCompressed = true;
      activeMessages = recentMessages.length;
      archivedMessages = checkpoint.sourceMessageCount;
    }

    const usagePercentage = Math.min(100, Math.round((activeBytes / thresholdBytes) * 100));

    return NextResponse.json({
      totalBytes,
      activeBytes,
      thresholdBytes,
      thresholdKB,
      savedBytes,
      usagePercentage,
      isCompressed,
      totalMessages: totalMessageCount,
      activeMessages,
      archivedMessages,
      formattedTotal: formatKB(totalBytes),
      formattedActive: formatKB(activeBytes),
      formattedThreshold: `${thresholdKB} KB`,
      formattedSaved: formatKB(savedBytes),
      checkpoint: checkpoint ? {
        updatedAt: checkpoint.updatedAt,
        sourceMessageCount: checkpoint.sourceMessageCount,
        sourceTokenCount: checkpoint.sourceTokenCount,
        throughMessageId: checkpoint.throughMessageId,
      } : null,
      // 兼容字段
      originalCount: totalMessageCount,
      compressedCount: isCompressed ? 1 + activeMessages : totalMessageCount,
      reductionPercentage: totalBytes > 0 ? Math.round((savedBytes / totalBytes) * 100) : 0,
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
