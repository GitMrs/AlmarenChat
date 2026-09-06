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

test('large writes are compacted while small patches remain available to the model', async () => {
  const originalContent = 'page-content-'.repeat(1_000);
  let requestCount = 0;
  await runToolLoop({
    messages: [],
    tools: [],
    requestCompletion: async (messages) => {
      requestCount += 1;
      if (requestCount === 1) {
        return {
          content: null,
          tool_calls: [
            { id: 'write', function: { name: 'write_file', arguments: JSON.stringify({ path: 'index.html', content: originalContent }) } },
            { id: 'patch', function: { name: 'patch_file', arguments: JSON.stringify({ path: 'app.js', search: 'before', replacement: 'after' }) } },
            { id: 'patch-many', function: { name: 'patch_files', arguments: JSON.stringify({ edits: [{ path: 'data.json', search: 'old', replacement: 'new' }] }) } },
          ],
        };
      }
      const assistant = messages.find((message) => message.role === 'assistant');
      const calls = Object.fromEntries(assistant.tool_calls.map((call) => [
        call.function.name,
        JSON.parse(call.function.arguments),
      ]));
      assert.equal(calls.write_file.path, 'index.html');
      assert.match(calls.write_file.content, /13000 个字符已省略/);
      assert.equal(calls.write_file.content.includes(originalContent), false);
      assert.equal(calls.patch_file.search, 'before');
      assert.equal(calls.patch_file.replacement, 'after');
      assert.equal(calls.patch_files.edits[0].search, 'old');
      assert.equal(calls.patch_files.edits[0].replacement, 'new');
      return { content: '完成' };
    },
    executeTool: async (name, args) => {
      if (name === 'write_file') assert.equal(args.content, originalContent);
      return { ok: true };
    },
  });
});

test('tool loop preserves a normal large file result for the next model request', async () => {
  let requests = 0;
  const content = 'x'.repeat(56_830);
  const result = await runToolLoop({
    messages: [],
    tools: [],
    requestCompletion: async (messages) => {
      requests += 1;
      if (requests === 1) {
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'read', function: { name: 'read_file', arguments: '{"path":"index.html"}' } }],
        };
      }
      const toolMessage = messages.find((message) => message.role === 'tool');
      assert.ok(toolMessage.content.length > content.length);
      assert.match(toolMessage.content, /"hasMore":false/);
      return { role: 'assistant', content: '已读取完整文件' };
    },
    executeTool: async () => ({ content, hasMore: false, totalChars: content.length }),
  });
  assert.equal(result.content, '已读取完整文件');
  assert.equal(requests, 2);
});

test('failed mutation arguments remain available for model correction', async () => {
  const originalContent = 'invalid-content';
  let requestCount = 0;
  await runToolLoop({
    messages: [],
    tools: [],
    requestCompletion: async (messages) => {
      requestCount += 1;
      if (requestCount === 1) {
        return {
          content: null,
          tool_calls: [{
            id: 'write',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'data.json', content: originalContent }) },
          }],
        };
      }
      const assistant = messages.find((message) => message.role === 'assistant');
      assert.equal(JSON.parse(assistant.tool_calls[0].function.arguments).content, originalContent);
      assert.match(messages.at(-1).content, /写入失败/);
      return { content: '已纠正' };
    },
    executeTool: async () => ({ ok: false, error: '写入失败' }),
  });
});

test('tool loop requires the configured completion tool and stops on its result', async () => {
  let requests = 0;
  const result = await runToolLoop({
    messages: [{ role: 'user', content: '完成任务' }],
    tools: [{ type: 'function', function: { name: 'submit_task_result' } }],
    requiredFinalTool: 'submit_task_result',
    requestCompletion: async (messages) => {
      requests += 1;
      if (requests === 1) return { content: '已经完成' };
      assert.match(messages.at(-1).content, /不能通过普通文本结束/);
      return {
        content: null,
        tool_calls: [{
          id: 'submit-1',
          function: { name: 'submit_task_result', arguments: '{"summary":"已完成"}' },
        }],
      };
    },
    executeTool: async () => ({ ok: true, stop: true, content: '已完成' }),
  });
  assert.equal(requests, 2);
  assert.equal(result.content, '已完成');
});

