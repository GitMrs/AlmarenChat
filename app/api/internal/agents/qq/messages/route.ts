import { logModelTimeContext } from '@/lib/chat/model-time-log.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { reserveChatQuota } from '@/lib/chat/chat-quota';
import { createModelClient, resolveModelName } from '@/lib/core/model-client';
import { createChatWebTools, runAutoWebChat } from '@/lib/web/auto-web';
import { createAgentGrowthTools } from '@/lib/agents/growth/agent-growth';
import { loadAgentMemoryContext } from '@/lib/agents/memory/agent-memory';
import { currentTimeContext } from '@/lib/agents/memory/current-time-context.mjs';
import { compressConversationContext, estimateMessagesTokens } from '@/lib/agents/memory/context-compression';
import { conversationContextTargetTokens } from '@/lib/core/model-limits.mjs';
import { loadAgentWorldContext } from '@/lib/world/context';
import { formatKnowledgeContext, getKnowledgeHits } from '@/lib/knowledge/knowledge';
import { findCompanionAgent } from '@/lib/companion/agents';
import { isValidInternalQQSecret } from '@/lib/qq-assistant/credentials.mjs';
import { qqImageAttachments } from '@/lib/qq-assistant/policy.mjs';
import { agentChatArchiveState, archiveAgentChat } from '@/app/api/_lib/agent-personal-memory';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';
import { CONVERSATION_GROUNDING_GUIDANCE } from '@/lib/chat/conversation-grounding.mjs';
import { stripHistoryRetrievalNotices } from '@/lib/personal-assistant/retrieval-notice.mjs';
import { buildConversationContinuityGuidance } from '@/lib/chat/conversation-continuity.mjs';

export const runtime = 'nodejs';

