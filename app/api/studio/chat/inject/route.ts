import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { injectStudioUserMessage, clearStudioMessageQueue, cancelStudioQueuedMessage } from '@/lib/coding-agents/pi-runtime';

export const dynamic = 'force-dynamic';

/**
 * 任务执行中补充用户消息：
 * - steer：下一个 LLM 调用前插话（即时纠偏）
 * - followUp：当前任务全部结束后再处理
 */
export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const { message, workspaceId, mode = 'steer', runId } = await request.json();

    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) {
      return Response.json({ error: '消息内容不能为空' }, { status: 400 });
    }
    if (!workspaceId) {
      return Response.json({ error: '缺少 workspaceId' }, { status: 400 });
    }

    const workspace = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
      select: { id: true },
    });
    if (!workspace) {
      return Response.json({ error: '工作区不存在' }, { status: 404 });
    }

    const deliveryMode = mode === 'followUp' ? 'followUp' : 'steer';
    const result = await injectStudioUserMessage({
      userId,
      workspaceId,
      message: text,
      mode: deliveryMode,
      runId,
    });

    if (!result.accepted) {
      return Response.json(
        { accepted: false, error: result.reason || '当前工作区没有正在执行的任务' },
        { status: 409 }
      );
    }

    // The owning chat request saves the injected message in order with assistant
    // segments, so clearing waits for all writes rather than racing this endpoint.

    return Response.json({ accepted: true, mode: deliveryMode, disposition: result.disposition });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : errMsg === '当前任务已结束或已切换' ? 409 : 500;
    return Response.json({ error: errMsg }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = requireAuth(request);
    const { workspaceId, runId, itemId } = await request.json();
    if (typeof workspaceId !== 'string' || typeof runId !== 'string' || !workspaceId || !runId) {
      return Response.json({ error: '缺少 workspaceId 或 runId' }, { status: 400 });
    }
    const workspace = await prisma.studioWorkspace.findFirst({ where: { id: workspaceId, userId }, select: { id: true } });
    if (!workspace) return Response.json({ error: '工作区不存在' }, { status: 404 });
    if (itemId !== undefined) {
      if (typeof itemId !== 'string' || !itemId) return Response.json({ error: '无效的消息标识' }, { status: 400 });
      const cancelled = await cancelStudioQueuedMessage({ userId, workspaceId, runId, itemId });
      if (!cancelled) return Response.json({ error: '这条消息已开始处理或已移出队列，无法撤回' }, { status: 409 });
      return Response.json({ cancelled: true });
    }
    await clearStudioMessageQueue({ userId, workspaceId, runId });
    return Response.json({ cleared: true });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    const status = error === 'Unauthorized' ? 401 : error === '当前任务已结束或已切换' ? 409 : 500;
    return Response.json({ error }, { status });
  }
}
