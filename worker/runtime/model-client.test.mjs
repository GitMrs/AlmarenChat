import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerModelClient } from './model-client.mjs';

const model = {
  apiKey: 'test-key',
  baseURL: 'https://model.invalid/v1',
  name: 'deepseek-v4-flash',
};

async function* streamWith(delta, finishReason = 'stop') {
  yield {
    model: model.name,
    choices: [{ delta, finish_reason: finishReason }],
  };
}

function fixture({
  stream = streamWith({ content: '完成' }),
  fakeMode = false,
  create = null,
  retryTransient = (operation) => operation(),
  modelTimeoutMs = 180_000,
  retryOfId = null,
} = {}) {
  const clientOptions = [];
  const requests = [];
  const reservations = [];
  const warnings = [];
  const completions = [];
  const timeouts = [];
  const client = createWorkerModelClient({
    db: { marker: 'db' },
    fakeMode,
    modelTimeoutMs,
    getRun: () => ({ retryOfId }),
    now: () => 'now',
    createClient: (options) => {
      clientOptions.push(options);
      return {
        chat: {
          completions: {
            create: async (payload, requestOptions) => {
              requests.push({ payload, requestOptions });
              return create ? create(payload, requestOptions) : stream;
            },
          },
        },
      };
    },
    reserveRequest: (...args) => reservations.push(args),
    retryTransient,
    warn: (...args) => warnings.push(args),
    onRequestComplete: (event) => completions.push(event),
    onRequestTimeout: (event) => timeouts.push(event),
  });
  return { client, clientOptions, requests, reservations, warnings, completions, timeouts };
}

test('worker model client sends DeepSeek-compatible tool requests', async () => {
  const current = fixture();
  const signal = new AbortController().signal;
  let streamStarted = 0;
  const tools = [{ type: 'function', function: { name: 'submit_action', parameters: { type: 'object' } } }];
  const message = await current.client.completeMessage(
    model,
    [{ role: 'user', content: '安排任务' }],
    tools,
    {
      runId: 'run-1',
      taskId: 'task-1',
      signal,
      onStreamStart: () => { streamStarted += 1; },
    }
  );

  assert.equal(message.content, '完成');
  assert.equal(streamStarted, 1);
  assert.deepEqual(current.clientOptions, [{
    apiKey: 'test-key',
    baseURL: 'https://model.invalid/v1',
    timeout: 180_000,
    maxRetries: 0,
  }]);
  assert.equal(current.requests[0].payload.tool_choice, 'auto');
  assert.deepEqual(current.requests[0].payload.tools, tools);
  assert.equal(current.requests[0].payload.stream, true);
  assert.equal('max_tokens' in current.requests[0].payload, false);
  assert.equal('max_completion_tokens' in current.requests[0].payload, false);
  assert.equal(current.requests[0].requestOptions.signal instanceof AbortSignal, true);
  assert.equal(current.requests[0].requestOptions.signal.aborted, false);
  assert.deepEqual(current.reservations, [[{ marker: 'db' }, 'run-1', 'task-1', 'now']]);
  assert.equal(current.completions.length, 1);
  assert.equal(current.completions[0].requestChars > 0, true);
  assert.equal(current.completions[0].estimatedInputTokens > 0, true);
  assert.equal(current.completions[0].estimatedOutputTokens, 2);
  assert.equal(
    current.completions[0].estimatedTotalTokens,
    current.completions[0].estimatedInputTokens + current.completions[0].estimatedOutputTokens
  );
  assert.equal(current.completions[0].contentChars, 2);
  assert.equal(current.completions[0].scope, 'task');
  assert.equal('messages' in current.completions[0], false);
});

test('worker model client prefers provider usage for estimated token telemetry', async () => {
  async function* usageStream() {
    yield {
      model: model.name,
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      choices: [{ delta: { content: '完成' }, finish_reason: 'stop' }],
    };
  }
  const current = fixture({ stream: usageStream() });
  await current.client.completeMessage(model, [{ role: 'user', content: '安排任务' }], [], {
    runId: 'run-1',
  });

  assert.deepEqual(current.completions[0].providerUsage, {
    prompt_tokens: 12,
    completion_tokens: 3,
    total_tokens: 15,
  });
  assert.equal(current.completions[0].estimatedInputTokens, 12);
  assert.equal(current.completions[0].estimatedOutputTokens, 3);
  assert.equal(current.completions[0].estimatedTotalTokens, 15);
});

test('manual run retries double the configured model timeout', async () => {
  const current = fixture({ retryOfId: 'previous-run' });
  await current.client.completeMessage(model, [], [], { runId: 'retry-run' });
  assert.equal(current.clientOptions[0].timeout, 360_000);
});

test('manual retry doubles both provider timeout and the total stream deadline', async () => {
  async function* delayedStream() {
    await new Promise((resolve) => setTimeout(resolve, 70));
    yield { choices: [{ delta: { content: '完成' } }] };
  }
  const current = fixture({ modelTimeoutMs: 50, retryOfId: 'previous-run', stream: delayedStream() });
  const message = await current.client.completeMessage(model, [], [], { runId: 'retry-run' });
  assert.equal(message.content, '完成');
  assert.equal(current.clientOptions[0].timeout, 100);
  assert.equal(current.timeouts.length, 0);
});

test('worker model client omits tool fields and can reserve only the run budget', async () => {
  const current = fixture();
  const result = await current.client.complete(model, [{ role: 'user', content: '总结' }], {
    runId: 'run-1',
    taskId: 'task-1',
    reserveTaskBudget: false,
  });

  assert.equal(result, '完成');
  assert.equal('tools' in current.requests[0].payload, false);
  assert.equal('tool_choice' in current.requests[0].payload, false);
  assert.deepEqual(current.reservations, [[{ marker: 'db' }, 'run-1', null, 'now']]);
  assert.equal(current.completions[0].scope, 'run');
});