type ChatAttachment = {
  type: 'image';
  url: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

function eventMessageId(kind: 'user' | 'assistant', scope: string, eventId: string) {
  const digest = createHash('sha256').update(`${scope}:${eventId}`).digest('hex');
  return `qq-agent-${kind}-${digest}`;
}

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
    if (!isValidInternalQQSecret(request.headers.get('x-qq-assistant-secret'))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const bindingId = typeof body.bindingId === 'string' ? body.bindingId.trim() : '';
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
    const eventId = typeof body.eventId === 'string' ? body.eventId.trim().slice(0, 200) : '';
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 50000) : '';
    const imageAttachments = qqImageAttachments(body.attachments) as ChatAttachment[];
    if (!bindingId || !userId || !agentId || !conversationId || !eventId || !message) {
      return NextResponse.json({ error: 'Agent QQ 消息参数不完整' }, { status: 400 });
    }

    const binding = await prisma.agentQQBinding.findUnique({
      where: { id: bindingId },
      include: { botAccount: true },
    });
    if (!binding || binding.userId !== userId || binding.agentId !== agentId || binding.conversationId !== conversationId) {
      return NextResponse.json({ error: 'QQ 绑定不存在或与 Agent 不匹配' }, { status: 404 });
    }
    if (!binding.enabled || !binding.botAccount.enabled) {
      return NextResponse.json({ error: 'QQ Bot 未启用' }, { status: 409 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId, kind: 'AGENT', agentId },
    });
    if (!conversation) {
      return NextResponse.json({ error: 'Agent 会话不存在' }, { status: 404 });
    }

    const appId = binding.botAccount.appId;
    const eventScope = `${binding.id}:${appId}`;
    const userMessageId = eventMessageId('user', eventScope, eventId);
    const assistantMessageId = eventMessageId('assistant', eventScope, eventId);
    const existingReply = await prisma.message.findUnique({
      where: { id: assistantMessageId },
      select: { content: true, conversationId: true, conversation: { select: { userId: true } } },
    });
    if (existingReply?.conversation.userId === userId) {
      return NextResponse.json({
        content: existingReply.content,
        conversationId: existingReply.conversationId,
        replayed: true,
      });
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
        modelContextWindow: true,
        tavilyApiKey: true,
        defaultWeatherLocation: true,
        dailyChatLimit: true,
        contextMessageLimit: true,
      },
    });
    if (!userSettings) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

    const agent = (await prisma.agent.findUnique({ where: { id: agentId } })) || findCompanionAgent(agentId);
    const agentModelSetting = await loadAgentModelSetting(userId, agentId);
    const modelConfig = resolveUserModelConfig(userSettings, agentModelSetting);
    const quota = await reserveChatQuota({
      userId,
      email: userSettings.email,
      dailyChatLimit: userSettings.dailyChatLimit,
      usesCustomModel: modelConfig.usesCustomModel,
      cost: imageAttachments.length > 0 ? 3 : 1,
    });
    if (quota && !quota.allowed) {
      return NextResponse.json({ error: '今日免费聊天次数已用完，请稍后再来。' }, { status: 429 });
    }

    const contextLimit = Math.max(
      8,
      Math.min(80, conversation.contextMessageLimit || userSettings.contextMessageLimit || 40)
    );
    const archiveState = await agentChatArchiveState(userId, agentId, conversationId);
    const persistedHistory = await prisma.message.findMany({
      where: archiveState.where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: contextLimit + 1,
    });
    const rawHistory = persistedHistory.reverse().filter(
      (item) => item.id !== assistantMessageId && item.id !== userMessageId
    );
    const normalizedHistory = rawHistory.map((item: any, index: number) => ({
      ...item,
      id: String(item.id || `history-${index}`),
      role: String(item.role || 'assistant'),
      content: item.role === 'assistant'
        ? stripHistoryRetrievalNotices(item.content)
        : String(item.content || ''),
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

    const [agentMemory, worldContext] = await Promise.all([
      loadAgentMemoryContext({ userId, agentId, query: message }),
      loadAgentWorldContext({ agentId, query: message, history: normalizedHistory }),
    ]);

    let knowledgeContext = '';
    try {
      const hits = await getKnowledgeHits({ agentId, userId }, message);
      const relevantHits = hits.filter((hit) => hit.score >= 0.35);
      if (relevantHits.length > 0) {
        knowledgeContext = formatKnowledgeContext(relevantHits, { scopeLabel: '角色专属知识库' });
      }
    } catch (error: any) {
      console.warn('[agent-qq/knowledge] Knowledge hit retrieval failed:', error?.message);
    }

    const agentName = conversation.agentName || agent?.name || 'Agent';
    const systemPrompt = [
      conversation.agentSystemPrompt || agent?.systemPrompt || '',
      `【当前 Agent】你正在以「${agentName}」的身份回复用户。`,
      agent?.description ? `【角色描述】${agent.description}` : '',
      agent?.tone ? `【表达语气】${agent.tone}` : '',
      currentTimeContext(),
      buildConversationContinuityGuidance({ message, history: normalizedHistory }),
      agentMemory,
      worldContext,
      knowledgeContext,
      CONVERSATION_GROUNDING_GUIDANCE,
      '【当前渠道】你正在 QQ 私聊中回复用户。请使用适合即时消息阅读的标准 Markdown，避免 HTML、复杂表格和站内相对链接。',
    ].filter(Boolean).join('\n\n');

    const client = createModelClient(modelConfig.apiBaseUrl, modelConfig.apiKey);
    const model = resolveModelName(modelConfig.modelName);
    let reportStatus: ((label: string) => void) | undefined;
    const web = createChatWebTools({
      apiKey: userSettings.tavilyApiKey,
      defaultWeatherLocation: userSettings.defaultWeatherLocation,
      history: sourceHistory,
      signal: request.signal,
      onStatus: (label: string) => reportStatus?.(label),
    });
    const growth = createAgentGrowthTools({ userId, agentId });

    const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }> = sourceHistory
      .filter((item: { role: string; content: string }) => item.content && item.role !== 'system')
      .map((item: { role: string; content: string }) => ({
        role: item.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: item.content,
      }));
    if (systemPrompt) openaiMessages.unshift({ role: 'system', content: systemPrompt });
    logModelTimeContext({ entry: 'qq-agent', model: model, source: 'server-clock', messages: [{ role: 'system', content: systemPrompt }] });


    if (imageAttachments.length > 0) {
      const imageContent = await Promise.all(
        imageAttachments.map(async (attachment) => ({
          type: 'image_url',
          image_url: { url: await imageAttachmentToDataUrl(attachment) },
        }))
      );
      openaiMessages.push({
        role: 'user',
        content: [{ type: 'text', text: message || '请分析这张图片。' }, ...imageContent],
      });
    } else {
      openaiMessages.push({ role: 'user', content: message });
    }

    const existingUserMessage = await prisma.message.findUnique({
      where: { id: userMessageId },
      select: { id: true },
    });
    if (!existingUserMessage) {
      await prisma.message.create({
        data: {
          id: userMessageId,
          conversationId,
          role: 'user',
          source: 'QQ',
          content: message,
          attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
        },
      }).catch((error: any) => {
        if (error?.code !== 'P2002') throw error;
      });
    }

    const finalizeResponse = async (modelContent: string) => {
      const content = String(modelContent || '').trim();
      if (!content) throw new Error('模型没有返回可展示的正文');

      try {
        await prisma.$transaction([
          prisma.message.create({
            data: {
              id: assistantMessageId,
              conversationId,
              role: 'assistant',
              source: 'QQ',
              content,
              attachments: web.attachments() as any,
            },
          }),
          prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          }),
        ]);
      } catch (error: any) {
        if (error.code !== 'P2002') throw error;
        const racedReply = await prisma.message.findUnique({ where: { id: assistantMessageId } });
        if (racedReply?.content) return racedReply.content;
        throw error;
      }

      await archiveAgentChat(userId, agentId, conversationId).catch((error: any) => {
        console.warn('[agent-qq/memory] chat archive failed', error?.message);
      });
      return content;
    };

    if (body.stream === true) {
      const encoder = new TextEncoder();
      const responseStream = new ReadableStream({
        async start(controller) {
          const emit = (event: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };
          try {
            reportStatus = (label: string) => emit({ type: 'status', label });
            const modelContent = await runAutoWebChat({
              client,
              model,
              messages: openaiMessages,
              web,
              extraTools: growth?.tools || [],
              callTool: growth?.execute,
              signal: request.signal,
              onText: (delta: string) => emit({ type: 'delta', content: delta }),
            });
            const content = await finalizeResponse(modelContent);
            emit({ type: 'done', content, conversationId });
          } catch (error: any) {
            emit({ type: 'error', error: error.message || 'Agent QQ 回复失败' });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(responseStream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    const modelContent = await runAutoWebChat({
      client,
      model,
      messages: openaiMessages,
      web,
      extraTools: growth?.tools || [],
      callTool: growth?.execute,
      signal: request.signal,
    });
    const content = await finalizeResponse(modelContent);
    return NextResponse.json({ content, conversationId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Agent QQ 回复失败' }, { status: 500 });
  }
}
