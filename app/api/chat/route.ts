import { createScopedConnectorBroker } from '@/app/api/_lib/personal-connectors';
import { prepareConversationContext, recordConversationUsage } from '@/lib/memory/conversation-context';
import { createMemoryTools } from '@/lib/memory/memory-tools';
import { logModelTimeContext } from '@/lib/chat/model-time-log.mjs';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { findCompanionAgent } from '@/lib/companion/agents';
import { getBuiltInAgents } from '@/lib/agents/data/agents-data';
import { companionReplyInstruction, createCompanionReplyParser } from '@/lib/companion/reply-protocol.mjs';
import { createChatWebTools, runAutoWebChat } from '@/lib/web/auto-web';
import { createCapabilityHelpTool } from '@/lib/capabilities/help.mjs';
import { createAgentGrowthTools } from '@/lib/agents/growth/agent-growth';
import { formatKnowledgeContext, getKnowledgeHits } from '@/lib/knowledge/knowledge';
import { createModelClient, resolveModelName } from '@/lib/core/model-client';
import { reserveChatQuota } from '@/lib/chat/chat-quota';
import { withMessageReasoning } from '@/lib/chat/reasoning.mjs';
import { stripHistoryRetrievalNotices, stripLeadingHistoryTimestampMetadata } from '@/lib/personal-assistant/retrieval-notice.mjs';
import { loadAgentMemoryContext } from '@/lib/agents/memory/agent-memory';
import { currentTimeContext } from '@/lib/agents/memory/current-time-context.mjs';
import { archiveAgentChat } from '@/app/api/_lib/agent-personal-memory';
import { loadAgentWorldContext } from '@/lib/world/context';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';
import { CONVERSATION_GROUNDING_GUIDANCE } from '@/lib/chat/conversation-grounding.mjs';
import { buildRecentStateContinuityGuidance } from '@/lib/chat/conversation-continuity.mjs';
import { buildAgentIdentitySystem, buildAgentRuntimeSystem } from '@/lib/chat/agent-prompt.mjs';
import { applyRecentStateMessage, syncRecentStates } from '@/lib/chat/recent-state-store';
import { dispatchContextCandidates, planContextSources } from '@/lib/memory/context-dispatcher.mjs';

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
          select: { contextMessageLimit: true, agentId: true, agentMode: true, agentName: true, agentTone: true, agentDescription: true, agentSystemPrompt: true },
        })
      : null;
    if (conversationId && !conversationSettings) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    // Built-in profiles follow the current catalog, even for existing conversations.
    const builtInAgent = (await getBuiltInAgents()).find(
      (agent) => agent.id === (conversationSettings?.agentId || agentId)
    );
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
      const agent = builtInAgent || (await prisma.agent.findUnique({ where: { id: agentId } })) || findCompanionAgent(agentId);
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
          select: { contextMessageLimit: true, agentId: true, agentMode: true, agentName: true, agentTone: true, agentDescription: true, agentSystemPrompt: true },
        });
    }
    if (resolvedConversationId && !conversationSettings) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const contextLimit = requestedContextLimit || conversationSettings?.contextMessageLimit || userSettings?.contextMessageLimit || 40;
    const companionReply = companionMode === true && Boolean(findCompanionAgent(conversationSettings?.agentId || agentId));
    const persistedHistory =
      resolvedConversationId
        ? await prisma.message.findMany({
            where: { conversationId: resolvedConversationId, role: { in: ['user', 'assistant'] } },
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
    const sourceHistory = normalizedHistory;

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
    const contextPlan = planContextSources(textMessage);
    const [employeeMemory, worldContext] = await Promise.all([
      usesAgentMemory && contextPlan.memory ? loadAgentMemoryContext({ userId, agentId: memoryAgentId, query: textMessage, conversationId: resolvedConversationId || undefined, recentMessageIds: normalizedHistory.map(item => item.id) }) : Promise.resolve(''),
      contextPlan.world ? loadAgentWorldContext({ agentId: conversationSettings?.agentId || agentId, query: textMessage, history: normalizedHistory }) : Promise.resolve(''),
    ]);
    let recentStates: any[] = [];
    if (resolvedConversationId) {
      try { recentStates = await syncRecentStates({ conversationId: resolvedConversationId, history: normalizedHistory }); }
      catch (error: any) { console.warn('[recent-state] sync failed:', error?.message); }
    }
    const continuityGuidance = buildRecentStateContinuityGuidance({ message: textMessage, history: normalizedHistory, states: recentStates });
    const identitySystem = buildAgentIdentitySystem({
      name: conversationSettings?.agentName || builtInAgent?.name || agentSnapshot?.name || 'Agent',
      systemPrompt: conversationSettings?.agentSystemPrompt || builtInAgent?.systemPrompt || agentSnapshot?.systemPrompt || context || '',
      description: conversationSettings?.agentDescription || builtInAgent?.description || agentSnapshot?.description || '',
      tone: conversationSettings?.agentTone || builtInAgent?.tone || agentSnapshot?.tone || '',
    });
    const runtimeSystem = buildAgentRuntimeSystem({
      timeContext: currentTimeContext(),
      continuityGuidance,
      groundingGuidance: CONVERSATION_GROUNDING_GUIDANCE,
    });
    const optionalContext = [{ name: '相关记忆与历史原文', content: employeeMemory }, { name: '世界事件', content: worldContext }];
    if (knowledgeEnabled && agentId && contextPlan.knowledge) {
      try {
        const hits = await getKnowledgeHits({ agentId, userId }, textMessage);
        // 过滤出具备足够语义相关度的优质切片（余弦相似度 >= 0.35）
        const relevantHits = hits.filter((hit) => hit.score >= 0.35);
        if (relevantHits.length > 0) {
          optionalContext.push({ name: '角色知识库', content: formatKnowledgeContext(relevantHits, { scopeLabel: '角色专属知识库' }) });
        }
      } catch (err: any) {
        console.warn('[chat/knowledge] Knowledge hit retrieval failed:', err?.message);
      }
    }
    const dispatchedContext = dispatchContextCandidates(textMessage, optionalContext);

    const companionRuntime = companionReply ? [runtimeSystem, companionReplyInstruction].filter(Boolean).join('\n\n') : runtimeSystem;
    if (identitySystem) openaiMessages.unshift({ role: 'system', content: identitySystem });
    if (companionRuntime) openaiMessages.splice(identitySystem ? 1 : 0, 0, { role: 'system', content: companionRuntime });

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

    const preparedContext = resolvedConversationId ? await prepareConversationContext({
      userId, conversationId: resolvedConversationId, maxMessages: contextLimit,
      excludeMessageIds: skipPersistUserMessage && normalizedHistory.at(-1)?.role === 'user' ? [normalizedHistory.at(-1).id] : [],
      requiredSystem: identitySystem, runtimeSystem: companionRuntime, optional: dispatchedContext, currentMessage: openaiMessages.at(-1),
      modelName: model, modelContextWindow: userSettings.modelContextWindow,
      summarize: async prompt => {
        const response = await client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1 }, { timeout: 20_000, maxRetries: 0 });
        return response.choices[0]?.message?.content || null;
      },
    }) : null;
    if (preparedContext) openaiMessages.splice(0, openaiMessages.length, ...preparedContext.messages);

    logModelTimeContext({ entry: 'agent-chat', model: model, source: 'server-clock', messages: [{ role: 'system', content: identitySystem }, { role: 'system', content: companionRuntime }] });

    // Save user message
    if (resolvedConversationId && !skipPersistUserMessage) {
      const persistedUserMessage = await prisma.message.create({
        data: {
          conversationId: resolvedConversationId,
          role: 'user',
          content: textMessage,
          attachments: imageAttachments.length > 0 ? imageAttachments : undefined,
        },
      });
      await applyRecentStateMessage({ conversationId: resolvedConversationId, message: persistedUserMessage }).catch((error: any) => {
        console.warn('[recent-state] apply failed:', error?.message);
      });
    }
    let fullContent = '';
    let fullReasoning = '';
    const connectorBroker = memoryAgentId ? await createScopedConnectorBroker(userId, 'agent', memoryAgentId) : null;
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    const readable = new ReadableStream({
      async start(controller) {
        const emit = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        const web = createChatWebTools({ apiKey: userSettings.tavilyApiKey, defaultWeatherLocation: userSettings.defaultWeatherLocation, history: sourceHistory, query: textMessage, capabilityEntry: usesAgentMemory ? 'agent' : 'assistant', signal: abortController.signal, onStatus: (label: string) => emit({ type: 'status', label }) });
        const growth = usesAgentMemory && memoryAgentId
          ? createAgentGrowthTools({ userId, agentId: memoryAgentId })
          : null;
        const memoryTools = usesAgentMemory && memoryAgentId && resolvedConversationId
          ? createMemoryTools({ userId, kind: 'agent', agentId: memoryAgentId, conversationId: resolvedConversationId }, (preparedContext?.history || normalizedHistory).map(item => item.id)) : null;
        const capabilityHelp = createCapabilityHelpTool({ entry: usesAgentMemory ? 'agent' : 'assistant', query: textMessage,
          loadableCapabilities: web.loadableCapabilities,
          getAvailableToolNames: () => [...web.tools, ...(growth?.tools || []), ...(memoryTools?.tools || []), ...(connectorBroker?.modelTools() || [])].map(tool => tool.function.name) });
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
            contextBudget: preparedContext?.manifest.hardInputBudget,
            onContextUsage: preparedContext ? usage => recordConversationUsage(userId, resolvedConversationId, preparedContext.manifest, usage) : undefined,
            extraTools: [...(growth?.tools || []), ...(memoryTools?.tools || []), capabilityHelp.tool],
            getExtraTools: () => [...(growth?.tools || []), ...(memoryTools?.tools || []), capabilityHelp.tool, ...(connectorBroker?.modelTools() || [])],
            callTool: (name, args) => name.startsWith('mcp_') ? connectorBroker?.call(name, args) : name === 'capability_help'
              ? capabilityHelp.execute(args)
              : name === 'memory_search' || name === 'memory_read' ? memoryTools?.execute(name, args) : growth?.execute(name, args),
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
