import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { isAdminEmail } from '@/app/api/_lib/admin';
import { buildWebSearchContext } from '@/lib/web-search';
import { formatKnowledgeContext, getKnowledgeHits } from '@/lib/knowledge';

const DAILY_CHAT_LIMIT = 30;
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

function getQuotaDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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
    if (webSearchEnabled && !userSettings.tavilyApiKey && !process.env.TAVILY_API_KEY) {
      return NextResponse.json(
        { error: '联网搜索未配置：请在用户中心填写 Tavily API Key，或配置平台 TAVILY_API_KEY。' },
        { status: 400 }
      );
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
    const shouldCountQuota = !usesCustomModel && !isAdminEmail(userSettings.email);
    const dailyChatLimit = userSettings.dailyChatLimit || DAILY_CHAT_LIMIT;
    const quotaCost = imageAttachments.length > 0 ? IMAGE_CHAT_COST : TEXT_CHAT_COST;

    if (shouldCountQuota) {
      const day = getQuotaDay();
      const usage = await prisma.dailyChatUsage.upsert({
        where: { userId_day: { userId, day } },
        update: {},
        create: { userId, day },
      });

      if (usage.usedCount + quotaCost > dailyChatLimit) {
        return NextResponse.json(
          {
            error: `今日免费聊天次数已用完。你可以明天再来，或在设置里开启自己的模型配置。`,
            quota: {
              limit: dailyChatLimit,
              used: usage.usedCount,
              remaining: Math.max(0, dailyChatLimit - usage.usedCount),
              cost: quotaCost,
            },
          },
          { status: 429 }
        );
      }

      await prisma.dailyChatUsage.update({
        where: { userId_day: { userId, day } },
        data: { usedCount: { increment: quotaCost } },
      });
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
          where: { id: resolvedConversationId, userId },
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
    // Use custom config if provided, otherwise fall back to platform default (Gemini via OpenAI-compatible API)
    const client = new OpenAI({
      baseURL: apiBaseUrl || 'https://api-inference.modelscope.cn/v1',
      apiKey: apiKey || process.env.apiKey,
    });

    const model = modelName || 'deepseek-ai/DeepSeek-V4-Flash';

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
          max_tokens: 4,
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
