import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { manualAgentMemoryRule, synchronizeAgentMemory } from '@/lib/agent-memory-service';

const ACTIONS = new Set(['approve', 'ignore', 'update', 'enable', 'disable']);

async function isEmployeeAgent(agentId: string) {
  return Boolean(await prisma.agent.findFirst({
    where: { id: agentId, agentType: 'EMPLOYEE' },
    select: { id: true },
  }));
}

async function responseFor(userId: string, agentId: string) {
  const [rules, experiences] = await Promise.all([
    prisma.agentMemoryRule.findMany({
      where: { userId, agentId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.agentExperience.findMany({
      where: { userId, agentId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
  ]);
  return { rules, experiences };
}

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!(await isEmployeeAgent(agentId))) {
      return NextResponse.json({ error: '普通 Agent 没有成长档案' }, { status: 404 });
    }
    await synchronizeAgentMemory(userId, agentId);
    return NextResponse.json(await responseFor(userId, agentId));
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!(await isEmployeeAgent(agentId))) {
      return NextResponse.json({ error: '普通 Agent 不支持员工记忆' }, { status: 400 });
    }
    const rule = manualAgentMemoryRule(await request.json());
    await prisma.agentMemoryRule.upsert({
      where: { userId_agentId_key: { userId, agentId, key: rule.key } },
      update: { ...rule, status: 'ACTIVE' },
      create: { id: randomUUID(), userId, agentId, ...rule, status: 'ACTIVE', sourceIds: [] },
    });
    return NextResponse.json(await responseFor(userId, agentId));
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!(await isEmployeeAgent(agentId))) {
      return NextResponse.json({ error: '普通 Agent 不支持员工记忆' }, { status: 400 });
    }
    const body = await request.json();
    const action = String(body.action || '');
    const id = String(body.id || '');
    if (!ACTIONS.has(action) || !id) return NextResponse.json({ error: '不支持的成长操作' }, { status: 400 });
    const existing = await prisma.agentMemoryRule.findFirst({ where: { id, userId, agentId } });
    if (!existing) return NextResponse.json({ error: '员工经验不存在' }, { status: 404 });
    const editable = ['approve', 'update'].includes(action)
      ? manualAgentMemoryRule({
          category: body.category || existing.category,
          title: body.title || existing.title,
          instruction: body.instruction || existing.instruction,
        })
      : null;
    const status = action === 'approve' || action === 'enable'
      ? 'ACTIVE'
      : action === 'ignore'
        ? 'IGNORED'
        : action === 'disable'
          ? 'DISABLED'
          : existing.status;
    await prisma.agentMemoryRule.update({
      where: { id },
      data: { ...(editable || {}), status },
    });
    return NextResponse.json(await responseFor(userId, agentId));
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!(await isEmployeeAgent(agentId))) {
      return NextResponse.json({ error: '普通 Agent 不支持员工记忆' }, { status: 400 });
    }
    const id = new URL(request.url).searchParams.get('id') || '';
    const result = await prisma.agentMemoryRule.deleteMany({ where: { id, userId, agentId } });
    if (result.count !== 1) return NextResponse.json({ error: '员工经验不存在' }, { status: 404 });
    return NextResponse.json(await responseFor(userId, agentId));
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
