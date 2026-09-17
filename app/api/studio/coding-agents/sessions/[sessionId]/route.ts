import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { agentSupervisor } from '@/lib/coding-agents/supervisor';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { sessionId } = await params;

    const session = agentSupervisor.getSession(userId, sessionId);
    if (!session) {
      return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
    }

    return NextResponse.json({
      session: {
        id: session.id,
        agentId: session.agentId,
        spaceId: session.spaceId,
        prompt: session.prompt,
        status: session.status,
        workspaceDir: session.workspaceDir,
        pid: session.pid,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        exitCode: session.exitCode,
        error: session.error,
        logs: session.logBuffer,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));

    const action = body.action || 'stop';
    if (action === 'stop') {
      const ok = await agentSupervisor.stopSession(userId, sessionId, body.reason || '用户在前端点击中止');
      return NextResponse.json({ success: ok });
    }

    return NextResponse.json({ error: `不支持的动作: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}
