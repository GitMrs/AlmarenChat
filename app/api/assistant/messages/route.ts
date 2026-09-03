import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { reserveChatQuota } from '@/lib/chat-quota';
import { createModelClient, resolveModelName } from '@/lib/model-client';
import { buildWebSearchContext } from '@/lib/web-search';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';
import { buildPersonalAssistantPrompt } from '@/lib/personal-assistant/prompt-builder';
import { buildAssistantActivityContext, buildAssistantPlatformContext, resolveSharedPageContext } from '@/lib/personal-assistant/platform-context';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    const textMessage = typeof body.message === 'string' ? body.message.trim().slice(0, 50000) : '';
    const webSearchEnabled = body.webSearchEnabled === true;
    const sharePage = body.sharePage === true;
    if (!textMessage) return NextResponse.json({ error: '请输入消息' }, { status: 400 });

    const [profile, userSettings] = await Promise.all([
      ensurePersonalAssistant(userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          email: true,
          customModelEnabled: true,
          apiBaseUrl: true,
          apiKey: true,
          modelName: true,
          tavilyApiKey: true,
          dailyChatLimit: true,
          contextMessageLimit: true,
        },
      }),
    ]);
    if (!userSettings) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const usesCustomModel = Boolean(
      userSettings.customModelEnabled && userSettings.apiBaseUrl && userSettings.apiKey && userSettings.modelName
    );
    const quota = await reserveChatQuota({
      userId,
      email: userSettings.email,
      dailyChatLimit: userSettings.dailyChatLimit,
      usesCustomModel,
    });
    if (quota && !quota.allowed) {
      return NextResponse.json(
        { error: '今日免费聊天次数已用完。你可以明天再来，或在设置里开启自己的模型配置。', quota },
        { status: 429 }
      );
    }

    const contextLimit = Math.max(8, Math.min(80, userSettings.contextMessageLimit || 40));
    const [history, memories, platformContext, activityContext, pageContext, webContext] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: profile.conversationId },
        orderBy: { createdAt: 'desc' },
        take: contextLimit,
        select: { role: true, content: true },
      }),
      prisma.assistantMemoryItem.findMany({
        where: { userId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: { category: true, content: true },
      }),
      buildAssistantPlatformContext(userId),
      buildAssistantActivityContext(userId, textMessage),
      sharePage ? resolveSharedPageContext(userId, body.pageContext) : Promise.resolve(null),
      webSearchEnabled ? buildWebSearchContext(textMessage, userSettings.tavilyApiKey) : Promise.resolve(null),
    ]);

    const systemPrompt = buildPersonalAssistantPrompt({
      userName: userSettings.name,
      profile,
      memories,
      platformContext,
      activityContext,
      pageContext,
      webEnabled: webSearchEnabled,
    });
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: [systemPrompt, webContext ? `本轮联网结果：\n${webContext}` : ''].filter(Boolean).join('\n\n') },
      ...history.reverse().filter((item) => item.role === 'user' || item.role === 'assistant').map((item) => ({
        role: item.role as 'user' | 'assistant',
        content: item.content,
      })),
      { role: 'user', content: textMessage },
    ];

    await prisma.message.create({
      data: { conversationId: profile.conversationId, role: 'user', content: textMessage },
    });

    if (history.length === 0) {
      const generatedTitle = textMessage.slice(0, 24).replace(/[\r\n]+/g, ' ').trim();
      if (generatedTitle) {
        prisma.conversation.update({
          where: { id: profile.conversationId },
          data: { title: generatedTitle },
        }).catch(() => {});
      }
    }

    const client = createModelClient(
      usesCustomModel ? userSettings.apiBaseUrl : undefined,
      usesCustomModel ? userSettings.apiKey : undefined
    );
    const model = resolveModelName(usesCustomModel ? userSettings.modelName : undefined);
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        let fullContent = '';
        try {
          for (let attempt = 0; attempt < 2 && !fullContent; attempt += 1) {
            const stream = await client.chat.completions.create({ model, messages, stream: true });
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                fullContent += content;
                controller.enqueue(encoder.encode(content));
              }
            }
          }
          if (!fullContent) {
            fullContent = '这次模型没有返回可展示的正文，请再发一次，我会接着当前对话继续。';
            controller.enqueue(encoder.encode(fullContent));
          }
          await prisma.$transaction([
            prisma.message.create({
              data: { conversationId: profile.conversationId, role: 'assistant', content: fullContent },
            }),
            prisma.conversation.update({ where: { id: profile.conversationId }, data: { updatedAt: new Date() } }),
          ]);
          controller.close();
        } catch (error: any) {
          controller.error(error);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'x-conversation-id': profile.conversationId,
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = requireAuth(request);
    const profile = await ensurePersonalAssistant(userId);

    await prisma.message.deleteMany({
      where: { conversationId: profile.conversationId },
    });

    await prisma.conversation.update({
      where: { id: profile.conversationId },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
