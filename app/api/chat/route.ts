import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import prisma from '@/app/api/_lib/db';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';

type ChatAttachment = {
  type: 'image';
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

async function imageAttachmentToDataUrl(attachment: ChatAttachment) {
  if (!attachment.url.startsWith('/uploads/images/')) return attachment.url;

  const fileName = path.basename(attachment.url);
  const filePath = path.join(process.cwd(), 'public', 'uploads', 'images', fileName);
  const bytes = await readFile(filePath);
  const mimeType = attachment.mimeType || 'image/png';
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export async function POST(request: Request) {
  try {
    const {
      message,
      history,
      context,
      apiBaseUrl,
      apiKey,
      modelName,
      conversationId,
      agentId,
      agentSnapshot,
      contextMessageLimit,
      skipPersistUserMessage,
      attachments,
    } = await request.json();
    const imageAttachments: ChatAttachment[] = Array.isArray(attachments)
      ? attachments.filter((attachment: ChatAttachment) => attachment?.type === 'image' && attachment.url)
      : [];
    const textMessage = typeof message === 'string' ? message : '';

    const userId = getUserIdFromRequest(request);
    const userSettings = userId
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: { contextMessageLimit: true },
        })
      : null;
    const requestedContextLimit =
      userId &&
      contextMessageLimit !== undefined && Number.isFinite(Number(contextMessageLimit))
        ? Math.max(1, Math.min(80, Math.round(Number(contextMessageLimit))))
        : null;

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
          contextMessageLimit: requestedContextLimit,
          title: textMessage.slice(0, 50) || (imageAttachments.length > 0 ? '图片会话' : '新会话'),
        },
      });
      resolvedConversationId = conversation.id;
    }

    const conversationSettings =
      userId && resolvedConversationId
        ? await prisma.conversation.findFirst({
            where: { id: resolvedConversationId, userId },
            select: { contextMessageLimit: true },
          })
        : null;
    const contextLimit = requestedContextLimit || conversationSettings?.contextMessageLimit || userSettings?.contextMessageLimit || 40;

    const persistedHistory =
      userId && resolvedConversationId
        ? await prisma.message.findMany({
            where: { conversationId: resolvedConversationId },
            orderBy: { createdAt: 'desc' },
            take: contextLimit,
          })
        : [];

    const fallbackHistory = Array.isArray(history) ? history : [];
    const sourceHistory = persistedHistory.length > 0 ? persistedHistory.reverse() : fallbackHistory.slice(-contextLimit);

    const openaiMessages: { role: 'system' | 'user' | 'assistant'; content: any }[] = sourceHistory
      .filter((msg: { role: string; content: string }) => msg.content && msg.role !== 'system')
      .map((msg: { role: string; content: string }) => ({
        role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));
    if (context) openaiMessages.unshift({ role: 'system', content: context });

    const lastMessage = openaiMessages[openaiMessages.length - 1];
    if (!(skipPersistUserMessage && imageAttachments.length === 0 && lastMessage?.role === 'user' && lastMessage.content === textMessage)) {
      if (imageAttachments.length > 0) {
        const imageContent = await Promise.all(
          imageAttachments.map(async (attachment) => ({
            type: 'image_url',
            image_url: { url: await imageAttachmentToDataUrl(attachment) },
          }))
        );
        openaiMessages.push({
          role: 'user',
          content: [{ type: 'text', text: textMessage || '请分析这张图片。' }, ...imageContent],
        });
      } else {
        openaiMessages.push({ role: 'user', content: textMessage });
      }
    }

    // Save user message
    if (userId && resolvedConversationId && !skipPersistUserMessage) {
      await prisma.message.create({
        data: {
          conversationId: resolvedConversationId,
          role: 'user',
          content: textMessage,
          attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
        },
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
