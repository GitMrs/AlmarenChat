import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { reserveChatQuota } from '@/lib/chat-quota';
import { createModelClient, resolveModelName } from '@/lib/model-client';
import { buildAssistantActivityContext, buildAssistantPlatformContext } from '@/lib/personal-assistant/platform-context';
import { buildPersonalAssistantPrompt } from '@/lib/personal-assistant/prompt-builder';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';
import { archiveOldMainChatMessages, loadAssistantMemoryContext } from '@/lib/personal-assistant/experience-memory';
import { buildReminderExtractionPrompt, parseReminderExtraction } from '@/lib/personal-assistant/reminder-extraction.mjs';
import { classifyReminderRequest } from '@/lib/personal-assistant/reminder-intent.mjs';
import { isValidInternalQQSecret } from '@/lib/qq-assistant/credentials.mjs';
import { classifyQQCommand } from '@/lib/qq-assistant/policy.mjs';

export const runtime = 'nodejs';

function eventMessageId(kind: 'user' | 'assistant', appId: string, eventId: string) {
  const digest = createHash('sha256').update(`${appId}:${eventId}`).digest('hex');
  return `qq-${kind}-${digest}`;
}

export async function POST(request: Request) {
  try {
    if (!isValidInternalQQSecret(request.headers.get('x-qq-assistant-secret'))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const eventId = typeof body.eventId === 'string' ? body.eventId.trim().slice(0, 200) : '';
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 50000) : '';
    if (!userId || !eventId || !message) {
      return NextResponse.json({ error: 'QQ 消息参数不完整' }, { status: 400 });
    }

    const storedBinding = await prisma.assistantQQBinding.findUnique({ where: { userId } });
    if (!storedBinding?.enabled) return NextResponse.json({ error: 'QQ Bot 未启用' }, { status: 409 });

    const profile = await ensurePersonalAssistant(userId);
    const binding = storedBinding.conversationId === profile.conversationId
      ? storedBinding
      : await prisma.assistantQQBinding.update({
          where: { userId },
          data: { conversationId: profile.conversationId },
        });

    const command = classifyQQCommand(message);
    if (command.type === 'NEW_CONVERSATION') {
      return NextResponse.json({
        content: 'QQ 现在与网页主聊天保持连续，不再单独切换话题。临时聊天可以在网页端开启。',
        conversationId: binding.conversationId,
      });
    }

    const assistantMessageId = eventMessageId('assistant', binding.appId, eventId);
    const existingReply = await prisma.message.findUnique({
      where: { id: assistantMessageId },
      select: { content: true, conversationId: true, conversation: { select: { userId: true } } },
    });
    if (existingReply?.conversation.userId === userId) {
      return NextResponse.json({ content: existingReply.content, conversationId: existingReply.conversationId, replayed: true });
    }

    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        customModelEnabled: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
        dailyChatLimit: true,
        contextMessageLimit: true,
      },
    });
    if (!userSettings) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

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
      return NextResponse.json({ error: '今日免费聊天次数已用完，请稍后再来。' }, { status: 429 });
    }

    const client = createModelClient(
      usesCustomModel ? userSettings.apiBaseUrl : undefined,
      usesCustomModel ? userSettings.apiKey : undefined
    );
    const model = resolveModelName(usesCustomModel ? userSettings.modelName : undefined);
    await archiveOldMainChatMessages({
      userId,
      conversationId: binding.conversationId,
      summarize: async (prompt: string) => {
        const completion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        }, { timeout: 20_000 });
        return completion.choices[0]?.message?.content || null;
      },
    });

    const contextLimit = Math.max(8, Math.min(80, userSettings.contextMessageLimit || 40));
    const contextSources = {
      spaces: profile.includeSpaceContext,
      tasks: profile.includeTaskContext,
      chats: profile.includeChatContext,
    };
    const [memoryContext, memories, platformContext, activityContext] = await Promise.all([
      loadAssistantMemoryContext({
        userId,
        conversationId: binding.conversationId,
        query: message,
        historyLimit: contextLimit,
        includeExperiences: true,
      }),
      prisma.assistantMemoryItem.findMany({
        where: { userId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: { category: true, content: true },
      }),
      buildAssistantPlatformContext(userId, contextSources),
      buildAssistantActivityContext(userId, message, contextSources),
    ]);

    const systemPrompt = [
      buildPersonalAssistantPrompt({
        userName: userSettings.name,
        profile,
        memories,
        platformContext,
        activityContext,
        webEnabled: false,
        experienceContext: memoryContext.experienceContext,
      }),
      '【当前渠道】：你正在 QQ 私聊中回复用户。QQ 与网页共用同一个主聊天上下文；不要提供站内相对链接，回答保持适合即时消息阅读。长期记忆、任务和提醒也与网页共享。用户要求提醒时不要声称已经创建，系统会在回复末尾附加真实创建结果。',
    ].join('\n\n');
    const modelMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...memoryContext.history.filter((item) => item.role === 'user' || item.role === 'assistant').map((item) => ({
        role: item.role as 'user' | 'assistant',
        content: item.content,
      })),
      { role: 'user', content: message },
    ];

    const completion = await client.chat.completions.create({ model, messages: modelMessages });
    const modelContent = completion.choices[0]?.message?.content?.trim();
    if (!modelContent) throw new Error('模型没有返回可展示的正文');

    const userMessageId = eventMessageId('user', binding.appId, eventId);
    let reminderCandidates: Array<{ content: string; dueTime: Date | null }> = [];
    if (classifyReminderRequest(message).explicit) {
      try {
        const reminderCompletion = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: buildReminderExtractionPrompt(message) }],
          temperature: 0.1,
          max_tokens: 400,
        });
        reminderCandidates = parseReminderExtraction(reminderCompletion.choices[0]?.message?.content).slice(0, 10);
      } catch {
        reminderCandidates = [];
      }
    }
    const reminderSummary = reminderCandidates.length
      ? `\n\n已记录${reminderCandidates.length > 1 ? ` ${reminderCandidates.length} 条` : ''}提醒：${reminderCandidates.map((item) => item.content).join('、')}`
      : '';
    const content = `${modelContent}${reminderSummary}`;

    try {
      await prisma.$transaction([
        ...reminderCandidates.map((item, index) => prisma.assistantReminder.upsert({
          where: {
            userId_idempotencyKey: {
              userId,
              idempotencyKey: `qq-reminders:${userMessageId}:${index}`,
            },
          },
          update: {},
          create: {
            userId,
            content: item.content,
            dueTime: item.dueTime,
            sourceMessageId: userMessageId,
            idempotencyKey: `qq-reminders:${userMessageId}:${index}`,
            status: 'PENDING',
          },
        })),
        prisma.message.create({
          data: { id: userMessageId, conversationId: binding.conversationId, role: 'user', source: 'QQ', content: message },
        }),
        prisma.message.create({
          data: { id: assistantMessageId, conversationId: binding.conversationId, role: 'assistant', source: 'QQ', content },
        }),
        prisma.conversation.update({
          where: { id: binding.conversationId },
          data: {
            updatedAt: new Date(),
          },
        }),
      ]);
    } catch (error: any) {
      if (error.code !== 'P2002') throw error;
      const racedReply = await prisma.message.findUnique({ where: { id: assistantMessageId } });
      if (racedReply?.content) {
        return NextResponse.json({ content: racedReply.content, conversationId: binding.conversationId, replayed: true });
      }
      throw error;
    }

    return NextResponse.json({ content, conversationId: binding.conversationId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'QQ 小伴回复失败' }, { status: 500 });
  }
}