test('tool loop executes mutations before a parallel completion call', async () => {
  const calls = [];
  const result = await runToolLoop({
    messages: [],
    tools: [],
    requiredFinalTool: 'submit_task_result',
    requestCompletion: async () => ({
      content: null,
      tool_calls: [
        { id: 'submit', function: { name: 'submit_task_result', arguments: '{}' } },
        { id: 'patch', function: { name: 'patch_file', arguments: '{}' } },
      ],
    }),
    executeTool: async (name) => {
      calls.push(name);
      return name === 'submit_task_result' ? { stop: true, content: '完成' } : { ok: true };
    },
  });
  assert.deepEqual(calls, ['patch_file', 'submit_task_result']);
  assert.equal(result.content, '完成');
});

test('tool loop retries one empty model response with corrective guidance', async () => {
  let requests = 0;
  let retryEvent = null;
  const result = await runToolLoop({
    messages: [{ role: 'user', content: '创建页面' }],
    tools: [],
    requestCompletion: async (messages, _tools, requestState) => {
      requests += 1;
      if (requests === 1) return { content: null };
      assert.equal(requestState.emptyResponseCount, 1);
      assert.match(messages.at(-1).content, /上一次响应为空/);
      return { content: '页面已完成' };
    },
    executeTool: async () => ({}),
    isCancelled: () => false,
    onEmptyResponse: (event) => { retryEvent = event; },
  });
  assert.equal(result.content, '页面已完成');
  assert.equal(requests, 2);
  assert.equal(retryEvent.retry, 1);
});

test('empty response retries do not consume the productive iteration budget', async () => {
  let requests = 0;
  const result = await runToolLoop({
    messages: [],
    tools: [],
    maxIterations: 1,
    maxEmptyResponseRetries: 1,
    requestCompletion: async () => {
      requests += 1;
      return requests === 1 ? { content: '' } : { content: '完成' };
    },
    executeTool: async () => ({}),
  });

  assert.equal(requests, 2);
  assert.equal(result.iterations, 1);
  assert.equal(result.content, '完成');
});

test('empty response exhaustion has a distinct error after three total attempts', async () => {
  let requests = 0;
  await assert.rejects(runToolLoop({
    messages: [],
    tools: [],
    maxEmptyResponseRetries: 2,
    requestCompletion: async () => {
      requests += 1;
      return { content: '', diagnostics: { finishReasons: ['stop'], contentChars: 0 } };
    },
    executeTool: async () => ({}),
  }), (error) => error.code === 'EMPTY_MODEL_RESPONSE' && error.diagnostics?.contentChars === 0);
  assert.equal(requests, 3);
});

test('the final productive iteration tells the model to submit instead of rechecking', async () => {
  let requests = 0;
  const result = await runToolLoop({
    messages: [],
    tools: [],
    maxIterations: 2,
    requiredFinalTool: 'submit_task_result',
    requestCompletion: async (messages) => {
      requests += 1;
      if (requests === 1) {
        return {
          content: null,
          tool_calls: [{ id: 'write', function: { name: 'write_file', arguments: '{}' } }],
        };
      }
      assert.match(messages.at(-1).content, /最后一个有效执行轮次/);
      return {
        content: null,
        tool_calls: [{ id: 'submit', function: { name: 'submit_task_result', arguments: '{}' } }],
      };
    },
    executeTool: async (name) => name === 'submit_task_result'
      ? { ok: true, stop: true, content: '已提交' }
      : { ok: true },
  });

  assert.equal(result.content, '已提交');
});

test('tool loop fails after consecutive empty model responses', async () => {
  let requests = 0;
  await assert.rejects(() => runToolLoop({
    messages: [{ role: 'user', content: '创建页面' }],
    tools: [],
    requestCompletion: async () => {
      requests += 1;
      return { content: '' };
    },
    executeTool: async () => ({}),
    isCancelled: () => false,
  }), /没有返回任务结果/);
  assert.equal(requests, 2);
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
      if (responses.length === 1) secondMessages = structuredClone(messages);
      return responses.shift();
    },
    executeTool: async () => {
      throw new Error('文件不存在');
    },
  });
  assert.match(secondMessages.at(-1).content, /文件不存在/);
});

