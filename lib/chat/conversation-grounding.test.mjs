import assert from 'node:assert/strict';
import test from 'node:test';
import { CONVERSATION_GROUNDING_GUIDANCE } from './conversation-grounding.mjs';

test('conversation grounding keeps memories relevant and factual', () => {
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /直接回答用户最新一句/);
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /只在与当前问题直接相关时使用/);
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /不要补写日期、地点、计划/);
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /【对话状态】/);
  assert.doesNotMatch(CONVERSATION_GROUNDING_GUIDANCE, /历史消息时间/);
});
