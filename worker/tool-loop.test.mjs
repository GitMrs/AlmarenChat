import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectChatCompletionStream,
  isTransientModelError,
  runToolLoop,
  withTransientModelRetry,
} from './tool-loop.mjs';

test('tool loop executes a tool and returns the final response', async () => {
  const requests = [];
  const calls = [];
  const iterations = [];
  const responses = [
    {
      content: null,
      tool_calls: [{ id: 'call-1', function: { name: 'write_file', arguments: '{"path":"index.html"}' } }],
    },
    { content: '网页已经生成。' },
  ];
  const result = await runToolLoop({
    messages: [{ role: 'user', content: '制作网页' }],
    tools: [{ type: 'function', function: { name: 'write_file' } }],
    requestCompletion: async (messages) => {
      requests.push(structuredClone(messages));
      return responses.shift();
    },
    executeTool: async (name, args) => {
      calls.push({ name, args });
      return { ok: true };
    },
    onModelRequest: ({ iteration }) => iterations.push(iteration),
  });

  assert.equal(result.content, '网页已经生成。');
  assert.equal(result.iterations, 2);
  assert.deepEqual(calls, [{ name: 'write_file', args: { path: 'index.html' } }]);
  assert.deepEqual(iterations, [1, 2]);
  assert.equal(requests[1].at(-1).role, 'tool');
});

test('tool errors are returned to the model for correction', async () => {
  const responses = [
    {
      content: null,
      tool_calls: [{ id: 'call-1', function: { name: 'read_file', arguments: '{"path":"missing.md"}' } }],
    },
    { content: '文件不存在，无法继续。' },
  ];
  let secondMessages;
  await runToolLoop({
    messages: [],
    tools: [],
    requestCompletion: async (messages) => {
      if (responses.length === 1) secondMessages = messages;
      return responses.shift();
    },
    executeTool: async () => {
      throw new Error('文件不存在');
    },
  });
  assert.match(secondMessages.at(-1).content, /文件不存在/);
});

test('tool loop rejects a model result when cancellation arrives during the request', async () => {
  let cancelled = false;
  await assert.rejects(
    runToolLoop({
      messages: [],
      tools: [],
      requestCompletion: async () => {
        cancelled = true;
        return { content: '不应被接受的结果' };
      },
      executeTool: async () => ({ ok: true }),
      isCancelled: () => cancelled,
    }),
    /任务已取消/
  );
});

test('tool loop stops before another model request when a tool pauses the workflow', async () => {
  let modelRequests = 0;
  const result = await runToolLoop({
    messages: [],
    tools: [{ type: 'function', function: { name: 'request_user_input' } }],
    requestCompletion: async () => {
      modelRequests += 1;
      return {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'input-1', type: 'function', function: { name: 'request_user_input', arguments: '{}' } }],
      };
    },
    executeTool: async () => ({ ok: true, pause: true }),
  });
  assert.equal(result.paused, true);
  assert.equal(result.content, '');
  assert.equal(modelRequests, 1);
});

test('transient model failures retry once', async () => {
  let attempts = 0;
  let retries = 0;
  const result = await withTransientModelRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('524 status code (no body)'), { status: 524 });
      return 'ok';
    },
    { delayMs: 0, onRetry: () => retries += 1 }
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
  assert.equal(retries, 1);
  assert.equal(isTransientModelError(new Error('Request timed out')), true);
  assert.equal(isTransientModelError(new Error('invalid request')), false);
});

test('terminated provider streams are retried but user cancellation is not', async () => {
  assert.equal(isTransientModelError(new TypeError('terminated')), true);
  assert.equal(isTransientModelError(Object.assign(new Error('fetch failed'), {
    cause: { code: 'UND_ERR_SOCKET' },
  })), true);
  assert.equal(isTransientModelError(Object.assign(new Error('Request was aborted.'), {
    name: 'APIUserAbortError',
  })), false);

  let attempts = 0;
  const result = await withTransientModelRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('terminated');
    return 'recovered';
  }, { delayMs: 0 });
  assert.equal(result, 'recovered');
  assert.equal(attempts, 2);
});

test('stream collector assembles content and fragmented tool calls', async () => {
  let started = 0;
  let streamed = '';
  async function* chunks() {
    yield { choices: [{ delta: { content: '准备' } }] };
    yield {
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'write_file', arguments: '{"path":' } }] } }],
    };
    yield {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"index.html","content":"ok"}' } }] } }],
    };
  }
  const message = await collectChatCompletionStream(chunks(), {
    onStreamStart: () => started += 1,
    onContentDelta: (content) => streamed += content,
  });
  assert.equal(started, 1);
  assert.equal(streamed, '准备');
  assert.equal(message.content, '准备');
  assert.equal(message.tool_calls[0].id, 'call-1');
  assert.equal(message.tool_calls[0].function.name, 'write_file');
  assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments), {
    path: 'index.html',
    content: 'ok',
  });
});

test('tool loop stops repeated no-progress calls and reports the limit', async () => {
  const limits = [];
  await assert.rejects(
    runToolLoop({
      messages: [],
      tools: [],
      requestCompletion: async () => ({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: Math.random().toString(), type: 'function', function: { name: 'read_file', arguments: '{"path":"same.md"}' } }],
      }),
      executeTool: async () => ({ ok: true }),
      onLimit: (limit) => limits.push(limit),
    }),
    (error) => error.code === 'TOOL_LOOP_LIMIT' && error.reason === 'no_progress'
  );
  assert.equal(limits[0].reason, 'no_progress');
});

test('tool loop enforces task deadlines before another model request', async () => {
  await assert.rejects(
    runToolLoop({
      messages: [],
      tools: [],
      deadlineAt: Date.now() - 1,
      requestCompletion: async () => ({ role: 'assistant', content: 'late' }),
      executeTool: async () => ({ ok: true }),
    }),
    (error) => error.code === 'TOOL_LOOP_LIMIT' && error.reason === 'deadline'
  );
});
