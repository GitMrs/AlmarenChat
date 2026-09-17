import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { agentSupervisor } from '@/lib/coding-agents/supervisor';
import { CodingAgentId } from '@/lib/coding-agents/types';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const sessions = agentSupervisor.getUserSessions(userId).map((s) => ({
      id: s.id,
      agentId: s.agentId,
      spaceId: s.spaceId,
      prompt: s.prompt,
      status: s.status,
      workspaceDir: s.workspaceDir,
      pid: s.pid,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      exitCode: s.exitCode,
      error: s.error,
      logCount: s.logBuffer.length,
    }));

    return NextResponse.json({ sessions });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();

    const { agentId, prompt, spaceId, customApiKey } = body;
    if (!agentId || !prompt) {
      return NextResponse.json(
        { error: 'agentId 和 prompt 为必填参数' },
        { status: 400 }
      );
    }

    const session = await agentSupervisor.launchSession({
      userId,
      spaceId: spaceId || 'default',
      agentId: agentId as CodingAgentId,
      prompt,
      customApiKey,
    });

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        agentId: session.agentId,
        spaceId: session.spaceId,
        prompt: session.prompt,
        status: session.status,
        workspaceDir: session.workspaceDir,
        pid: session.pid,
        startedAt: session.startedAt,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = errorMsg === 'Unauthorized' ? 401 : 400;
    return NextResponse.json({ error: errorMsg }, { status });
  }
}
