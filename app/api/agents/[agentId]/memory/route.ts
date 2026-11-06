import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { manualAgentMemoryRule, synchronizeAgentMemory, validateAgentMemoryRuleScope } from '@/lib/agents/memory/agent-memory-service';

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
      where: { userId, agentId, status: { not: 'DELETED' } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.agentExperience.findMany({
      where: { userId, agentId, status: { not: 'DELETED' } },
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
    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, agentType: true } });
    if (!agent) return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 });
    if (agent.agentType === 'EMPLOYEE') await synchronizeAgentMemory(userId, agentId);
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
    await prisma.$transaction(async tx => {
      await validateAgentMemoryRuleScope(tx, userId, agentId, rule);
      const duplicate = await tx.agentMemoryRule.findFirst({ where: {
        userId, agentId, category: rule.category, instruction: rule.instruction,
        scope: rule.scope, spaceId: rule.spaceId, taskId: rule.taskId, status: 'ACTIVE',
      } });
      if (duplicate) return;
      const id = randomUUID();
      await tx.agentMemoryRule.create({ data: { ...rule, id, userId, agentId, key: `${rule.key}:${id}`, status: 'ACTIVE', sourceIds: [] } });
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
    await prisma.$transaction(async tx => {
      const existing = await tx.agentMemoryRule.findFirst({ where: { id, userId, agentId, status: { not: 'DELETED' } } });
      if (!existing) throw new Error('员工经验不存在');
      const allowed = { approve: ['PENDING'], ignore: ['PENDING'], update: ['ACTIVE', 'DISABLED'], enable: ['DISABLED'], disable: ['ACTIVE'] };
      if (!allowed[action].includes(existing.status)) throw new Error('当前规则状态不支持此操作，请刷新后重试');
      const editable = ['approve', 'update'].includes(action) ? manualAgentMemoryRule({
        category: body.category ?? existing.category, title: body.title ?? existing.title,
        instruction: body.instruction ?? existing.instruction,
        scope: body.scope ?? existing.scope, spaceId: body.spaceId ?? existing.spaceId, taskId: body.taskId ?? existing.taskId,
      }) : null;
      if (editable) await validateAgentMemoryRuleScope(tx, userId, agentId, editable);
      const status = action === 'approve' || action === 'enable' ? 'ACTIVE' : action === 'ignore' ? 'IGNORED' : action === 'disable' ? 'DISABLED' : existing.status;
      const changed = editable && ['category', 'title', 'instruction', 'scope', 'spaceId', 'taskId'].some(field => (editable[field] ?? null) !== (existing[field] ?? null));
      let data;
      if (action === 'update' && changed) {
        const replacementId = randomUUID();
        await tx.agentMemoryRule.create({ data: {
          ...editable, id: replacementId, userId, agentId, key: `${editable.key}:${replacementId}`, status,
          evidenceCount: existing.evidenceCount, sourceIds: Array.isArray(existing.sourceIds) ? existing.sourceIds.map(String) : [],
        } });
        data = { status: 'SUPERSEDED', supersededById: replacementId };
      } else {
        data = { ...(editable || {}), key: existing.key, status };
      }
      const updated = await tx.agentMemoryRule.updateMany({
        where: { id, userId, agentId, status: existing.status, updatedAt: existing.updatedAt }, data,
      });
      if (updated.count !== 1) throw new Error('规则已更新，请刷新后重试');
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
    const result = await prisma.agentMemoryRule.updateMany({ where: { id, userId, agentId, status: { not: 'DELETED' } }, data: { status: 'DELETED' } });
    if (result.count !== 1) return NextResponse.json({ error: '员工经验不存在' }, { status: 404 });
    return NextResponse.json(await responseFor(userId, agentId));
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
