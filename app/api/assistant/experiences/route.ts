import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';
import { manualArchiveAssistantMessages } from '@/lib/personal-assistant/experience-memory';
import { estimateMessagesTokens } from '@/lib/context-compression';
import { createModelClient, resolveModelName } from '@/lib/model-client';

export const runtime = 'nodejs';

/**
 * GET /api/assistant/experiences
 * 获取小伴对话的上下文透明度统计与经历记忆列表
 */
export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const { searchParams } = new URL(request.url);
    const requestedConversationId = searchParams.get('conversationId')?.trim();

    const profile = await ensurePersonalAssistant(userId);
    const conversationId = requestedConversationId || profile.conversationId;

    const [user, conversation, unarchivedMessages, totalCount, experiences] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { contextMessageLimit: true },
      }),
      prisma.conversation.findFirst({
        where: { id: conversationId, userId, kind: 'PERSONAL_ASSISTANT' },
        select: { id: true, assistantMode: true, title: true },
      }),
      prisma.message.findMany({
        where: {
          conversationId,
          assistantExperienceId: null,
          role: { in: ['user', 'assistant'] },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, role: true, content: true, createdAt: true },
      }),
      prisma.message.count({
        where: { conversationId },
      }),
      prisma.assistantExperience.findMany({
        where: { userId, conversationId },
        orderBy: { endAt: 'desc' },
        take: 30,
        select: {
          id: true,
          summary: true,
          messageCount: true,
          startAt: true,
          endAt: true,
          createdAt: true,
        },
      }),
    ]);

    if (!conversation) {
      return NextResponse.json({ error: '小伴会话不存在' }, { status: 404 });
    }

    const contextLimit = Math.max(8, Math.min(80, user?.contextMessageLimit || 40));
    const unarchivedCount = unarchivedMessages.length;
    const archivedCount = Math.max(0, totalCount - unarchivedCount);
    const estimatedTokens = estimateMessagesTokens(unarchivedMessages);

    return NextResponse.json({
      conversationId,
      conversationMode: conversation.assistantMode || (conversation.id === profile.conversationId ? 'MAIN' : 'TEMPORARY'),
      unarchivedCount,
      archivedCount,
      totalCount,
      contextLimit,
      estimatedTokens,
      experiencesCount: experiences.length,
      experiences: experiences.map((exp) => ({
        id: exp.id,
        summary: exp.summary,
        messageCount: exp.messageCount,
        startAt: exp.startAt.toISOString(),
        endAt: exp.endAt.toISOString(),
        createdAt: exp.createdAt.toISOString(),
      })),
      canArchive: unarchivedCount > 4,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/assistant/experiences
 * 手动将较早的活跃对话沉淀为经历记忆（深度归档压缩）
 */
export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const profile = await ensurePersonalAssistant(userId);
    const conversationId = (typeof body.conversationId === 'string' && body.conversationId.trim())
      ? body.conversationId.trim()
      : profile.conversationId;

    const preserveRecent = typeof body.preserveRecent === 'number'
      ? Math.max(2, Math.min(20, Math.floor(body.preserveRecent)))
      : 4;

    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        customModelEnabled: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
      },
    });

    const usesCustomModel = Boolean(
      userSettings?.customModelEnabled && userSettings.apiBaseUrl && userSettings.apiKey && userSettings.modelName
    );
    const client = createModelClient(
      usesCustomModel ? userSettings?.apiBaseUrl : undefined,
      usesCustomModel ? userSettings?.apiKey : undefined
    );
    const model = resolveModelName(usesCustomModel ? userSettings?.modelName : undefined);

    const result = await manualArchiveAssistantMessages({
      userId,
      conversationId,
      preserveRecent,
      summarize: async (prompt: string) => {
        try {
          const completion = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
          }, { timeout: 25_000 });
          return completion.choices[0]?.message?.content || null;
        } catch {
          return null;
        }
      },
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
