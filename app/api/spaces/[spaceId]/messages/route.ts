import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import {
  SPACE_COORDINATOR,
  formatMembersContext,
  getSpaceForUser,
  resolveAgent,
  resolveManyAgents,
  resolveMentionTarget,
} from '@/app/api/_lib/spaces';

const MESSAGE_PAGE_SIZE = 40;

async function userModelSettings(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      customModelEnabled: true,
      apiBaseUrl: true,
      apiKey: true,
      modelName: true,
      contextMessageLimit: true,
    },
  });
  if (!user) throw new Error('Unauthorized');
  return {
    apiBaseUrl: user.customModelEnabled ? user.apiBaseUrl : null,
    apiKey: user.customModelEnabled ? user.apiKey : null,
    modelName: user.customModelEnabled ? user.modelName : null,
    contextMessageLimit: user.contextMessageLimit || 40,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before');
    const limit = Math.min(parseInt(searchParams.get('limit') || String(MESSAGE_PAGE_SIZE), 10), 100);
    const rows = await prisma.spaceMessage.findMany({
      where: {
        spaceId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const messages = rows.reverse();
    return NextResponse.json({ messages, hasMore: rows.length === limit });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const { message, targetAgentId, history } = await request.json();
    const textMessage = typeof message === 'string' ? message.trim() : '';
    if (!textMessage) return NextResponse.json({ error: '消息不能为空' }, { status: 400 });

    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    const memberAgents = await resolveManyAgents(space.members.map((member) => member.agentId), userId);
    const allAgents = [SPACE_COORDINATOR, ...memberAgents];

    const explicitTarget = targetAgentId ? await resolveAgent(String(targetAgentId), userId) : null;
    const mentionedTarget = resolveMentionTarget(textMessage, memberAgents);
    const coordinatorMention = resolveMentionTarget(textMessage, [SPACE_COORDINATOR]);
    const fallbackTarget = SPACE_COORDINATOR;
    const targetAgent =
      (explicitTarget && allAgents.some((agent) => agent.id === explicitTarget.id) ? explicitTarget : null) ||
      mentionedTarget ||
      coordinatorMention ||
      fallbackTarget;

    await prisma.spaceMessage.create({
      data: { spaceId, role: 'user', content: textMessage },
    });

    const settings = await userModelSettings(userId);
    const persistedHistory = await prisma.spaceMessage.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(80, settings.contextMessageLimit)),
    });
    const fallbackHistory = Array.isArray(history) ? history : [];
    const sourceHistory = persistedHistory.length > 0 ? persistedHistory.reverse() : fallbackHistory.slice(-settings.contextMessageLimit);

    const systemPrompt = [
      targetAgent.systemPrompt || targetAgent.description || `你是 ${targetAgent.name}。`,
      formatMembersContext(allAgents, targetAgent),
      space.description ? `当前空间说明：${space.description}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const openaiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: systemPrompt },
      ...sourceHistory
        .filter((msg: { role: string; content: string }) => msg.content && msg.role !== 'system')
        .map((msg: { role: string; content: string; speakerAgentId?: string | null }) => ({
          role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
          content:
            msg.role === 'assistant' && msg.speakerAgentId
              ? `[${allAgents.find((agent) => agent.id === msg.speakerAgentId)?.name || 'Agent'}] ${msg.content}`
              : msg.content,
        })),
    ];
    const lastMessage = openaiMessages[openaiMessages.length - 1];
    if (lastMessage?.role !== 'user' || lastMessage.content !== textMessage) {
      openaiMessages.push({ role: 'user', content: textMessage });
    }

    const client = new OpenAI({
      baseURL: settings.apiBaseUrl || 'https://api-inference.modelscope.cn/v1',
      apiKey: settings.apiKey || process.env.apiKey,
    });
    const model = settings.modelName || 'deepseek-ai/DeepSeek-V4-Flash';
    const stream = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      stream: true,
    });

    let fullContent = '';
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            fullContent += text;
            controller.enqueue(encoder.encode(text));
          }
        }
        controller.close();

        if (fullContent) {
          await prisma.spaceMessage.create({
            data: {
              spaceId,
              role: 'assistant',
              speakerAgentId: targetAgent.id,
              content: fullContent,
            },
          });
          await prisma.space.update({ where: { id: spaceId }, data: { updatedAt: new Date() } });
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'x-speaker-agent-id': targetAgent.id,
        'x-speaker-agent-name': encodeURIComponent(targetAgent.name),
      },
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
