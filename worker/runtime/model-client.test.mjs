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
} = {}) {
  const clientOptions = [];
  const requests = [];
  const reservations = [];
  const warnings = [];
  const client = createWorkerModelClient({
    db: { marker: 'db' },
    fakeMode,
    modelTimeoutMs: 180_000,
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
  });
  return { client, clientOptions, requests, reservations, warnings };
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
  assert.deepEqual(current.requests[0].requestOptions, { signal });
  assert.deepEqual(current.reservations, [[{ marker: 'db' }, 'run-1', 'task-1', 'now']]);
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
});

test('worker model client preserves reasoning-only diagnostics without exposing reasoning text', async () => {
  const current = fixture({ stream: streamWith({ reasoning_content: '内部推理内容' }, 'length') });
  const message = await current.client.completeMessage(model, [{ role: 'user', content: '任务' }], [], {
    runId: 'run-1',
    taskId: 'task-1',
  });

  assert.equal(message.content, null);
  assert.equal(message.diagnostics.reasoningContentChars, 6);
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

test('fake worker model client does not create a provider client or reserve budget', async () => {
  const current = fixture({ fakeMode: true });
  assert.deepEqual(await current.client.completeMessage(model, [], [], { runId: 'run-1' }), { content: '' });
  assert.equal(current.clientOptions.length, 0);
  assert.equal(current.requests.length, 0);
  assert.equal(current.reservations.length, 0);
});
