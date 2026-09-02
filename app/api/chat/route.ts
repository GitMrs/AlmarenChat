import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { buildWebSearchContext } from '@/lib/web-search';
import { formatKnowledgeContext, getKnowledgeHits } from '@/lib/knowledge';
import { createModelClient, resolveModelName } from '@/lib/model-client';
import { reserveChatQuota } from '@/lib/chat-quota';

const TEXT_CHAT_COST = 1;
const IMAGE_CHAT_COST = 3;

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
      webSearchEnabled,
      knowledgeEnabled,
    } = await request.json();
    const imageAttachments: ChatAttachment[] = Array.isArray(attachments)
      ? attachments.filter((attachment: ChatAttachment) => attachment?.type === 'image' && attachment.url)
      : [];
    const textMessage = typeof message === 'string' ? message : '';

    const userId = requireAuth(request);
    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        contextMessageLimit: true,
        customModelEnabled: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
        tavilyApiKey: true,
        dailyChatLimit: true,
      },
    });
    if (!userSettings) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (webSearchEnabled && !textMessage.trim()) {
      return NextResponse.json({ error: '联网搜索需要输入文本问题。' }, { status: 400 });
    }
    const usesCustomModel = Boolean(
      userSettings.customModelEnabled &&
        userSettings.apiBaseUrl &&
        userSettings.apiKey &&
        userSettings.modelName &&
        apiBaseUrl &&
        apiKey &&
        modelName
    );
    const quotaCost = imageAttachments.length > 0 ? IMAGE_CHAT_COST : TEXT_CHAT_COST;

    const quota = await reserveChatQuota({
      userId,
      email: userSettings.email,
      dailyChatLimit: userSettings.dailyChatLimit,
      usesCustomModel,
      cost: quotaCost,
    });
    if (quota && !quota.allowed) {
      return NextResponse.json(
        { error: '今日免费聊天次数已用完。你可以明天再来，或在设置里开启自己的模型配置。', quota },
        { status: 429 }
      );
    }

    const requestedContextLimit =
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

    const conversationSettings = resolvedConversationId
      ? await prisma.conversation.findFirst({
          where: { id: resolvedConversationId, userId, kind: 'AGENT' },
          select: { contextMessageLimit: true },
        })
      : null;
    if (resolvedConversationId && !conversationSettings) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const contextLimit = requestedContextLimit || conversationSettings?.contextMessageLimit || userSettings?.contextMessageLimit || 40;

    const persistedHistory =
      resolvedConversationId
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
    const client = createModelClient(apiBaseUrl, apiKey);
    const model = resolveModelName(modelName);

    let finalContext = context;
    if (knowledgeEnabled && agentId && textMessage.trim()) {
      const hits = await getKnowledgeHits(agentId, textMessage);
      if (hits.length > 0) {
        const checkChunks = hits.map((hit) => hit.content.slice(0, 250)).join('\n---\n');
        const check = await client.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: '严格判断：这些片段能切实回答用户问题吗？不确定就答“不能”。只回“能”或“不能”。',
            },
            { role: 'user', content: `问题: ${textMessage}\n\n片段:\n${checkChunks}` },
          ],
          stream: false,
        });
        const verdict = check.choices[0]?.message?.content || '';
        if (verdict.includes('能') && !verdict.includes('不能')) {
          finalContext = [finalContext, formatKnowledgeContext(hits)].filter(Boolean).join('\n\n');
        }
      }
    }
    if (webSearchEnabled) {
      const webSearchContext = await buildWebSearchContext(textMessage, userSettings.tavilyApiKey);
      finalContext = [finalContext, webSearchContext].filter(Boolean).join('\n\n');
    }

    if (finalContext) openaiMessages.unshift({ role: 'system', content: finalContext });

    const lastMessage = openaiMessages[openaiMessages.length - 1];
    const textAlreadyInMessages = imageAttachments.length === 0 && lastMessage?.role === 'user' && lastMessage.content === textMessage;
    if (!textAlreadyInMessages) {
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
    if (resolvedConversationId && !skipPersistUserMessage) {
      await prisma.message.create({
        data: {
          conversationId: resolvedConversationId,
          role: 'user',
          content: textMessage,
          attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
        },
      });
    }
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
        if (resolvedConversationId && fullContent) {
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
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
