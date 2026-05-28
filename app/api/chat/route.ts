import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/app/api/_lib/db';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';

export async function POST(request: Request) {
  try {
    const { message, history, context, apiBaseUrl, apiKey, modelName, conversationId, agentId, agentSnapshot } =
      await request.json();

    const userId = getUserIdFromRequest(request);
    const userSettings = userId
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: { contextMessageLimit: true },
        })
      : null;
    const contextLimit = Math.max(1, Math.min(80, userSettings?.contextMessageLimit || 40));

    // Resolve or create conversation for persistence
    let resolvedConversationId: string | null = conversationId || null;

    if (userId && !resolvedConversationId && agentId) {
      const agent = await prisma.agent.findUnique({ where: { id: agentId } });
      const snapshot = agent || agentSnapshot || {};
      const conversation = await prisma.conversation.create({
        data: {
          userId,
          agentId,
          agentName: snapshot.name || null,
          agentAvatar: snapshot.avatar || null,
          agentCategory: snapshot.category || null,
          agentTone: snapshot.tone || null,
          agentDescription: snapshot.description || null,
          agentSystemPrompt: snapshot.systemPrompt || context || null,
          title: message.slice(0, 50),
        },
      });
      resolvedConversationId = conversation.id;
    }

    const persistedHistory =
      userId && resolvedConversationId
        ? await prisma.message.findMany({
            where: { conversationId: resolvedConversationId },
            orderBy: { createdAt: 'asc' },
            take: contextLimit,
          })
        : [];

    const fallbackHistory = Array.isArray(history) ? history : [];
    const sourceHistory = persistedHistory.length > 0 ? persistedHistory : fallbackHistory;

    const openaiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = sourceHistory
      .filter((msg: { role: string; content: string }) => msg.content && msg.role !== 'system')
      .map((msg: { role: string; content: string }) => ({
        role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));
    if (context) openaiMessages.unshift({ role: 'system', content: context });
    openaiMessages.push({ role: 'user', content: message });

    // Save user message
    if (userId && resolvedConversationId) {
      await prisma.message.create({
        data: { conversationId: resolvedConversationId, role: 'user', content: message },
      });
    }
    // Use custom config if provided, otherwise fall back to platform default (Gemini via OpenAI-compatible API)
    const client = new OpenAI({
      baseURL: apiBaseUrl || 'https://api-inference.modelscope.cn/v1',
      apiKey: apiKey || process.env.apiKey,
    });

    const model = modelName || 'deepseek-ai/DeepSeek-V4-Flash';
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

        // Persist assistant message after stream completes
        if (userId && resolvedConversationId && fullContent) {
          await prisma.message.create({
            data: { conversationId: resolvedConversationId, role: 'assistant', content: fullContent },
          });
          await prisma.conversation.update({
            where: { id: resolvedConversationId },
            data: { updatedAt: new Date() },
          });
        }
      },
    });

    const headers: Record<string, string> = { 'Content-Type': 'text/plain; charset=utf-8' };
    if (resolvedConversationId) headers['x-conversation-id'] = resolvedConversationId;

    return new Response(readable, { headers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
