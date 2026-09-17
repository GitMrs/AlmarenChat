import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { deleteStudioWorkspaceFolder, resolveStudioWorkspace } from '@/lib/coding-agents/sandbox';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { workspaceId } = await params;
    const body = await request.json();

    const existing = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    const name = body.name !== undefined ? String(body.name).trim() : undefined;
    const description = body.description !== undefined ? String(body.description).trim() : undefined;
    const systemPrompt = body.systemPrompt !== undefined ? String(body.systemPrompt).trim() : undefined;

    if (name !== undefined && !name) {
      return NextResponse.json({ error: '工作区名称不能为空' }, { status: 400 });
    }

    const updated = await prisma.studioWorkspace.update({
      where: { id: workspaceId },
      data: {
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(systemPrompt !== undefined ? { systemPrompt: systemPrompt || null } : {}),
      },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    if (systemPrompt !== undefined) {
      const workspaceDir = await resolveStudioWorkspace(process.cwd(), userId, workspaceId);
      const agentsMdPath = path.join(workspaceDir, 'AGENTS.md');
      if (systemPrompt) {
        await fs.promises.writeFile(agentsMdPath, `# 项目规范与空间指令\n\n${systemPrompt}\n`, 'utf-8');
      } else if (fs.existsSync(agentsMdPath)) {
        await fs.promises.unlink(agentsMdPath).catch(() => {});
      }
    }

    return NextResponse.json({ workspace: updated });
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

    const existing = await prisma.studioWorkspace.findFirst({
      where: { id: workspaceId, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    const totalCount = await prisma.studioWorkspace.count({
      where: { userId },
    });
    if (totalCount <= 1) {
      return NextResponse.json({ error: '至少需要保留一个工作区，无法删除最后一个' }, { status: 400 });
    }

    await prisma.studioWorkspace.delete({
      where: { id: workspaceId },
    });

    await deleteStudioWorkspaceFolder(process.cwd(), userId, workspaceId);

    return NextResponse.json({ success: true, deletedWorkspaceId: workspaceId });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}
