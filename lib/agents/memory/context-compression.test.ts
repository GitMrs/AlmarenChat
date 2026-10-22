import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMessageImportance, buildContextCheckpointSummary, compressConversationContext } from './context-compression';
import type { SpaceMessage } from '@/types';

function messages(count: number, contentSize = 80): SpaceMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    spaceId: 'space-1',
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message-${index} ${'x'.repeat(contentSize)}`,
    createdAt: new Date(index * 1000).toISOString(),
  }));
}

test('conversation compression keeps whole messages within count and token budgets', () => {
  const source = messages(20);
  const originalContent = new Map(source.map((message) => [message.id, message.content]));
  const result = compressConversationContext(source, {
    maxMessages: 6,
    targetTokens: 300,
    preserveRecent: 3,
  });

  assert.ok(result.compressedMessages.length <= 6);
  assert.ok(result.stats.compressedTokens <= 300);
  assert.equal(result.stats.budgetExceeded, false);
  assert.equal(result.compressedMessages.at(-1)?.id, '19');
  for (const message of result.compressedMessages) {
    assert.equal(message.content, originalContent.get(message.id));
  }
});

test('conversation compression reports an indivisible latest message over budget', () => {
  const source = messages(3, 1_000);
  const result = compressConversationContext(source, {
    maxMessages: 2,
    targetTokens: 50,
    preserveRecent: 2,
  });

  assert.deepEqual(result.compressedMessages.map((message) => message.id), ['2']);
  assert.equal(result.stats.budgetExceeded, true);
  assert.equal(result.compressedMessages[0].content, source[2].content);
});

test('newer messages receive a higher recency score', () => {
  const source = messages(3);
  const oldest = analyzeMessageImportance(source[0], {
    allMessages: source,
    agents: new Map(),
    currentIndex: 0,
  });
  const newest = analyzeMessageImportance(source[2], {
    allMessages: source,
    agents: new Map(),
    currentIndex: 2,
  });

  assert.ok(newest.score > oldest.score);
});

test('buildContextCheckpointSummary generates structured checkpoint text preserving source context', () => {
  const source = messages(5, 50);
  const summary = buildContextCheckpointSummary(source);
  assert.ok(summary.includes('此前对话检查点'));
  assert.ok(summary.includes('message-0'));
  assert.ok(summary.includes('message-4'));
});
