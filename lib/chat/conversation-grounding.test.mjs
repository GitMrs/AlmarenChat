import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { CONVERSATION_GROUNDING_GUIDANCE, RESPONSE_GROUNDING_GUIDANCE } from './conversation-grounding.mjs';
import { buildAgentIdentitySystem, buildAgentRuntimeSystem } from './agent-prompt.mjs';

test('conversation grounding keeps memories relevant and factual', () => {
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /当前 Agent 自己的人设/);
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /只在与当前问题直接相关时使用/);
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /涉及用户个人事实、计划或经历时不要编造/);
  assert.match(CONVERSATION_GROUNDING_GUIDANCE, /【对话状态】/);
  assert.doesNotMatch(CONVERSATION_GROUNDING_GUIDANCE, /历史消息时间/);
});

test('Agent chat uses explicit persona text and falls back to profile fields when blank', () => {
  const persona = '你是严肃的代码审查员。输出 JSON：{"issues":[]}。';
  const profile = { name: '审查员', description: '聊天搭子', tone: '温柔' };
  const identity = buildAgentIdentitySystem({ ...profile, systemPrompt: persona });
  assert.ok(identity.startsWith(persona));
  assert.doesNotMatch(identity, /聊天搭子|温柔/);
  const fallback = buildAgentIdentitySystem({ ...profile, systemPrompt: '  ' });
  assert.match(fallback, /【角色描述】聊天搭子/);
  assert.match(fallback, /【表达语气】温柔/);
  for (const channel of ['WEB', 'QQ']) {
    const runtime = buildAgentRuntimeSystem({
      channel, timeContext: '当前时间样例', continuityGuidance: '对话状态样例',
    });
    assert.ok(runtime.includes('当前时间样例'));
    assert.ok(runtime.includes('对话状态样例'));
    assert.equal(runtime.includes('QQ 私聊'), channel === 'QQ');
    assert.doesNotMatch(runtime, /【通用回应边界】/);
  }
});

test('assistant uses shared boundaries without replacing Identity, Soul or optional memory sections', async () => {
  const source = await readFile(new URL('../personal-assistant/prompt-builder.ts', import.meta.url), 'utf8');
  const exports = {};
  const dependencies = {
    '@/lib/chat/conversation-grounding.mjs': { CONVERSATION_GROUNDING_GUIDANCE },
    '@/lib/agents/memory/current-time-context.mjs': { currentTimeContext: () => '当前时间样例' },
    './user-memory': { selectRelevantUserMemories: memories => memories },
  };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  } });
  const options = {
    userName: '测试用户', profile: { name: '小伴', identity: '自定义身份样例', soul: '自定义语气样例' },
    memories: [{ category: 'fact', content: '用户确认的记忆样例' }],
    experienceContext: '历史原文样例', platformContext: null, webEnabled: false,
  };
  const parts = exports.buildAssistantContextParts(options);
  assert.ok(parts.requiredSystem.includes('身份：自定义身份样例'));
  assert.ok(parts.requiredSystem.includes('语气：自定义语气样例'));
  assert.equal(parts.requiredSystem.split(RESPONSE_GROUNDING_GUIDANCE).length - 1, 1);
  assert.doesNotMatch(parts.requiredSystem, /默认追加|每轮最多问一个问题|历史原文样例|用户确认的记忆样例/);
  assert.equal(parts.optional.length, 2);
  assert.ok(parts.optional[0].content.includes('用户确认的记忆样例'));
  assert.ok(parts.optional[1].content.includes('历史原文样例'));
  assert.ok(exports.buildPersonalAssistantPrompt(options).includes('历史原文样例'));
  for (const channel of ['WEB', 'QQ']) {
    const runtime = exports.buildPersonalAssistantRuntimeContext({ channel });
    assert.ok(runtime.includes('当前时间样例'));
    assert.ok(runtime.includes(channel === 'QQ' ? 'QQ 私聊' : '网页个人助理'));
  }
});
