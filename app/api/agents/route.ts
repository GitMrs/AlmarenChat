import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope');

    const agents = await prisma.agent.findMany({
      where: scope === 'mine' ? { creatorId: userId } : { isPublic: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ agents });
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
    const { name, avatar, description, category, tone, greeting, systemPrompt, isPublic, agentType } =
      await request.json();

    if (!['BASIC', 'EMPLOYEE'].includes(agentType)) {
      return NextResponse.json({ error: '不支持的 Agent 类型' }, { status: 400 });
    }

    const agent = await prisma.agent.create({
      data: {
        name,
        avatar,
        description,
        category,
        tone,
        greeting,
        systemPrompt,
        agentType,
        isPublic: isPublic ?? false,
        creatorId: userId,
      },
    });

    return NextResponse.json({ agent });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
