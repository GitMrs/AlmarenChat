import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_LAYERS,
  MEMORY_TYPES,
  isCurrentStateType,
  isExperienceType,
  isLongTermMemoryType,
  isRuleType,
  memoryLayerForType,
  memoryTypeFromSourceType,
  normalizeMemoryType,
} from './memory-taxonomy.mjs';

test('normalizes the shared taxonomy while keeping legacy values readable', () => {
  assert.equal(normalizeMemoryType('fact'), MEMORY_TYPES.STABLE_FACT);
  assert.equal(normalizeMemoryType('method'), MEMORY_TYPES.RULE);
  assert.equal(normalizeMemoryType('TASK'), MEMORY_TYPES.EPISODE);
  assert.equal(normalizeMemoryType('unknown-value'), MEMORY_TYPES.EPISODE);
});

test('maps memory types to distinct lifecycle layers', () => {
  assert.equal(memoryLayerForType('preference'), MEMORY_LAYERS.LONG_TERM);
  assert.equal(memoryLayerForType('plan'), MEMORY_LAYERS.CURRENT_STATE);
  assert.equal(memoryLayerForType('event'), MEMORY_LAYERS.EXPERIENCE);
  assert.equal(memoryLayerForType('rule'), MEMORY_LAYERS.RULE);
  assert.equal(isLongTermMemoryType('decision'), true);
  assert.equal(isCurrentStateType('current_state'), true);
  assert.equal(isExperienceType('event'), true);
  assert.equal(isRuleType('correction'), true);
});

test('keeps sourceType and memory type separate but compatible', () => {
  assert.equal(memoryTypeFromSourceType('CHAT'), MEMORY_TYPES.EPISODE);
  assert.equal(memoryTypeFromSourceType('GAME'), MEMORY_TYPES.EPISODE);
  assert.equal(memoryTypeFromSourceType('preference'), MEMORY_TYPES.PREFERENCE);
});

