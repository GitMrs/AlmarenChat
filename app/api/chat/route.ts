import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { findCompanionAgent } from '@/lib/companion/agents';
import { companionReplyInstruction, createCompanionReplyParser } from '@/lib/companion/reply-protocol.mjs';
import { createChatWebTools, runAutoWebChat } from '@/lib/web/auto-web';
import { createAgentGrowthTools } from '@/lib/agents/growth/agent-growth';
import { formatKnowledgeContext, getKnowledgeHits } from '@/lib/knowledge/knowledge';
import { createModelClient, resolveModelName } from '@/lib/core/model-client';
import { reserveChatQuota } from '@/lib/chat/chat-quota';
import { withMessageReasoning } from '@/lib/chat/reasoning.mjs';
import { stripHistoryRetrievalNotices, stripLeadingHistoryTimestampMetadata } from '@/lib/personal-assistant/retrieval-notice.mjs';
import { loadAgentMemoryContext } from '@/lib/agents/memory/agent-memory';
import { currentTimeContext } from '@/lib/agents/memory/current-time-context.mjs';
import { agentChatArchiveState, archiveAgentChat } from '@/app/api/_lib/agent-personal-memory';
import { compressConversationContext, estimateMessagesTokens } from '@/lib/agents/memory/context-compression';
import { conversationContextTargetTokens } from '@/lib/core/model-limits.mjs';
import { loadAgentWorldContext } from '@/lib/world/context';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';
import { CONVERSATION_GROUNDING_GUIDANCE } from '@/lib/chat/conversation-grounding.mjs';
import { buildConversationContinuityGuidance } from '@/lib/chat/conversation-continuity.mjs';

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
      conversationId,
      agentId,
      agentSnapshot,
      contextMessageLimit,
      skipPersistUserMessage,
      attachments,
      knowledgeEnabled,
      companionMode,
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
        modelContextWindow: true,
        tavilyApiKey: true,
        defaultWeatherLocation: true,
        dailyChatLimit: true,
      },
    });
    if (!userSettings) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let conversationSettings = conversationId
      ? await prisma.conversation.findFirst({
          where: { id: conversationId, userId, kind: 'AGENT' },
          select: { contextMessageLimit: true, agentId: true, agentMode: true },
        })
      : null;
    if (conversationId && !conversationSettings) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const agentModelSetting = await loadAgentModelSetting(userId, conversationSettings?.agentId || agentId);
    const modelConfig = resolveUserModelConfig(userSettings, agentModelSetting);
    const quota = await reserveChatQuota({
      userId,
      email: userSettings.email,
      dailyChatLimit: userSettings.dailyChatLimit,
      usesCustomModel: modelConfig.usesCustomModel,
      cost: imageAttachments.length > 0 ? IMAGE_CHAT_COST : TEXT_CHAT_COST,
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
      const agent = (await prisma.agent.findUnique({ where: { id: agentId } })) || findCompanionAgent(agentId);
      const snapshot = agent || agentSnapshot || {};
      const existingMain = await prisma.conversation.findFirst({
        where: { userId, agentId, kind: 'AGENT', agentMode: 'MAIN' },
        orderBy: { createdAt: 'asc' },
      });
      const conversation = existingMain || await prisma.conversation.create({
        data: {
          userId,
          agentId,
          agentMode: 'MAIN',
          agentName: snapshot.name || null,
          agentAvatar: snapshot.avatar || null,
          agentCategory: snapshot.category || null,
          agentTone: snapshot.tone || null,
          agentDescription: snapshot.description || null,
          agentSystemPrompt: snapshot.systemPrompt || context || null,
          agentVoice: snapshot.voice || null,
          contextMessageLimit: requestedContextLimit,
          title: textMessage.slice(0, 50) || (imageAttachments.length > 0 ? '图片会话' : '新会话'),
        },
      }).catch(async (error: any) => {
        if (error?.code !== 'P2002') throw error;
        return prisma.conversation.findFirstOrThrow({ where: { userId, agentId, kind: 'AGENT', agentMode: 'MAIN' } });
      });
      resolvedConversationId = conversation.id;
    }

    if (!conversationSettings && resolvedConversationId) {
      conversationSettings = await prisma.conversation.findFirst({
          where: { id: resolvedConversationId, userId, kind: 'AGENT' },
          select: { contextMessageLimit: true, agentId: true, agentMode: true },
        });
    }
    if (resolvedConversationId && !conversationSettings) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const contextLimit = requestedContextLimit || conversationSettings?.contextMessageLimit || userSettings?.contextMessageLimit || 40;
    const companionReply = companionMode === true && Boolean(findCompanionAgent(conversationSettings?.agentId || agentId));
    const archiveState = resolvedConversationId && conversationSettings?.agentMode === 'MAIN' && conversationSettings.agentId
      ? await agentChatArchiveState(userId, conversationSettings.agentId, resolvedConversationId) : null;

    const persistedHistory =
      resolvedConversationId
        ? await prisma.message.findMany({
            where: archiveState?.where || { conversationId: resolvedConversationId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: contextLimit,
          })
        : [];

    const fallbackHistory = Array.isArray(history) ? history : [];
    const rawHistory = resolvedConversationId ? persistedHistory.reverse() : fallbackHistory.slice(-contextLimit);
    const normalizedHistory = rawHistory.map((msg: any, index: number) => ({
      ...msg,
      id: String(msg.id || `history-${index}`),
      role: String(msg.role || 'assistant'),
      content: msg.role === 'assistant'
        ? stripLeadingHistoryTimestampMetadata(stripHistoryRetrievalNotices(msg.content))
        : String(msg.content || ''),
    }));
    const historyTargetTokens = conversationContextTargetTokens(
      modelConfig.modelName,
      userSettings.modelContextWindow
    );
    const sourceHistory = estimateMessagesTokens(normalizedHistory) > historyTargetTokens
      ? compressConversationContext(normalizedHistory, {
          maxMessages: contextLimit,
          targetTokens: historyTargetTokens,
          preserveRecent: Math.max(1, Math.floor(contextLimit * 0.4)),
          aggressiveAfter: Math.floor(contextLimit * 1.5),
          preserveSystem: false,
        }).compressedMessages
      : normalizedHistory;

    const openaiMessages: { role: 'system' | 'user' | 'assistant'; content: any }[] = sourceHistory
      .filter((msg: { role: string; content: string }) => msg.content && msg.role !== 'system')
      .map((msg: { role: string; content: string }) => ({
        role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));
    const client = createModelClient(modelConfig.apiBaseUrl, modelConfig.apiKey);
    const model = resolveModelName(modelConfig.modelName);

    const memoryAgentId = conversationSettings?.agentId || agentId;
    const usesAgentMemory = conversationSettings?.agentMode === 'MAIN';
    const [employeeMemory, worldContext] = await Promise.all([
      usesAgentMemory ? loadAgentMemoryContext({ userId, agentId: memoryAgentId, query: textMessage }) : Promise.resolve(''),
      loadAgentWorldContext({ agentId: conversationSettings?.agentId || agentId, query: textMessage, history: normalizedHistory }),
    ]);
    const continuityGuidance = buildConversationContinuityGuidance({ message: textMessage, history: normalizedHistory });
    let finalContext = [currentTimeContext(), continuityGuidance, context, employeeMemory, worldContext, CONVERSATION_GROUNDING_GUIDANCE].filter(Boolean).join('\n\n');
    if (knowledgeEnabled && agentId && textMessage.trim()) {
      try {
        const hits = await getKnowledgeHits({ agentId, userId }, textMessage);
        // 过滤出具备足够语义相关度的优质切片（余弦相似度 >= 0.35）
        const relevantHits = hits.filter((hit) => hit.score >= 0.35);
        if (relevantHits.length > 0) {
          finalContext = [finalContext, formatKnowledgeContext(relevantHits, { scopeLabel: '角色专属知识库' })].filter(Boolean).join('\n\n');
        }
      } catch (err: any) {
        console.warn('[chat/knowledge] Knowledge hit retrieval failed:', err?.message);
      }
    }

    if (companionReply) finalContext = [finalContext, companionReplyInstruction].filter(Boolean).join('\n\n');
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
    let fullContent = '';
    let fullReasoning = '';
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    const readable = new ReadableStream({
      async start(controller) {
        const emit = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        const web = createChatWebTools({ apiKey: userSettings.tavilyApiKey, defaultWeatherLocation: userSettings.defaultWeatherLocation, history: sourceHistory, signal: abortController.signal, onStatus: (label: string) => emit({ type: 'status', label }) });
        const growth = usesAgentMemory && memoryAgentId
          ? createAgentGrowthTools({ userId, agentId: memoryAgentId })
          : null;
        try {
          const parser = companionReply ? createCompanionReplyParser() : null;
          const emitText = (text: string) => {
            fullContent += text;
            if (text) emit({ type: 'text_delta', text });
          };
          await runAutoWebChat({
            client,
            model,
            messages: openaiMessages,
            web,
            extraTools: growth?.tools || [],
            callTool: growth?.execute,
            signal: abortController.signal,
            onText: (text: string) => emitText(parser ? parser.push(text) : text),
            onReasoning: (text: string) => {
              fullReasoning += text;
              emit({ type: 'reasoning_delta', text });
            },
          });
          if (parser) emitText(parser.finish());
          if (!fullContent.trim()) throw new Error('模型没有返回正文');

          // Persist assistant message after stream completes
          if (resolvedConversationId && fullContent) {
            await prisma.message.create({
              data: { conversationId: resolvedConversationId, role: 'assistant', content: fullContent, attachments: withMessageReasoning(web.attachments(), fullReasoning) as any },
            });
            await prisma.conversation.update({
              where: { id: resolvedConversationId },
              data: { updatedAt: new Date() },
            });
          }
          if (parser) emit({ type: 'companion_cue', emotion: parser.emotion });
          if (usesAgentMemory && resolvedConversationId && memoryAgentId) {
            await archiveAgentChat(userId, memoryAgentId, resolvedConversationId).catch(error => console.warn('[agent-memory] chat archive failed', error.message));
          }
          controller.close();
        } catch (error) {
          if (!abortController.signal.aborted) {
            emit({ type: 'error', error: error instanceof Error ? error.message : '回复失败' });
            controller.close();
          }
        }
      },
      cancel() { abortController.abort(); },
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'x-chat-stream-format': 'ndjson', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' };
    if (resolvedConversationId) headers['x-conversation-id'] = resolvedConversationId;

    return new Response(readable, { headers });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
