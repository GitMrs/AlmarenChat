import test from 'node:test';
import assert from 'node:assert/strict';
import { compactActivityEvents } from './activity-events.mjs';

test('long reasoning replaces one row and keeps execution history visible', () => {
  const tool = { id: 'tool', type: 'TOOL_COMPLETED', payload: { tool: 'read_file' } };
  const reasoning = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, type: 'MODEL_REASONING_PROGRESS', payload: { requestId: 'request', preview: String(i) } }));
  const rows = compactActivityEvents([tool, ...reasoning]);
  assert.deepEqual(rows, [tool, reasoning.at(-1)]);
});

test('tool completion replaces its start and removes duplicate legacy completion', () => {
  const start = { id: 'start', type: 'TOOL_STARTED', payload: { tool: 'read_file', toolCallId: 'call' } };
  const legacy = { id: 'legacy', type: 'TOOL_COMPLETED', payload: { tool: 'read_file' } };
  const end = { id: 'end', type: 'TOOL_FINISHED', payload: { tool: 'read_file', toolCallId: 'call', failed: true } };
  const next = { id: 'next', type: 'TOOL_STARTED', payload: { tool: 'read_file', toolCallId: 'next-call' } };
  assert.deepEqual(compactActivityEvents([start, legacy, end, next]), [end, next]);
});
