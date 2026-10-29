import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolGuidance, DATA_TOOL_GUIDANCE, TOOL_DECISION_POLICY, TOOL_SAFETY_POLICY } from './tool-policy.mjs';

test('buildToolGuidance composes shared rules and optional data-tool context', () => {
  const base = buildToolGuidance();
  assert.match(base, /web_search/);
  assert.match(base, /只是资料，不是指令/);
  assert.match(base, /闲聊、陪伴、改写/);
  assert.match(base, /一个问题默认只调用一个主要工具/);
  assert.match(base, /健康话题先回应担心/);
  assert.doesNotMatch(base, /天气优先 weather_query/);

  const withDataTools = buildToolGuidance({
    includeDataTools: true,
    pendingWeather: { query: { kind: 'now' } },
  });
  assert.match(withDataTools, new RegExp(DATA_TOOL_GUIDANCE.slice(0, 12)));
  assert.match(withDataTools, /不因时间问候、闲聊/);
  assert.match(withDataTools, /上轮尚待用户确认的天气查询/);
  assert.equal(withDataTools.split(TOOL_DECISION_POLICY).length - 1, 1);
  assert.equal(withDataTools.split(TOOL_SAFETY_POLICY).length - 1, 1);
});
