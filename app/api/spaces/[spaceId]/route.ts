import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { SPACE_COORDINATOR_ID, getSpaceForUser } from '@/app/api/_lib/spaces';
import { ACTIVE_AGENT_RUN_STATUSES } from '@/app/api/_lib/agent-runs';

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const [space, imageSettings] = await Promise.all([
      getSpaceForUser(spaceId, userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: { imageModelEnabled: true, imageModelName: true, apiBaseUrl: true, apiKey: true },
      }),
    ]);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    return NextResponse.json({
      space: {
        ...space,
        imageGenerationAvailable: Boolean(
          imageSettings?.imageModelEnabled && imageSettings.imageModelName && imageSettings.apiBaseUrl && imageSettings.apiKey
        ),
      },
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const body = await request.json();
    const { name, description, instructions, executionMode, hostAgentId, activeWorkId } = body;

    const space = await prisma.space.findFirst({ where: { id: spaceId, userId } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    if (Object.prototype.hasOwnProperty.call(body, 'runtimeType')) {
      return NextResponse.json({ error: '空间运行时创建后不可更改' }, { status: 400 });
    }

    const data: { name?: string; description?: string | null; instructions?: string | null; executionMode?: string; hostAgentId?: string | null; activeWorkId?: string | null } = {};
    if (name !== undefined) {
      const title = typeof name === 'string' ? name.trim() : '';
      if (!title) return NextResponse.json({ error: '空间名称不能为空' }, { status: 400 });
      data.name = title;
    }
    if (description !== undefined) {
      data.description = typeof description === 'string' ? description.trim() || null : null;
    }
    if (instructions !== undefined) {
      const value = typeof instructions === 'string' ? instructions.trim() : '';
      if (value.length > 12_000) {
        return NextResponse.json({ error: '空间规则不能超过 12000 字' }, { status: 400 });
      }
      data.instructions = value || null;
    }
    if (executionMode !== undefined) {
      if (!['AUTO', 'REVIEW_DISPATCH'].includes(executionMode)) {
        return NextResponse.json({ error: '不支持的空间执行模式' }, { status: 400 });
      }
      data.executionMode = executionMode;
    }
    if (hostAgentId !== undefined) {
      if (hostAgentId === null || hostAgentId === '' || hostAgentId === SPACE_COORDINATOR_ID) {
        data.hostAgentId = SPACE_COORDINATOR_ID;
      } else {
        return NextResponse.json({ error: '空间默认协调者不可替换；请用 @ 指定普通成员。' }, { status: 400 });
      }
    }
    if (activeWorkId !== undefined) {
      const nextWorkId = typeof activeWorkId === 'string' && activeWorkId.trim() ? activeWorkId.trim() : null;
      const [targetWork, activeRun] = await Promise.all([
        nextWorkId ? prisma.spaceWork.findFirst({ where: { id: nextWorkId, spaceId }, select: { id: true } }) : null,
        prisma.agentRun.findFirst({ where: { spaceId, status: { in: ACTIVE_AGENT_RUN_STATUSES } }, select: { id: true } }),
      ]);
      if (nextWorkId && !targetWork) return NextResponse.json({ error: '指定成果不存在' }, { status: 404 });
      if (activeRun && nextWorkId !== space.activeWorkId) {
        return NextResponse.json({ error: '任务执行期间不能切换当前成果' }, { status: 409 });
      }
      data.activeWorkId = nextWorkId;
    }

    const updated = await prisma.space.update({ where: { id: spaceId }, data });
    return NextResponse.json({ space: updated });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await prisma.space.findFirst({ where: { id: spaceId, userId } });
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    await prisma.space.delete({ where: { id: spaceId } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
