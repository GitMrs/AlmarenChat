import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODEL_CONTEXT_WINDOW_OPTIONS,
  conversationContextTargetTokens,
  modelTokenLimits,
  recommendedModelContextWindow,
  taskContextTargetTokens,
} from './model-limits.mjs';

test('offers the supported global context windows', () => {
  assert.deepEqual(MODEL_CONTEXT_WINDOW_OPTIONS, [32_768, 65_536, 131_072, 200_000, 262_144, 1_048_576]);
});

test('uses one conservative default without inspecting model names', () => {
  assert.equal(recommendedModelContextWindow('gemini-3.8-flash'), 131_072);
  assert.equal(recommendedModelContextWindow('custom-model'), 131_072);
});

test('derives different automatic budgets from one model capacity', () => {
  const limits = modelTokenLimits('custom-model', 131_072);
  assert.equal(limits.contextWindow, 131_072);
  assert.equal(conversationContextTargetTokens('custom-model', 131_072), 32_768);
  assert.equal(taskContextTargetTokens('custom-model', 131_072), 10_485);
});

test('keeps small windows usable and caps task carry-over', () => {
  assert.equal(conversationContextTargetTokens('custom-model', 32_768), 8_192);
  assert.equal(taskContextTargetTokens('gemini-3.8-flash', 1_048_576), 32_000);
  assert.equal(modelTokenLimits('gemini-3.8-flash', 1_048_576).maxTokens, 32_768);
});
