import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { adminErrorResponse, requireAdmin } from '@/app/api/_lib/admin';

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      userCount,
      agentCount,
      conversationCount,
      todayUserCount,
      todayConversationCount,
      recentUsers,
      recentAgents,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.agent.count(),
      prisma.conversation.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.conversation.count({ where: { createdAt: { gte: today } } }),
      prisma.user.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          customModelEnabled: true,
          dailyChatLimit: true,
          _count: { select: { agents: true, conversations: true } },
        },
      }),
      prisma.agent.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: { select: { id: true, email: true, name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      admin,
      stats: {
        userCount,
        agentCount,
        conversationCount,
        todayUserCount,
        todayConversationCount,
      },
      recentUsers,
      recentAgents,
    });
  } catch (error) {
    const result = adminErrorResponse(error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
}
