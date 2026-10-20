import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { requireAgentMemoryAccess } from '@/app/api/_lib/agent-personal-memory';

export async function PATCH(request: Request, { params }: { params: Promise<{ agentId: string; experienceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId, experienceId } = await params;
    await requireAgentMemoryAccess(userId, agentId);
    const body = await request.json();
    const summary = body.summary === undefined ? undefined : typeof body.summary === 'string' ? body.summary.trim() : '';
    if (summary !== undefined && (!summary || summary.length > 2_000)) return NextResponse.json({ error: '经历内容需为 1～2000 字' }, { status: 400 });
    if (body.status !== undefined && !['ACTIVE', 'DISABLED', 'DELETED'].includes(body.status)) return NextResponse.json({ error: '无效的经历状态' }, { status: 400 });
    const result = await prisma.agentExperience.updateMany({ where: { id: experienceId, userId, agentId, status: { not: 'DELETED' } }, data: { ...(summary !== undefined ? { summary, edited: true } : {}), ...(body.status ? { status: body.status } : {}) } });
    if (!result.count) return NextResponse.json({ error: '经历不存在' }, { status: 404 });
    return NextResponse.json({ experience: await prisma.agentExperience.findFirst({ where: { id: experienceId, userId, agentId } }) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : error.message === 'Agent not found' ? 404 : 500 });
  }
}
