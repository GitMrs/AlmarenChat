import assert from 'node:assert/strict';
import test from 'node:test';
import { runAssistantToolLoop } from './tool-loop.mjs';

test('assistant tool loop executes calls and returns the final model response', async () => {
  const requests = [];
  const result = await runAssistantToolLoop({
    messages: [{ role: 'user', content: '查公交' }],
    tools: [{ type: 'function', function: { name: 'mcp_map_transit_arrival' } }],
    broker: { call: async (name, args) => ({ name, args, minutes: 5 }) },
    complete: async (messages, tools) => {
      requests.push({ messages, tools });
      if (requests.length === 1) return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', function: { name: 'mcp_map_transit_arrival', arguments: '{"station":"知春路"}' } }] } }] };
      return { choices: [{ message: { role: 'assistant', content: '下一班车约 5 分钟到。' } }] };
    },
  });
  assert.equal(result, '下一班车约 5 分钟到。');
  assert.equal(requests[1].messages.at(-1).role, 'tool');
});

test('assistant tool loop is bounded when the model keeps requesting tools', async () => {
  let calls = 0;
  const result = await runAssistantToolLoop({
    messages: [],
    broker: { call: async () => ({ ok: true }) },
    maxRounds: 2,
    complete: async () => {
      calls += 1;
      return { choices: [{ message: { tool_calls: [{ id: `call-${calls}`, function: { name: 'tool', arguments: '{}' } }] } }] };
    },
  });
  assert.equal(result, '');
  assert.equal(calls, 2);
});
