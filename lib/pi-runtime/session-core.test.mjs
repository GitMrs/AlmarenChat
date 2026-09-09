import assert from 'node:assert/strict';
import test from 'node:test';
import {
  governPiModelRuntime,
  publicPiAssistantNote,
  runPiAgentSession,
  visiblePiAssistantText,
} from './session-core.mjs';

test('Pi Session Core reserves governance budget before every provider request', () => {
  const calls = [];
  const runtime = {
    streamSimple(model, context, options) {
      calls.push({ model, context, options });
      return 'stream';
    },
  };
  const reservations = [];
  const getRequestCount = governPiModelRuntime(runtime, {
    beforeModelRequest: ({ index }) => {
      reservations.push(index);
      if (index === 2) throw Object.assign(new Error('预算用尽'), { code: 'MODEL_REQUEST_BUDGET' });
      return { runCount: index };
    },
  });

  assert.equal(runtime.streamSimple({ id: 'model' }, { messages: [] }, { maxRetries: 4 }), 'stream');
  assert.equal(calls[0].options.maxRetries, 0);
  assert.throws(
    () => runtime.streamSimple({ id: 'model' }, { messages: [] }),
    (error) => error.code === 'MODEL_REQUEST_BUDGET'
  );
  assert.deepEqual(reservations, [1, 2]);
  assert.equal(calls.length, 1);
  assert.equal(getRequestCount(), 1);
});

test('Pi Session Core rejects asynchronous pre-request budget hooks', () => {
  const runtime = { streamSimple: () => 'stream' };
  governPiModelRuntime(runtime, { beforeModelRequest: async () => ({}) });
  assert.throws(() => runtime.streamSimple({}, {}), /必须同步完成/);
});

test('Pi Session Core rejects executions without a durable session identity', async () => {
  await assert.rejects(() => runPiAgentSession({}), /缺少 sessionKey/);
});

test('Pi Session Core keeps final text separate from pre-tool notes', () => {
  const toolTurn = {
    role: 'assistant',
    content: [
      { type: 'text', text: '准备执行 Bearer secret-token' },
      { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: {} },
    ],
  };
  assert.equal(visiblePiAssistantText(toolTurn), '');
  assert.equal(publicPiAssistantNote(toolTurn), '准备执行 Bearer [已隐藏]');
  assert.equal(visiblePiAssistantText({
    role: 'assistant',
    content: [{ type: 'text', text: '已经完成' }],
  }), '已经完成');
});