test('worker model client preserves reasoning-only diagnostics without exposing reasoning text', async () => {
  const current = fixture({ stream: streamWith({ reasoning_content: '内部推理内容' }, 'length') });
  const reasoning = [];
  const message = await current.client.completeMessage(model, [{ role: 'user', content: '任务' }], [], {
    runId: 'run-1',
    taskId: 'task-1',
    onReasoningDelta: (delta) => reasoning.push(delta),
  });

  assert.equal(message.content, null);
  assert.equal(message.diagnostics.reasoningContentChars, 6);
  assert.deepEqual(reasoning, ['内部推理内容']);
  assert.deepEqual(message.diagnostics.finishReasons, ['length']);
  assert.equal(JSON.stringify(message).includes('内部推理内容'), false);
  assert.equal(current.warnings.length, 1);
  assert.match(current.warnings[0][1], /"requestedModel":"deepseek-v4-flash"/);
  assert.match(current.warnings[0][1], /"reasoningContentChars":6/);
});

test('worker model client reserves budget for every transient provider attempt', async () => {
  let providerAttempts = 0;
  let retryEvents = 0;
  const current = fixture({
    create: async () => {
      providerAttempts += 1;
      if (providerAttempts === 1) throw Object.assign(new Error('temporary failure'), { status: 503 });
      return streamWith({ content: '重试成功' });
    },
    retryTransient: async (operation, { onRetry }) => {
      try {
        return await operation();
      } catch (error) {
        onRetry?.(error);
        return operation();
      }
    },
  });
  const message = await current.client.completeMessage(model, [], [], {
    runId: 'run-1',
    taskId: 'task-1',
    onRetry: () => { retryEvents += 1; },
  });

  assert.equal(message.content, '重试成功');
  assert.equal(providerAttempts, 2);
  assert.equal(retryEvents, 1);
  assert.equal(current.reservations.length, 2);
});

test('worker model client marks exhausted transient failures as recoverable', async () => {
  const current = fixture({
    create: async () => {
      throw Object.assign(new Error('500 empty_stream: upstream stream closed before first payload'), { status: 500 });
    },
  });
  await assert.rejects(
    current.client.completeMessage(model, [], [], { runId: 'run-1' }),
    (error) => error.code === 'MODEL_PROVIDER_TRANSIENT' && error.status === 500
  );
});

test('worker model client timeout covers complete stream consumption', async () => {
  let streamReturned = false;
  const current = fixture({
    modelTimeoutMs: 20,
    create: async () => ({
      async *[Symbol.asyncIterator]() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        streamReturned = true;
        yield { choices: [{ delta: { content: 'late' } }] };
      },
    }),
  });
  await assert.rejects(
    current.client.completeMessage(model, [], [], { runId: 'run-1' }),
    (error) => error.code === 'MODEL_TIMEOUT'
  );
  assert.equal(streamReturned, false);
  assert.equal(current.completions.length, 0);
  assert.equal(current.timeouts.length, 1);
  assert.equal(current.timeouts[0].stage, 'WAITING_FIRST_CHUNK');
  assert.equal(current.timeouts[0].firstChunkAfterMs, null);
  assert.equal(current.timeouts[0].lastChunkAgoMs, null);
});

test('timeout diagnostics retain partial reasoning and tool counts without exposing text', async () => {
  async function* partialStream() {
    yield { choices: [{ delta: { reasoning_content: 'private reasoning', content: 'hello' } }] };
    yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'secret args' } }] } }] };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const current = fixture({ modelTimeoutMs: 20, stream: partialStream() });
  await assert.rejects(current.client.completeMessage(model, [], [], { runId: 'run-1' }), (error) => {
    assert.equal(error.code, 'MODEL_TIMEOUT');
    assert.equal(error.diagnostics.stage, 'STREAM_STARTED');
    assert.equal(error.diagnostics.chunkCount, 2);
    assert.equal(error.diagnostics.contentChars, 5);
    assert.equal(error.diagnostics.reasoningContentChars, 17);
    assert.equal(error.diagnostics.toolArgumentChars, 11);
    assert.equal(error.diagnostics.lastChunkAgoMs >= 0, true);
    return true;
  });
  assert.equal(current.timeouts.length, 1);
  assert.equal(JSON.stringify(current.timeouts).includes('private reasoning'), false);
  assert.equal(JSON.stringify(current.warnings).includes('secret args'), false);
});

test('timeout diagnostics track responses still arriving near the deadline', async () => {
  async function* activeStream() {
    for (let index = 0; index < 20; index += 1) {
      yield { choices: [{ delta: { content: 'x' } }] };
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  const current = fixture({ modelTimeoutMs: 40, stream: activeStream() });
  await assert.rejects(current.client.completeMessage(model, [], [], {}), (error) => {
    assert.equal(error.code, 'MODEL_TIMEOUT');
    assert.equal(error.diagnostics.stage, 'STREAM_STARTED');
    assert.equal(error.diagnostics.chunkCount > 1, true);
    assert.equal(error.diagnostics.contentChars, error.diagnostics.chunkCount);
    assert.equal(error.diagnostics.lastChunkAgoMs < error.diagnostics.durationMs, true);
    return true;
  });
});

test('fake worker model client does not create a provider client or reserve budget', async () => {
  const current = fixture({ fakeMode: true });
  assert.deepEqual(await current.client.completeMessage(model, [], [], { runId: 'run-1' }), { content: '' });
  assert.equal(current.clientOptions.length, 0);
  assert.equal(current.requests.length, 0);
  assert.equal(current.reservations.length, 0);
});
