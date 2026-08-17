import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextCompressionManager } from './context-manager.mjs';

function messages(count, contentSize = 80) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    role: 'assistant',
    content: `result-${index} ${'x'.repeat(contentSize)}`,
  }));
}

test('worker context compression preserves message bodies and enforces budgets', () => {
  const manager = new ContextCompressionManager();
  const source = messages(20);
  const originalContent = new Map(source.map((message) => [message.id, message.content]));
  const result = manager.compress(source, {
    maxMessages: 6,
    targetTokens: 300,
    preserveRecent: 3,
  });

  assert.ok(result.compressed.length <= 6);
  assert.ok(result.stats.compressedTokens <= 300);
  assert.equal(result.stats.budgetExceeded, false);
  assert.equal(result.compressed.at(-1)?.id, '19');
  for (const message of result.compressed) {
    assert.equal(message.content, originalContent.get(message.id));
  }
});

test('worker context compression reports an oversized latest result', () => {
  const manager = new ContextCompressionManager();
  const source = messages(3, 1_000);
  const result = manager.compress(source, {
    maxMessages: 2,
    targetTokens: 50,
    preserveRecent: 2,
  });

  assert.deepEqual(result.compressed.map((message) => message.id), ['2']);
  assert.equal(result.stats.budgetExceeded, true);
  assert.equal(result.compressed[0].content, source[2].content);
});