test('failed patches tell the model to refresh the target instead of retrying unchanged arguments', async () => {
  const responses = [
    {
      content: null,
      tool_calls: [{
        id: 'patch-1',
        function: { name: 'patch_file', arguments: '{"path":"page.html","search":"old","replacement":"new"}' },
      }],
    },
    { content: '将重新读取目标位置。' },
  ];
  let secondMessages;
  await runToolLoop({
    messages: [],
    tools: [],
    requestCompletion: async (messages) => {
      if (responses.length === 1) secondMessages = structuredClone(messages);
      return responses.shift();
    },
    executeTool: async () => ({ ok: false, error: '文件中找不到待替换内容' }),
  });
  const failure = JSON.parse(secondMessages.at(-1).content);
  assert.match(failure.error, /找不到待替换内容/);
  assert.match(failure.guidance, /先用 read_file/);
  assert.match(failure.guidance, /不要原样重试/);
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
  let checkpoint = null;
  const result = await runToolLoop({
    messages: [],
    tools: [{ type: 'function', function: { name: 'request_user_input' } }],
    requestCompletion: async () => {
      modelRequests += 1;
      return {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'input-1', type: 'function', function: { name: 'request_user_input', arguments: '{}' } },
          { id: 'later-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"later.md"}' } },
        ],
      };
    },
    executeTool: async () => ({ ok: true, pause: true }),
    onCheckpoint: async (value) => { checkpoint = structuredClone(value); },
  });
  assert.equal(result.paused, true);
  assert.equal(result.content, '');
  assert.equal(modelRequests, 1);
  assert.equal(checkpoint.conversation.at(-1).tool_call_id, 'later-1');
  assert.match(checkpoint.conversation.at(-1).content, /尚未执行/);
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
  assert.equal(message.diagnostics.chunkCount, 3);
  assert.deepEqual(message.diagnostics.deltaFields.sort(), ['content', 'tool_calls']);
  assert.equal(message.diagnostics.toolCallFragments, 2);
});

test('stream collector reports reasoning-only responses without exposing reasoning text', async () => {
  async function* chunks() {
    yield { model: 'deepseek-test', choices: [{ delta: { reasoning_content: '内部推理内容' } }] };
    yield { model: 'deepseek-test', choices: [{ delta: {}, finish_reason: 'stop' }] };
  }
  const message = await collectChatCompletionStream(chunks());
  assert.equal(message.content, null);
  assert.deepEqual(message.diagnostics.responseModels, ['deepseek-test']);
  assert.deepEqual(message.diagnostics.finishReasons, ['stop']);
  assert.equal(message.diagnostics.reasoningContentChars, 6);
  assert.equal(JSON.stringify(message.diagnostics).includes('内部推理内容'), false);
});

test('stream collector records provider token usage without response contents', async () => {
  async function* chunks() {
    yield {
      choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    };
  }
  const message = await collectChatCompletionStream(chunks());
  assert.deepEqual(message.diagnostics.usage, {
    prompt_tokens: 12,
    completion_tokens: 3,
    total_tokens: 15,
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

test('tool loop blocks changed-offset reads after a file is fully available', async () => {
  const limits = [];
  const toolResults = [];
  let requests = 0;
  let executions = 0;
  await assert.rejects(
    runToolLoop({
      messages: [],
      tools: [],
      maxIterations: 8,
      requestCompletion: async (messages) => {
        requests += 1;
        for (const message of messages.filter((item) => item.role === 'tool')) {
          if (!toolResults.includes(message.content)) toolResults.push(message.content);
        }
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: `read-${requests}`,
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'page.html', offset: requests * 100 }) },
          }],
        };
      },
      executeTool: async () => {
        executions += 1;
        return { path: 'page.html', content: 'complete', offset: 0, nextOffset: 8, totalChars: 8, hasMore: false };
      },
      onLimit: (limit) => limits.push(limit),
    }),
    (error) => error.code === 'TOOL_LOOP_LIMIT' && error.reason === 'no_progress'
  );
  assert.equal(executions, 1);
  assert.equal(requests, 4);
  assert.equal(limits[0].reason, 'no_progress');
  assert.ok(toolResults.some((result) => /已完整读取/.test(result)));
});

test('tool loop allows a file to be read again after a successful mutation', async () => {
  let requests = 0;
  let reads = 0;
  const result = await runToolLoop({
    messages: [],
    tools: [],
    requestCompletion: async () => {
      requests += 1;
      if (requests === 1 || requests === 3) {
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: `read-${requests}`, function: { name: 'read_file', arguments: '{"path":"page.html"}' } }],
        };
      }
      if (requests === 2) {
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'patch', function: { name: 'patch_file', arguments: '{"path":"page.html","search":"a","replacement":"b"}' } }],
        };
      }
      return { role: 'assistant', content: '完成' };
    },
    executeTool: async (name) => {
      if (name === 'read_file') {
        reads += 1;
        return { path: 'page.html', content: 'complete', offset: 0, nextOffset: 8, totalChars: 8, hasMore: false };
      }
      return { ok: true, path: 'page.html' };
    },
  });
  assert.equal(result.content, '完成');
  assert.equal(reads, 2);
});

