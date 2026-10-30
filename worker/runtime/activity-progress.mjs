import { randomUUID } from 'node:crypto';

export function createModelProgressCallbacks({ emit, runId, taskId, agentId, agentName, now = Date.now }) {
  let requestId = randomUUID();
  let preview = '';
  let chars = 0;
  let publishedChars = 0;
  let finalized = false;
  let lastPublishedAt = -Infinity;
  function publish(final = false) {
    if (finalized || !chars || (!final && now() - lastPublishedAt < 800)) return;
    if (!final && chars === publishedChars) return;
    lastPublishedAt = now();
    publishedChars = chars;
    finalized = final;
    emit?.(runId, 'MODEL_REASONING_PROGRESS', `${agentName}${final ? '已结束本轮思考' : '正在思考'}`, {
      taskId, agentId, requestId, preview, reasoningContentChars: chars, final,
    });
  }
  return {
    reset() {
      requestId = randomUUID();
      finalized = false;
      preview = '';
      chars = publishedChars = 0;
      lastPublishedAt = -Infinity;
    },
    onReasoningDelta(delta) {
      const text = String(delta || '');
      if (!text) return;
      chars += text.length;
      preview = `${preview}${text}`.slice(-600);
      publish();
    },
    flush() { publish(true); },
  };
}

export function toolProgressPayload(name, args = {}) {
  return {
    tool: name,
    ...(args.path ? { path: String(args.path).slice(0, 300) } : {}),
    ...(Array.isArray(args.paths) ? { paths: args.paths.map(String).slice(0, 20) } : {}),
    ...(name === 'patch_files' ? {
      paths: (Array.isArray(args.edits) ? args.edits : []).map((edit) => String(edit?.path || '')).filter(Boolean).slice(0, 20),
    } : {}),
  };
}

export function trackToolExecution(identity, execute) {
  return async (name, args) => {
    const toolCallId = randomUUID();
    const startedAt = Date.now();
    const payload = { taskId: identity.taskId, agentId: identity.agentId, toolCallId, ...toolProgressPayload(name, args) };
    identity.emit?.(identity.runId, 'TOOL_STARTED', `${identity.agentName}正在执行 ${name}`, payload);
    const finish = (result, error) => identity.emit?.(identity.runId, 'TOOL_FINISHED', `${identity.agentName}${error ? '执行失败' : '已执行'} ${name}`, {
      ...payload, failed: Boolean(error), error: error ? String(error).slice(0, 500) : undefined,
      valid: result?.valid ?? result?.ok, durationMs: Date.now() - startedAt,
    });
    try {
      const result = await execute(name, args);
      finish(result, result?.ok === false || result?.valid === false || result?.error ? result.error || result.issues?.join('；') || '工具执行未通过' : null);
      return result;
    } catch (error) {
      finish(null, error?.message || error);
      throw error;
    }
  };
}
