import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { SPACE_COORDINATOR_ID, ensureSpaceRoot, resolveManyAgents } from '@/app/api/_lib/spaces';
import { getSpaceTemplate, spaceTemplateInstructions, spaceTemplateSnapshot } from '@/lib/space-templates.mjs';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const spaces = await prisma.space.findMany({
      where: { userId },
      include: {
        members: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: { members: true, messages: true, files: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ spaces });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const { name, description, instructions, executionMode, agentIds, templateId } = await request.json();
    const selectedTemplate = templateId ? getSpaceTemplate(templateId) : null;
    if (templateId && !selectedTemplate) {
      return NextResponse.json({ error: '空间模板不存在或已失效' }, { status: 400 });
    }
    const title = typeof name === 'string' ? name.trim() : selectedTemplate?.defaultName || '';
    if (!title) {
      return NextResponse.json({ error: '空间名称不能为空' }, { status: 400 });
    }
    const spaceInstructions = typeof instructions === 'string'
      ? instructions.trim()
      : spaceTemplateInstructions(selectedTemplate);
    if (spaceInstructions.length > 12_000) {
      return NextResponse.json({ error: '空间规则不能超过 12000 字' }, { status: 400 });
    }
    const normalizedExecutionMode = executionMode === 'AUTO' ? 'AUTO' : 'REVIEW_DISPATCH';

    const requestedAgentIds = Array.isArray(agentIds)
      ? agentIds
      : selectedTemplate?.recommendedAgentIds || [];
    const resolvedAgents = await resolveManyAgents(requestedAgentIds, userId);
    if (resolvedAgents.length > 6) {
      return NextResponse.json({ error: '空间最多选择 6 位成员' }, { status: 400 });
    }
    const templateSnapshot = selectedTemplate
      ? spaceTemplateSnapshot(selectedTemplate, resolvedAgents.map((agent) => agent.id))
      : null;
    const space = await prisma.space.create({
      data: {
        userId,
        name: title,
        description: typeof description === 'string' ? description.trim() || null : null,
        instructions: spaceInstructions || null,
        executionMode: normalizedExecutionMode,
        hostAgentId: SPACE_COORDINATOR_ID,
        ...(selectedTemplate && templateSnapshot ? {
          templateId: selectedTemplate.id,
          templateVersion: selectedTemplate.version,
          templateSnapshot,
        } : {}),
        members: {
          create: resolvedAgents
            .map((agent, index) => ({
              agentId: agent.id,
              roleName: agent.category === '专业' ? agent.name : agent.category || null,
              sortOrder: index,
            })),
        },
      },
      include: {
        members: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    await ensureSpaceRoot(userId, space.id);
    return NextResponse.json({ space });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
