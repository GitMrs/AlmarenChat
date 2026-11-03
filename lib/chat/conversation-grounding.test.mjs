import assert from 'node:assert/strict';
import test from 'node:test';
import { CONVERSATION_GROUNDING_GUIDANCE } from './conversation-grounding.mjs';

test('conversation grounding keeps memories relevant and factual', () => {
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /当前 Agent 自己的人设/);
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /只在与当前问题直接相关时使用/);
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /涉及用户个人事实、计划或经历时不要编造/);
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /【对话状态】/);
  assert.doesNotMatch(CONVERSATION_GROUNDING_GUIDANCE, /历史消息时间/);
});
