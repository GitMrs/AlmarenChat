import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { reserveChatQuota } from '@/lib/chat-quota';
import { createModelClient, resolveModelName } from '@/lib/model-client';
import { buildWebSearchContext } from '@/lib/web-search';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';
import { buildPersonalAssistantPrompt } from '@/lib/personal-assistant/prompt-builder';
import { buildAssistantActivityContext, buildAssistantPlatformContext } from '@/lib/personal-assistant/platform-context';
import { archiveOldMainChatMessages, loadAssistantMemoryContext } from '@/lib/personal-assistant/experience-memory';
import { buildTimedAssistantHistory } from '@/lib/personal-assistant/history-context.mjs';
import { compressConversationContext } from '@/lib/context-compression';
import { conversationContextTargetTokens } from '@/lib/model-limits.mjs';

export const runtime = 'nodejs';

type AssistantImageAttachment = {
  type: 'image';
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

const MAX_ASSISTANT_IMAGES = 4;

function normalizeImageAttachments(value: unknown): AssistantImageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const attachment = item as Record<string, unknown>;
    const url = typeof attachment.url === 'string' ? attachment.url.trim() : '';
    if (!url.startsWith('/uploads/images/')) return [];
    const candidateMimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim().toLowerCase() : '';
    const mimeType = /^image\/(?:jpeg|png|webp|gif)$/.test(candidateMimeType) ? candidateMimeType : undefined;
    const name = typeof attachment.name === 'string' ? attachment.name.trim().slice(0, 255) : undefined;
    const size = Number(attachment.size);
    return [{
      type: 'image' as const,
      url,
      ...(mimeType ? { mimeType } : {}),
      ...(name ? { name } : {}),
      ...(Number.isFinite(size) && size > 0 ? { size } : {}),
    }];
  }).slice(0, MAX_ASSISTANT_IMAGES);
}

