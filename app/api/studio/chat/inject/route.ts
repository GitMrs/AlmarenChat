import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { injectStudioUserMessage } from '@/lib/coding-agents/pi-runtime';

export const dynamic = 'force-dynamic';

/**
 * 任务执行中补充用户消息：
 * - steer：下一个 LLM 调用前插话（即时纠偏）
 * - followUp：当前任务全部结束后再处理
 */
export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const { message, workspaceId, mode = 'steer' } = await request.json();

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
    });

    if (!result.accepted) {
      return Response.json(
        { accepted: false, error: result.reason || '当前工作区没有正在执行的任务' },
        { status: 409 }
      );
    }

    await prisma.studioMessage
      .create({
        data: { workspaceId, userId, role: 'user', content: text },
      })
      .catch((e) => console.error('[Studio] Failed to persist injected message:', e));

    return Response.json({ accepted: true, mode: deliveryMode });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return Response.json({ error: errMsg }, { status });
  }
}
