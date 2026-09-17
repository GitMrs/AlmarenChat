import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { resolveStudioWorkspace } from '@/lib/coding-agents/sandbox';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);

    let workspaces = await prisma.studioWorkspace.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    // If user has no studio workspace yet, auto-create a default one
    if (workspaces.length === 0) {
      const defaultWs = await prisma.studioWorkspace.create({
        data: {
          userId,
          name: '?????',
          description: '????????????????',
        },
      });
      await resolveStudioWorkspace(process.cwd(), userId, defaultWs.id);
      workspaces = [
        {
          ...defaultWs,
          _count: { messages: 0 },
        },
      ];
    } else {
      // Ensure physical directory exists for existing workspaces
      for (const ws of workspaces) {
        await resolveStudioWorkspace(process.cwd(), userId, ws.id).catch(() => {});
      }
    }

    return NextResponse.json({ workspaces });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}

import fs from 'node:fs';
import path from 'node:path';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    const name = String(body.name || '').trim();
    const description = body.description ? String(body.description).trim() : null;
    const systemPrompt = body.systemPrompt ? String(body.systemPrompt).trim() : null;

    if (!name) {
      return NextResponse.json({ error: '工作区名称不能为空' }, { status: 400 });
    }

    const workspace = await prisma.studioWorkspace.create({
      data: {
        userId,
        name,
        description,
        systemPrompt,
      },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    // Pre-create physical workspace directory and sync AGENTS.md
    const workspaceDir = await resolveStudioWorkspace(process.cwd(), userId, workspace.id);
    if (systemPrompt) {
      const agentsMdPath = path.join(workspaceDir, 'AGENTS.md');
      await fs.promises.writeFile(agentsMdPath, `# 项目规范与空间指令\n\n${systemPrompt}\n`, 'utf-8');
    }

    return NextResponse.json({ workspace }, { status: 201 });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: errMsg }, { status });
  }
}