async function imageAttachmentToDataUrl(attachment: AssistantImageAttachment) {
  const fileName = path.basename(attachment.url);
  const filePath = path.join(process.cwd(), 'public', 'uploads', 'images', fileName);
  const bytes = await readFile(filePath);
  const mimeType = attachment.mimeType || 'image/png';
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

function clientMessageId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    const operation = typeof body.operation === 'string' ? body.operation : 'online';
    const userMessageId = clientMessageId(body.userMessageId) || randomUUID();
    const assistantMessageId = clientMessageId(body.assistantMessageId) || randomUUID();

    if (operation === 'persist-local') {
      const content = typeof body.content === 'string' ? body.content.trim().slice(0, 50000) : '';
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
      if (!content) return NextResponse.json({ error: '回复内容不能为空' }, { status: 400 });
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, userId, kind: 'PERSONAL_ASSISTANT' },
        select: { id: true },
      });
      if (!conversation) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
      const message = await prisma.$transaction(async (tx) => {
        const updated = await tx.message.updateMany({
          where: { id: assistantMessageId, conversationId: conversation.id, role: 'assistant' },
          data: { content },
        });
        const saved = updated.count
          ? await tx.message.findUniqueOrThrow({ where: { id: assistantMessageId } })
          : await tx.message.create({
            data: { id: assistantMessageId, conversationId: conversation.id, role: 'assistant', source: 'WEB', content },
          });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        });
        return saved;
      });
      return NextResponse.json({ message });
    }

    const localMode = operation === 'prepare-local';
    const textMessage = typeof body.message === 'string' ? body.message.trim().slice(0, 50000) : '';
    const imageAttachments = normalizeImageAttachments(body.attachments);
    const messageForModel = textMessage || (imageAttachments.length ? '请分析这张图片。' : '');
    const webSearchEnabled = body.webSearchEnabled === true;
    if (!messageForModel) return NextResponse.json({ error: '请输入消息' }, { status: 400 });
    if (localMode && webSearchEnabled) {
      return NextResponse.json({ error: '浏览器直连 Ollama 时不能使用服务端联网搜索' }, { status: 400 });
    }

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
          modelContextWindow: true,
          tavilyApiKey: true,
          dailyChatLimit: true,
          contextMessageLimit: true,
        },
      }),
    ]);
    if (!userSettings) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const requestedConversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
    const targetConversation = await prisma.conversation.findFirst({
      where: {
        id: requestedConversationId || profile.conversationId,
        userId,
        kind: 'PERSONAL_ASSISTANT',
      },
      select: { id: true, assistantMode: true },
    });
    if (!targetConversation) return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    const conversationId = targetConversation.id;
    const conversationMode = conversationId === profile.conversationId ? 'MAIN' : 'TEMPORARY';

    const usesCustomModel = Boolean(
      userSettings.customModelEnabled && userSettings.apiBaseUrl && userSettings.apiKey && userSettings.modelName
    );
    const client = createModelClient(
      usesCustomModel ? userSettings.apiBaseUrl : undefined,
      usesCustomModel ? userSettings.apiKey : undefined
    );
    const model = resolveModelName(usesCustomModel ? userSettings.modelName : undefined);
    const quota = localMode ? null : await reserveChatQuota({
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

    if (conversationMode === 'MAIN') {
      await archiveOldMainChatMessages({
        userId,
        conversationId,
        ...(!localMode ? {
          summarize: async (prompt: string) => {
            const completion = await client.chat.completions.create({
              model,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1,
            }, { timeout: 20_000 });
            return completion.choices[0]?.message?.content || null;
          },
        } : {}),
      });
    }

    const contextLimit = Math.max(8, Math.min(80, userSettings.contextMessageLimit || 40));
    const contextSources = {
      spaces: profile.includeSpaceContext,
      tasks: profile.includeTaskContext,
      chats: profile.includeChatContext,
    };
    const [memoryContext, memories, platformContext, activityContext, webContext] = await Promise.all([
      loadAssistantMemoryContext({
        userId,
        conversationId,
        query: messageForModel,
        historyLimit: contextLimit,
        includeExperiences: conversationMode === 'MAIN',
      }),
      prisma.assistantMemoryItem.findMany({
        where: { userId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: { category: true, content: true },
      }),
      buildAssistantPlatformContext(userId, contextSources),
      buildAssistantActivityContext(userId, textMessage, contextSources),
      webSearchEnabled ? buildWebSearchContext(messageForModel, userSettings.tavilyApiKey) : Promise.resolve(null),
    ]);

    const systemPrompt = buildPersonalAssistantPrompt({
      userName: userSettings.name,
      profile,
      memories,
      platformContext,
      activityContext,
      webEnabled: webSearchEnabled,
      experienceContext: memoryContext.experienceContext,
    });
    const compressedHistory = compressConversationContext(
      buildTimedAssistantHistory(memoryContext.history),
      {
        maxMessages: contextLimit,
        targetTokens: conversationContextTargetTokens(
          usesCustomModel ? userSettings.modelName : '',
          userSettings.modelContextWindow
        ),
        preserveRecent: Math.max(1, Math.floor(contextLimit * 0.4)),
        aggressiveAfter: Math.floor(contextLimit * 1.5),
        preserveSystem: false,
      }
    ).compressedMessages;
    const userContent = imageAttachments.length
      ? [
          { type: 'text' as const, text: messageForModel },
          ...await Promise.all(imageAttachments.map(async (attachment) => ({
            type: 'image_url' as const,
            image_url: { url: await imageAttachmentToDataUrl(attachment) },
          }))),
        ]
      : messageForModel;
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }> = [
      {
        role: 'system',
        content: [
          systemPrompt,
          conversationMode === 'TEMPORARY' ? '【会话模式】：这是临时聊天，不将本轮内容视为长期经历。' : '',
          webContext ? `本轮联网结果：\n${webContext}` : '',
        ].filter(Boolean).join('\n\n'),
      },
      ...compressedHistory.map((item) => ({
        role: item.role as 'user' | 'assistant',
        content: item.content,
      })),
      { role: 'user', content: userContent },
    ];

    await prisma.message.create({
      data: {
        id: userMessageId,
        conversationId,
        role: 'user',
        source: 'WEB',
        content: messageForModel,
        attachments: imageAttachments.length ? imageAttachments : undefined,
      },
    });

    if (memoryContext.history.length === 0) {
      const generatedTitle = textMessage.slice(0, 24).replace(/[\r\n]+/g, ' ').trim();
      if (generatedTitle) {
        if (conversationMode === 'TEMPORARY') {
          prisma.conversation.update({ where: { id: conversationId }, data: { title: generatedTitle } }).catch(() => {});
        }
      }
    }

    if (localMode) {
      return NextResponse.json({ messages, conversationId, conversationMode });
    }

    const encoder = new TextEncoder();
    const modelAbortController = new AbortController();
    const readable = new ReadableStream({
      async start(controller) {
        let fullContent = '';
        const persistAssistantMessage = async () => {
          if (!fullContent.trim()) return;
          await prisma.$transaction(async (tx) => {
            const updated = await tx.message.updateMany({
              where: { id: assistantMessageId, conversationId, role: 'assistant' },
              data: { content: fullContent },
            });
            if (!updated.count) {
              await tx.message.create({
                data: { id: assistantMessageId, conversationId, role: 'assistant', source: 'WEB', content: fullContent },
              });
            }
            await tx.conversation.update({
              where: { id: conversationId },
              data: { updatedAt: new Date() },
            });
          });
        };
        try {
          for (let attempt = 0; attempt < 2 && !fullContent; attempt += 1) {
            const stream = await client.chat.completions.create(
              { model, messages, stream: true },
              { signal: modelAbortController.signal }
            );
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
          await persistAssistantMessage();
          controller.close();
        } catch (error: any) {
          if (fullContent.trim()) {
            fullContent = `${fullContent.trimEnd()}\n\n_回复已中止_`;
            await persistAssistantMessage().catch(() => {});
          }
          controller.error(error);
        }
      },
      cancel() {
        modelAbortController.abort();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'x-conversation-id': conversationId,
        'x-conversation-mode': conversationMode,
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
    const body = await request.json().catch(() => ({}));
    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
    const requestedConversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: requestedConversationId || profile.conversationId,
        userId,
        kind: 'PERSONAL_ASSISTANT',
      },
      select: { id: true },
    });
    if (!conversation) return NextResponse.json({ error: '会话不存在' }, { status: 404 });

    if (messageId) {
      const target = await prisma.message.findFirst({
        where: { id: messageId, conversationId: conversation.id },
        select: { id: true, assistantExperienceId: true },
      });
      if (target) {
        await prisma.$transaction(async (tx) => {
          if (target.assistantExperienceId) {
            await tx.message.updateMany({
              where: { assistantExperienceId: target.assistantExperienceId },
              data: { assistantExperienceId: null },
            });
            await tx.assistantExperience.deleteMany({ where: { id: target.assistantExperienceId } });
          }
          await tx.message.delete({ where: { id: target.id } });
        });
      }
    } else {
      await prisma.$transaction([
        prisma.message.deleteMany({ where: { conversationId: conversation.id } }),
        prisma.assistantExperience.deleteMany({ where: { conversationId: conversation.id } }),
      ]);
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
