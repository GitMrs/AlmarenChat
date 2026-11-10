import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { runStudioPiTurn, resetStudioPiSession } from '@/lib/coding-agents/pi-runtime';
import { beginStudioConversationRun } from '@/lib/coding-agents/conversation-operations';
import { randomUUID } from 'node:crypto';
import { approvalStore } from '@/lib/coding-agents/approval-store';
import { resolveUserModelConfig } from '@/app/api/_lib/agent-model';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let conversationRun: ReturnType<typeof beginStudioConversationRun> | undefined;
  let detachAbort: (() => void) | undefined;
  try {
    const userId = requireAuth(request);
    const {
      message,
      retryMessageId,
      workspaceId,
      spaceId,
      reasoningEffort,
      modelName,
      apiBaseUrl: customBaseUrl,
      apiKey: customApiKey,
      approvalMode = 'dangerous',
      agentKeys,
    } = await request.json();

    if (typeof message !== 'string' || !message.trim()) {
      return new Response(JSON.stringify({ error: '消息内容不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!['never', 'dangerous', 'always'].includes(approvalMode)) {
      return Response.json({ error: '无效的审批模式' }, { status: 400 });
    }

    // Ensure active workspace exists for this user
    let activeWorkspaceId = workspaceId || (spaceId !== 'default' ? spaceId : undefined);
    if (!activeWorkspaceId) {
      const existingWs = await prisma.studioWorkspace.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      if (existingWs) {
        activeWorkspaceId = existingWs.id;
      } else {
        const defaultWs = await prisma.studioWorkspace.create({
          data: {
            userId,
            name: '默认工作区',
            description: '系统自动初始化的默认独立工作空间',
          },
        });
        activeWorkspaceId = defaultWs.id;
      }
    }

    const currentWorkspace = await prisma.studioWorkspace.findFirst({
      where: { id: activeWorkspaceId, userId },
      select: { systemPrompt: true },
    });
    if (!currentWorkspace) {
      return Response.json({ error: '工作区不存在或无权访问' }, { status: 404 });
    }

    conversationRun = beginStudioConversationRun(userId, activeWorkspaceId);
    const run = conversationRun;
    const abortRun = () => run.controller.abort();
    request.signal?.addEventListener('abort', abortRun);
    detachAbort = () => request.signal?.removeEventListener('abort', abortRun);
    if (request.signal?.aborted) abortRun();

    // Database records are authoritative; a paginated client history cannot restore a session.
    let records = await prisma.studioMessage.findMany({
      where: { workspaceId: activeWorkspaceId, userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, role: true, content: true, createdAt: true },
    });
    const lastMessageTime = records.at(-1)?.createdAt.getTime() || 0;
    let userMessageId: string = randomUUID();
    let prompt = message.trim();
    if (retryMessageId) {
      const targetIndex = records.findIndex((item) => item.id === retryMessageId && item.role === 'assistant');
      let userIndex = targetIndex - 1;
      while (userIndex >= 0 && records[userIndex].role !== 'user') userIndex--;
      if (targetIndex < 0 || userIndex < 0 || !records[userIndex].content) {
        throw Object.assign(new Error('原回答或对应问题不存在，请刷新后重试'), { status: 404 });
      }
      const originalQuestion = records[userIndex];
      prompt = originalQuestion.content!;
      userMessageId = originalQuestion.id;
      await resetStudioPiSession(userId, activeWorkspaceId);
      await prisma.studioMessage.deleteMany({
        where: { workspaceId: activeWorkspaceId, userId, id: { in: records.slice(userIndex + 1).map((item) => item.id) } },
      });
      await prisma.studioMessage.updateMany({ where: { workspaceId: activeWorkspaceId, userId }, data: { tokens: null } });
      records = records.slice(0, userIndex);
    }
    let messageTime = Math.max(Date.now(), lastMessageTime + 1);
    if (!retryMessageId) {
      await prisma.studioMessage.create({
        data: { id: userMessageId, workspaceId: activeWorkspaceId, userId, role: 'user', content: prompt, createdAt: new Date(messageTime++) },
      });
    }
    const history = records
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content || '' }));

    // Retrieve user model settings from database
    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
        customModelEnabled: true,
        modelContextWindow: true,
      },
    });

    const modelConfig = resolveUserModelConfig(userSettings, {
      modelName, apiBaseUrl: customBaseUrl, apiKey: customApiKey,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: { type: string; data?: any }) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { abortRun(); }
        };
        let assistantMessageId: string = randomUUID();
        let assistantCreatedAt = new Date(messageTime++);
        emit({ type: 'message.ids', data: { userMessageId, assistantMessageId } });
        let accumulatedAssistantContent = '';
        const toolsMap = new Map<string, any>();
        let finalTokens: number | null = null;

        const saveAssistantSegment = (
          content: string,
          toolsArray: any[],
          tokens: number | null
        ): Promise<void> => {
          return prisma.studioMessage
            .create({
              data: {
                id: assistantMessageId,
                createdAt: assistantCreatedAt,
                workspaceId: activeWorkspaceId,
                userId,
                role: 'assistant',
                content,
                tools: toolsArray.length > 0 ? toolsArray : null,
                tokens,
              },
            })
            .then(() => undefined);
        };

        let pendingPersistence = Promise.resolve();
        let persistenceError: unknown;

        const persistAssistantMessage = async () => {
          await pendingPersistence;
          if (persistenceError) throw persistenceError;
          await saveAssistantSegment(accumulatedAssistantContent, Array.from(toolsMap.values()), finalTokens);
        };

        // 用户中途插话时，把上一段回复先落库并清空聚合器，使界面气泡与数据库记录一一对应
        const flushBeforeInjection = (data: { message: string; userMessageId: string; assistantMessageId: string }) => {
          // Capture IDs and timestamps before changing to the next segment.
          const segment = {
            id: assistantMessageId, createdAt: assistantCreatedAt,
            workspaceId: activeWorkspaceId, userId, role: 'assistant', content: accumulatedAssistantContent,
            tools: toolsMap.size ? Array.from(toolsMap.values()) : null, tokens: finalTokens,
          };
          const injectedUser = {
            id: data.userMessageId, workspaceId: activeWorkspaceId, userId, role: 'user',
            content: data.message, createdAt: new Date(messageTime++),
          };
          pendingPersistence = pendingPersistence.then(async () => {
            if (persistenceError) return;
            await prisma.studioMessage.create({ data: segment });
            await prisma.studioMessage.create({ data: injectedUser });
          }).catch((error) => { persistenceError = error; abortRun(); });
          assistantMessageId = data.assistantMessageId;
          assistantCreatedAt = new Date(messageTime++);
          accumulatedAssistantContent = '';
          toolsMap.clear();
          finalTokens = null;
        };

        const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const onAbort = () => {
          approvalStore.cancelAllByRun(runId, '客户端连接已断开');
        };
        run.controller.signal.addEventListener('abort', onAbort);

        let isStreamActive = true;
        const heartbeatTimer = setInterval(() => {
          if (!isStreamActive) return;
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            clearInterval(heartbeatTimer);
          }
        }, 10000);

        try {
          await runStudioPiTurn({
            userId,
            runId,
            approvalMode,
            workspaceId: activeWorkspaceId,
            workspaceSystemPrompt: currentWorkspace?.systemPrompt || undefined,
            message: prompt,
            history,
            reasoningEffort: reasoningEffort || 'high',
            modelName: modelConfig.modelName || undefined,
            modelContextWindow: userSettings?.modelContextWindow || 200000,
            apiBaseUrl: modelConfig.apiBaseUrl || undefined,
            apiKey: modelConfig.apiKey || undefined,
            resetSession: history.length === 0,
            signal: run.controller.signal,
            onEvent: (event) => {
              // Aggregate message deltas
              if (event.type === 'message.delta') {
                const chunk = event.data?.delta ?? event.data?.text ?? '';
                accumulatedAssistantContent += chunk;
              }
              // Aggregate tool events
              else if (event.type === 'tool.approval_requested' && event.data?.toolCallId) {
                toolsMap.set(event.data.toolCallId, {
                  id: event.data.toolCallId,
                  name: event.data.toolName,
                  preview: event.data.toolPreview,
                  status: 'waiting_approval',
                  approvalId: event.data.approvalId,
                  args: event.data.args,
                });
              } else if (event.type === 'tool.started' && event.data?.toolCallId) {
                const existing = toolsMap.get(event.data.toolCallId) || {};
                toolsMap.set(event.data.toolCallId, {
                  ...existing,
                  id: event.data.toolCallId,
                  name: event.data.toolName,
                  preview: event.data.toolPreview,
                  status: 'running',
                  sessionId: event.data.sessionId,
                  agentId: event.data.agentId,
                });
              } else if (event.type === 'tool.completed' && event.data?.toolCallId) {
                const item = toolsMap.get(event.data.toolCallId) || {
                  id: event.data.toolCallId,
                  name: event.data.toolName,
                };
                item.status = 'completed';
                item.result = event.data.result;
                if (event.data.sessionId) item.sessionId = event.data.sessionId;
                toolsMap.set(event.data.toolCallId, item);
              } else if (event.type === 'tool.failed' && event.data?.toolCallId) {
                const item = toolsMap.get(event.data.toolCallId) || {
                  id: event.data.toolCallId,
                  name: event.data.toolName,
                };
                item.status = event.data?.isDenied ? 'denied' : 'failed';
                item.result = event.data.error;
                if (event.data.sessionId) item.sessionId = event.data.sessionId;
                toolsMap.set(event.data.toolCallId, item);
              } else if (event.type === 'usage.updated' && Number.isFinite(event.data?.totalTokens)) {
                finalTokens = event.data.totalTokens;
              } else if (event.type === 'user.message_injected') {
                // 中途插话：上一段回复另存为一条消息，后续内容归入新气泡
                flushBeforeInjection(event.data);
              }

              emit(event);
            },
          });

        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          emit({ type: 'run.failed', data: { error: errMsg } });
        } finally {
          for (const tool of toolsMap.values()) {
            if (tool.status !== 'waiting_approval' && tool.status !== 'running') continue;
            const isDenied = tool.status === 'waiting_approval';
            tool.status = isDenied ? 'denied' : 'failed';
            tool.result = isDenied ? '运行已结束，本次审批已取消' : '运行已结束，工具执行未完成';
            emit({ type: 'tool.failed', data: { toolCallId: tool.id, toolName: tool.name, isDenied, error: tool.result } });
          }
          try {
            await persistAssistantMessage();
          } catch (error) {
            console.error('[Studio] Failed to persist assistant message:', error);
            emit({ type: 'run.failed', data: { error: '回复保存失败，请刷新后确认记录' } });
          } finally {
            isStreamActive = false;
            clearInterval(heartbeatTimer);
            run.controller.signal.removeEventListener('abort', onAbort);
            approvalStore.cancelAllByRun(runId);
            detachAbort?.();
            run.finish();
            try { controller.close(); } catch { /* Client already disconnected. */ }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (err: unknown) {
    detachAbort?.();
    conversationRun?.finish();
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : (err as { status?: number }).status || 500;
    return new Response(JSON.stringify({ error: errMsg }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