test('tool loop restores completed file reads from a checkpoint conversation', async () => {
  let requests = 0;
  let executions = 0;
  const checkpointMessages = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'historical-read', function: { name: 'read_file', arguments: '{"path":"page.html"}' } }],
    },
    {
      role: 'tool',
      tool_call_id: 'historical-read',
      content: JSON.stringify({ path: 'page.html', content: 'complete', offset: 0, nextOffset: 8, totalChars: 8, hasMore: false }),
    },
  ];
  await assert.rejects(
    runToolLoop({
      messages: checkpointMessages,
      tools: [],
      maxIterations: 5,
      requestCompletion: async () => {
        requests += 1;
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: `restored-read-${requests}`,
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'page.html', offset: requests }) },
          }],
        };
      },
      executeTool: async () => {
        executions += 1;
        return { ok: true };
      },
    }),
    (error) => error.code === 'TOOL_LOOP_LIMIT' && error.reason === 'no_progress'
  );
  assert.equal(requests, 3);
  assert.equal(executions, 0);
});

test('productive iteration limit can pause for user-approved continuation', async () => {
  const pauses = [];
  let checkpoint = null;
  const result = await runToolLoop({
    messages: [],
    tools: [],
    maxIterations: 2,
    batchLimit: 30,
    requestCompletion: async () => ({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: Math.random().toString(), type: 'function', function: { name: 'read_file', arguments: '{"path":"progress.md"}' } }],
    }),
    executeTool: async () => ({ ok: true }),
    onIterationLimit: async (limit) => {
      pauses.push(limit);
      return true;
    },
    onCheckpoint: async (value) => { checkpoint = structuredClone(value); },
  });
  assert.equal(result.paused, true);
  assert.equal(result.pauseReason, 'iterations');
  assert.equal(result.iterations, 2);
  assert.equal(pauses[0].reason, 'iterations');
  assert.equal(checkpoint.totalIterations, 2);
  assert.equal(checkpoint.batchCompletedIterations, 2);
  assert.equal(checkpoint.batchLimit, 30);
  assert.equal(checkpoint.conversation.some((message) => /最后一个有效执行轮次/.test(message.content || '')), false);
  assert.equal(checkpoint.conversation.at(-1).role, 'tool');
});

test('a persisted checkpoint resumes as the next logical model iteration', async () => {
  const checkpoint = {
    version: 1,
    conversation: [
      { role: 'system', content: '执行规则' },
      { role: 'user', content: '创建页面' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'write-1', function: { name: 'write_file', arguments: '{"path":"index.html"}' } }] },
      { role: 'tool', tool_call_id: 'write-1', content: '{"ok":true}' },
    ],
    totalIterations: 10,
  };
  let observed = null;
  const result = await runToolLoop({
    messages: [...checkpoint.conversation, { role: 'system', content: '用户已确认继续' }],
    tools: [],
    iterationOffset: checkpoint.totalIterations,
    requestCompletion: async (messages, _tools, state) => {
      observed = { messages: structuredClone(messages), state: structuredClone(state) };
      return { content: '继续完成' };
    },
    executeTool: async () => ({ ok: true }),
  });
  assert.equal(result.content, '继续完成');
  assert.equal(observed.state.iteration, 1);
  assert.equal(observed.state.totalIteration, 11);
  assert.equal(observed.messages.at(-2).role, 'tool');
  assert.equal(observed.messages.at(-1).content, '用户已确认继续');
});

test('worker recovery continues inside the existing approved iteration batch', async () => {
  let observed = null;
  let checkpoint = null;
  const result = await runToolLoop({
    messages: [{ role: 'user', content: '继续任务' }],
    tools: [],
    iterationOffset: 3,
    batchIterationOffset: 3,
    maxIterations: 7,
    requestCompletion: async (_messages, _tools, state) => {
      observed = structuredClone(state);
      return { content: '恢复完成' };
    },
    executeTool: async () => ({ ok: true }),
    onCheckpoint: async (value) => { checkpoint = structuredClone(value); },
  });
  assert.equal(result.content, '恢复完成');
  assert.equal(observed.iteration, 1);
  assert.equal(observed.batchIteration, 4);
  assert.equal(observed.totalIteration, 4);
  assert.equal(checkpoint, null);
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
