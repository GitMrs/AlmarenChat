import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { runCoordinatorChat } from '@/lib/coding-agents/coordinator';
import { approvalStore } from '@/lib/coding-agents/approval-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const {
      message,
      history,
      workspaceId,
      spaceId,
      reasoningEffort,
      modelName,
      apiBaseUrl: customBaseUrl,
      apiKey: customApiKey,
      approvalMode = 'dangerous',
      agentKeys,
    } = await request.json();

    if (!message || !message.trim()) {
      return new Response(JSON.stringify({ error: '消息内容不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

    // Persist user message to StudioMessage table
    if (activeWorkspaceId) {
      await prisma.studioMessage.create({
        data: {
          workspaceId: activeWorkspaceId,
          userId,
          role: 'user',
          content: message.trim(),
        },
      }).catch((e) => console.error('[Studio] Failed to persist user message:', e));
    }

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

    // Query workspace systemPrompt (space instructions)
    const currentWorkspace = activeWorkspaceId
      ? await prisma.studioWorkspace.findUnique({
          where: { id: activeWorkspaceId },
          select: { systemPrompt: true },
        })
      : null;

    // Automatically prioritize user account's configured model, base URL, and API key
    const activeApiKey = userSettings?.apiKey || customApiKey || null;
    const activeBaseUrl = userSettings?.apiBaseUrl || customBaseUrl || null;
    const activeModel = userSettings?.modelName || modelName || null;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let accumulatedAssistantContent = '';
        const toolsMap = new Map<string, any>();
        let finalTokens: number | null = null;

        const persistAssistantMessage = async () => {
          if (!activeWorkspaceId) return;
          const toolsArray = Array.from(toolsMap.values());
          if (!accumulatedAssistantContent && toolsArray.length === 0) return;

          try {
            await prisma.studioMessage.create({
              data: {
                workspaceId: activeWorkspaceId,
                userId,
                role: 'assistant',
                content: accumulatedAssistantContent,
                tools: toolsArray.length > 0 ? toolsArray : null,
                tokens: finalTokens,
              },
            });
          } catch (persistErr) {
            console.error('[Studio] Failed to persist assistant message:', persistErr);
          }
        };

        const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const onAbort = () => {
          approvalStore.cancelAllByRun(runId, '客户端连接已断开');
        };
        request.signal?.addEventListener('abort', onAbort);

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
          await runCoordinatorChat({
            userId,
            runId,
            approvalMode,
            workspaceId: activeWorkspaceId,
            workspaceSystemPrompt: currentWorkspace?.systemPrompt || undefined,
            message: message.trim(),
            history: Array.isArray(history) ? history : [],
            reasoningEffort: reasoningEffort || 'high',
            modelName: activeModel || undefined,
            modelContextWindow: userSettings?.modelContextWindow || undefined,
            apiBaseUrl: activeBaseUrl || undefined,
            apiKey: activeApiKey || undefined,
            agentKeys,
            signal: request.signal,
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
              } else if (event.type === 'usage.updated' && event.data?.totalTokens) {
                finalTokens = event.data.totalTokens;
              }

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            },
          });

          // Save assistant message to database
          await persistAssistantMessage();
          controller.close();
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await persistAssistantMessage();
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'run.failed', data: { error: errMsg } })}\n\n`)
          );
          controller.close();
        } finally {
          isStreamActive = false;
          clearInterval(heartbeatTimer);
          request.signal?.removeEventListener('abort', onAbort);
          approvalStore.cancelAllByRun(runId);
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
    const errMsg = err instanceof Error ? err.message : String(err);
    const status = errMsg === 'Unauthorized' ? 401 : 500;
    return new Response(JSON.stringify({ error: errMsg }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
