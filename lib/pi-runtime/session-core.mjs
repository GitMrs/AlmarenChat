import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { mkdir } from 'node:fs/promises';
import { modelTokenLimits } from '../model-limits.mjs';

const PROVIDER_ID = 'almaren';
const activeSessions = globalThis.__almarenPiActiveSessions || new Map();
const sessionQueues = globalThis.__almarenPiSpaceQueues || new Map();
globalThis.__almarenPiActiveSessions = activeSessions;
globalThis.__almarenPiSpaceQueues = sessionQueues;

function numberOrZero(value) {
  return Number.isFinite(value) && value > 0 ? Number(value) : 0;
}

function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.ceil(chineseChars / 1.5 + (text.length - chineseChars) / 4);
}

function createExecutionState(startedAt = Date.now()) {
  return {
    startedAt,
    modelRequestCount: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    activities: [],
    notes: [],
  };
}

function finishExecution(state, status) {
  const completedAt = Date.now();
  return {
    type: 'pi_execution',
    status,
    startedAt: new Date(state.startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: Math.max(0, completedAt - state.startedAt),
    modelRequestCount: state.modelRequestCount,
    toolCallCount: state.activities.length,
    tokens: state.tokens,
    notes: state.notes,
    activities: state.activities.map((activity) => activity.status === 'running'
      ? { ...activity, status: status === 'cancelled' ? 'cancelled' : 'failed', completedAt: new Date(completedAt).toISOString() }
      : activity),
  };
}

export function visiblePiAssistantText(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  if (message.content.some((part) => part?.type === 'toolCall')) return '';
  return message.content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function publicPiAssistantNote(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  if (!message.content.some((part) => part?.type === 'toolCall')) return '';
  return message.content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim()
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, '[已隐藏密钥]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
    .slice(0, 3000);
}

async function exclusive(sessionKey, operation) {
  const previous = sessionQueues.get(sessionKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  sessionQueues.set(sessionKey, current);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (sessionQueues.get(sessionKey) === current) sessionQueues.delete(sessionKey);
  }
}

function requiredPath(paths, key) {
  const value = paths?.[key];
  if (typeof value !== 'string' || !value) throw new Error(`Pi Session 缺少 ${key}`);
  return value;
}

export function governPiModelRuntime(modelRuntime, {
  beforeModelRequest,
  onModelRequest,
} = {}) {
  if (!modelRuntime || typeof modelRuntime.streamSimple !== 'function') {
    throw new TypeError('Pi ModelRuntime 缺少 streamSimple()');
  }
  const streamSimple = modelRuntime.streamSimple.bind(modelRuntime);
  let requestCount = 0;
  modelRuntime.streamSimple = (model, context, requestOptions = {}) => {
    const request = {
      index: requestCount + 1,
      model,
      context,
    };
    const reservation = beforeModelRequest?.(request);
    if (reservation && typeof reservation.then === 'function') {
      throw new TypeError('beforeModelRequest 必须同步完成，才能在模型请求前可靠预留预算');
    }
    requestCount += 1;
    onModelRequest?.({ ...request, reservation });
    // Provider-level retries are invisible to Worker budgets. Pi may start a new
    // governed request itself, but one admitted call must map to one HTTP attempt.
    return streamSimple(model, context, { ...requestOptions, maxRetries: 0 });
  };
  return () => requestCount;
}

export async function runPiAgentSession(options) {
  const sessionKey = String(options.sessionKey || '').trim();
  if (!sessionKey) throw new Error('Pi Session 缺少 sessionKey');

  return exclusive(sessionKey, async () => {
    const executionState = createExecutionState();
    const cwd = requiredPath(options.paths, 'workspaceRoot');
    const runtimeRoot = requiredPath(options.paths, 'runtimeRoot');
    const sessionDir = requiredPath(options.paths, 'sessionDir');
    await Promise.all([
      mkdir(cwd, { recursive: true }),
      mkdir(sessionDir, { recursive: true }),
      mkdir(runtimeRoot, { recursive: true }),
    ]);

    const apiKey = options.apiKey || process.env.apiKey;
    if (!apiKey) throw new Error('Pi 运行时没有可用的模型 API Key，请先在账号设置中配置');
    const limits = modelTokenLimits(options.modelName, options.modelContextWindow);
    const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
    modelRuntime.registerProvider(PROVIDER_ID, {
      baseUrl: options.apiBaseUrl,
      api: 'openai-completions',
      models: [{
        id: options.modelName,
        name: options.modelName,
        reasoning: true,
        input: ['text'],
        contextWindow: limits.contextWindow,
        maxTokens: limits.maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }],
    });
    await modelRuntime.setRuntimeApiKey(PROVIDER_ID, apiKey);
    const model = modelRuntime.getModel(PROVIDER_ID, options.modelName);
    if (!model) throw new Error(`Pi 无法加载模型：${options.modelName}`);
    let governanceError = null;
    const pendingModelRequests = [];
    const getGovernedRequestCount = governPiModelRuntime(modelRuntime, {
      beforeModelRequest: (request) => {
        try {
          return options.beforeModelRequest?.(request);
        } catch (error) {
          governanceError = error;
          throw error;
        }
      },
      onModelRequest: (request) => {
        executionState.modelRequestCount = request.index;
        pendingModelRequests.push({
          index: request.index,
          startedAt: Date.now(),
          requestChars: JSON.stringify(request.context || {}).length,
          estimatedInputTokens: estimateTokens(request.context),
        });
        options.onModelRequest?.(request);
      },
    });

    const settingsManager = SettingsManager.inMemory({
      compaction: {
        enabled: true,
        reserveTokens: limits.contextWindow - limits.compactionTriggerTokens,
        keepRecentTokens: limits.keepRecentTokens,
      },
      retry: { enabled: true, maxRetries: 2 },
      defaultThinkingLevel: options.thinkingLevel || 'medium',
    }, { projectTrusted: false });
    const extensionFactories = typeof options.transformContextMessages === 'function'
      ? [{
          name: 'almaren-context-compaction',
          hidden: true,
          factory: (pi) => {
            pi.on('context', (event) => ({ messages: options.transformContextMessages(event.messages) }));
          },
        }]
      : [];
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: runtimeRoot,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: options.systemPrompt || '',
      extensionFactories,
    });
    await resourceLoader.reload();

    const sessionManager = SessionManager.continueRecent(cwd, sessionDir);
    const { session } = await createAgentSession({
      cwd,
      agentDir: runtimeRoot,
      modelRuntime,
      model,
      thinkingLevel: options.thinkingLevel || 'medium',
      noTools: 'builtin',
      customTools: options.tools || [],
      resourceLoader,
      settingsManager,
      sessionManager,
    });
    if (typeof options.shouldStopAfterTurn === 'function') {
      session.agent.shouldStopAfterTurn = options.shouldStopAfterTurn;
    }
    activeSessions.set(sessionKey, session);
    const cancellationTimer = typeof options.isCancelled === 'function'
      ? setInterval(() => {
          if (options.isCancelled()) void session.abort();
        }, Math.max(50, Number(options.cancellationPollMs) || 250))
      : null;
    cancellationTimer?.unref?.();
    let finalContent = '';
    let lastStopReason = '';
    let streamedText = '';
    let currentMessageHasToolCall = false;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_start' && event.message.role === 'assistant') {
        streamedText = '';
        currentMessageHasToolCall = false;
      }
      if (event.type === 'message_update') {
        if (event.assistantMessageEvent.type === 'text_delta' && !currentMessageHasToolCall) {
          const delta = event.assistantMessageEvent.delta || '';
          streamedText += delta;
          options.onTextDelta?.(delta);
        }
        if (event.assistantMessageEvent.type === 'toolcall_start') {
          currentMessageHasToolCall = true;
          if (streamedText) {
            options.onTextReset?.();
            streamedText = '';
          }
          const toolCall = event.message.content[event.assistantMessageEvent.contentIndex];
          if (toolCall?.type === 'toolCall') {
            options.onToolPreparation?.({
              name: toolCall.name,
              label: options.toolLabel?.(toolCall.name) || toolCall.name,
            });
          }
        }
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const visibleText = visiblePiAssistantText(event.message);
        const publicNote = publicPiAssistantNote(event.message);
        if (visibleText) {
          finalContent = visibleText;
          if (visibleText.startsWith(streamedText)) options.onTextDelta?.(visibleText.slice(streamedText.length));
          else if (visibleText !== streamedText) {
            if (streamedText) options.onTextReset?.();
            options.onTextDelta?.(visibleText);
          }
        }
        if (publicNote && executionState.notes.length < 6) {
          const note = {
            id: `note-${executionState.modelRequestCount + 1}`,
            content: publicNote,
            createdAt: new Date().toISOString(),
          };
          executionState.notes.push(note);
          options.onProcessNote?.(note);
        }
        lastStopReason = event.message.stopReason || '';
        const usage = event.message.usage || {};
        executionState.tokens.input += numberOrZero(usage.input);
        executionState.tokens.output += numberOrZero(usage.output);
        executionState.tokens.cacheRead += numberOrZero(usage.cacheRead);
        executionState.tokens.cacheWrite += numberOrZero(usage.cacheWrite);
        executionState.tokens.total += numberOrZero(usage.totalTokens);
        const request = pendingModelRequests.shift();
        options.onModelRequestComplete?.({
          index: request?.index || executionState.modelRequestCount,
          durationMs: request ? Math.max(0, Date.now() - request.startedAt) : null,
          requestChars: request?.requestChars || 0,
          estimatedInputTokens: numberOrZero(usage.input) || request?.estimatedInputTokens || 0,
          estimatedOutputTokens: numberOrZero(usage.output) || estimateTokens(event.message.content),
          providerUsage: usage,
          finishReasons: event.message.stopReason ? [event.message.stopReason] : [],
          toolCallCount: event.message.content.filter((part) => part?.type === 'toolCall').length,
        });
      }
      if (event.type === 'tool_execution_start') {
        const activity = options.activityFromEvent?.({
          id: event.toolCallId,
          name: event.toolName,
          args: event.args,
        }) || {
          id: String(event.toolCallId || ''),
          name: String(event.toolName || ''),
          label: options.toolLabel?.(event.toolName) || String(event.toolName || ''),
          status: 'running',
          startedAt: new Date().toISOString(),
        };
        executionState.activities.push(activity);
        options.onActivity?.(activity);
        options.onToolEvent?.({ type: 'start', name: event.toolName, args: event.args });
      }
      if (event.type === 'tool_execution_end') {
        const activity = executionState.activities.find((item) => item.id === event.toolCallId);
        if (activity) {
          activity.status = event.isError ? 'failed' : 'completed';
          activity.completedAt = new Date().toISOString();
          activity.durationMs = Math.max(0, Date.parse(activity.completedAt) - Date.parse(activity.startedAt));
          options.onActivity?.({ ...activity });
        }
        options.onToolEvent?.({ type: 'end', name: event.toolName, isError: event.isError });
      }
    });

    try {
      await session.prompt(options.message, { expandPromptTemplates: false, source: options.source || 'rpc' });
      if (governanceError) throw governanceError;
      if (!finalContent) {
        const assistant = [...session.messages].reverse().find((message) => message.role === 'assistant');
        finalContent = assistant?.content?.filter((part) => part.type === 'text').map((part) => part.text).join('') || '';
      }
      const status = lastStopReason === 'aborted' ? 'cancelled' : 'completed';
      const resolvedContent = typeof options.resolveResult === 'function'
        ? await options.resolveResult({ finalContent, status, session })
        : finalContent;
      return {
        content: String(resolvedContent || '').trim() || (status === 'cancelled' ? 'Pi 已取消本轮处理。' : 'Pi 已完成本轮处理。'),
        sessionId: session.sessionId,
        execution: finishExecution(executionState, status),
      };
    } catch (error) {
      const execution = finishExecution(executionState, lastStopReason === 'aborted' ? 'cancelled' : 'failed');
      if (error && typeof error === 'object') error.piExecution = execution;
      throw error;
    } finally {
      if (cancellationTimer) clearInterval(cancellationTimer);
      executionState.modelRequestCount = getGovernedRequestCount();
      unsubscribe();
      if (activeSessions.get(sessionKey) === session) activeSessions.delete(sessionKey);
      session.dispose();
    }
  });
}

export async function cancelPiAgentSession(sessionKey) {
  const session = activeSessions.get(String(sessionKey));
  if (!session) return false;
  await session.abort();
  return true;
}

export function isPiAgentSessionActive(sessionKey) {
  return activeSessions.has(String(sessionKey));
}
