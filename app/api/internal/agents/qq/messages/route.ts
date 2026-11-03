import { prepareConversationContext, recordConversationUsage } from '@/lib/memory/conversation-context';
import { createMemoryTools } from '@/lib/memory/memory-tools';
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
import { loadAgentWorldContext } from '@/lib/world/context';
import { formatKnowledgeContext, getKnowledgeHits } from '@/lib/knowledge/knowledge';
import { findCompanionAgent } from '@/lib/companion/agents';
import { isValidInternalQQSecret } from '@/lib/qq-assistant/credentials.mjs';
import { qqImageAttachments } from '@/lib/qq-assistant/policy.mjs';
import { archiveAgentChat } from '@/app/api/_lib/agent-personal-memory';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';
import { CONVERSATION_GROUNDING_GUIDANCE } from '@/lib/chat/conversation-grounding.mjs';
import { stripHistoryRetrievalNotices } from '@/lib/personal-assistant/retrieval-notice.mjs';
import { buildRecentStateContinuityGuidance } from '@/lib/chat/conversation-continuity.mjs';
import { buildAgentIdentitySystem, buildAgentRuntimeSystem } from '@/lib/chat/agent-prompt.mjs';
import { getBuiltInAgents } from '@/lib/agents/data/agents-data';
import { applyRecentStateMessage, syncRecentStates } from '@/lib/chat/recent-state-store';
import { dispatchContextCandidates, planContextSources } from '@/lib/memory/context-dispatcher.mjs';

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

    const builtInAgent = (await getBuiltInAgents()).find((item) => item.id === agentId);
    const agent = builtInAgent || (await prisma.agent.findUnique({ where: { id: agentId } })) || findCompanionAgent(agentId);
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
      1,
      Math.min(80, conversation.contextMessageLimit || userSettings.contextMessageLimit || 40)
    );
    const persistedHistory = await prisma.message.findMany({
      where: { conversationId, role: { in: ['user', 'assistant'] } },
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
    const sourceHistory = normalizedHistory;

    const contextPlan = planContextSources(message);
    const [agentMemory, worldContext] = await Promise.all([
      contextPlan.memory ? loadAgentMemoryContext({ userId, agentId, query: message, conversationId, recentMessageIds: normalizedHistory.map(item => item.id) }) : Promise.resolve(''),
      contextPlan.world ? loadAgentWorldContext({ agentId, query: message, history: normalizedHistory }) : Promise.resolve(''),
    ]);

    let knowledgeContext = '';
    if (contextPlan.knowledge) try {
      const hits = await getKnowledgeHits({ agentId, userId }, message);
      const relevantHits = hits.filter((hit) => hit.score >= 0.35);
      if (relevantHits.length > 0) {
        knowledgeContext = formatKnowledgeContext(relevantHits, { scopeLabel: '角色专属知识库' });
      }
    } catch (error: any) {
      console.warn('[agent-qq/knowledge] Knowledge hit retrieval failed:', error?.message);
    }

    const agentName = builtInAgent?.name || conversation.agentName || agent?.name || 'Agent';
    let recentStates: any[] = [];
    try { recentStates = await syncRecentStates({ conversationId, history: normalizedHistory }); }
    catch (error: any) { console.warn('[recent-state] sync failed:', error?.message); }
    const identitySystem = buildAgentIdentitySystem(builtInAgent || {
      name: agentName,
      systemPrompt: conversation.agentSystemPrompt || agent?.systemPrompt || '',
      description: conversation.agentDescription || agent?.description || '',
      tone: conversation.agentTone || agent?.tone || '',
    });
    const runtimeSystem = buildAgentRuntimeSystem({
      channel: 'QQ',
      timeContext: currentTimeContext(),
      continuityGuidance: buildRecentStateContinuityGuidance({ message, history: normalizedHistory, states: recentStates }),
      groundingGuidance: CONVERSATION_GROUNDING_GUIDANCE,
    });

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
    if (identitySystem) openaiMessages.unshift({ role: 'system', content: identitySystem });
    if (runtimeSystem) openaiMessages.splice(identitySystem ? 1 : 0, 0, { role: 'system', content: runtimeSystem });
    logModelTimeContext({ entry: 'qq-agent', model: model, source: 'server-clock', messages: [{ role: 'system', content: identitySystem }, { role: 'system', content: runtimeSystem }] });


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

    const preparedContext = await prepareConversationContext({
      userId, conversationId, maxMessages: contextLimit, requiredSystem: identitySystem, runtimeSystem,
      optional: dispatchContextCandidates(message, [{ name: '相关记忆与历史原文', content: agentMemory }, { name: '世界事件', content: worldContext }, { name: '知识库', content: knowledgeContext }]),
      currentMessage: openaiMessages.at(-1), excludeMessageIds: [userMessageId, assistantMessageId],
      modelName: model, modelContextWindow: userSettings.modelContextWindow,
      summarize: async prompt => {
        const response = await client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1 }, { timeout: 20_000, maxRetries: 0 });
        return response.choices[0]?.message?.content || null;
      },
    });
    openaiMessages.splice(0, openaiMessages.length, ...preparedContext.messages);
    const memoryTools = createMemoryTools({ userId, kind: 'agent', agentId, conversationId }, preparedContext.history.map(item => item.id));

    const existingUserMessage = await prisma.message.findUnique({
      where: { id: userMessageId },
      select: { id: true },
    });
    if (!existingUserMessage) {
      const persistedUserMessage = await prisma.message.create({
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
      if (persistedUserMessage) {
        await applyRecentStateMessage({ conversationId, message: persistedUserMessage }).catch((error: any) => {
          console.warn('[recent-state] apply failed:', error?.message);
        });
      }
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
              contextBudget: preparedContext.manifest.hardInputBudget,
              onContextUsage: usage => recordConversationUsage(userId, conversationId, preparedContext.manifest, usage),
              extraTools: [...(growth?.tools || []), ...memoryTools.tools],
              callTool: (name, args) => name === 'memory_search' || name === 'memory_read' ? memoryTools.execute(name, args) : growth?.execute(name, args),
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
      contextBudget: preparedContext.manifest.hardInputBudget,
      onContextUsage: usage => recordConversationUsage(userId, conversationId, preparedContext.manifest, usage),
      extraTools: [...(growth?.tools || []), ...memoryTools.tools],
      callTool: (name, args) => name === 'memory_search' || name === 'memory_read' ? memoryTools.execute(name, args) : growth?.execute(name, args),
      signal: request.signal,
    });
    const content = await finalizeResponse(modelContent);
    return NextResponse.json({ content, conversationId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Agent QQ 回复失败' }, { status: 500 });
  }
}
