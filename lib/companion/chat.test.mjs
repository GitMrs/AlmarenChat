import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { companionCharacters } from './catalog.ts';
import { getCompanionReplyReaction } from './reply.ts';
import { companionEmotions, companionReplyInstruction, createCompanionReplyParser } from './reply-protocol.mjs';
import { buildAgentWorldContext } from '../world/events.ts';

test('every split of the control block preserves text and yields the same emotion', () => {
  const source = '你好 🌸\n[[companion:shy]]';
  for (let split = 0; split <= source.length; split++) {
    const parser = createCompanionReplyParser();
    assert.equal(parser.push(source.slice(0, split)) + parser.push(source.slice(split)) + parser.finish(), '你好 🌸\n');
    assert.equal(parser.emotion, 'shy');
  }
  const parser = createCompanionReplyParser();
  let text = '';
  for (const char of source) text += parser.push(char);
  assert.equal(text + parser.finish(), '你好 🌸\n');
  assert.equal(parser.emotion, 'shy');
});

test('ordinary JSON and code survive; malformed, missing and truncated controls fall back', () => {
  for (const suffix of ['', '[[companion:unknown]]', '[[companion:shy', '[[companion:', '[[compani', '[[c']) {
    const parser = createCompanionReplyParser();
    const body = '示例：{"reply":"hi"}\nx < 2';
    assert.equal(parser.push(body + suffix) + parser.finish(), body);
    assert.equal(parser.emotion, 'calm');
  }
  const parser = createCompanionReplyParser();
  assert.equal(parser.push('正文[[companion:happy]]\n来源说明') + parser.finish(), '正文\n来源说明');
  assert.equal(parser.emotion, 'happy');
});

test('all reply emotions resolve to real per-character motions and expression files', async () => {
  for (const character of companionCharacters) {
    for (const emotion of [...companionEmotions, '__proto__', 'invalid', undefined]) {
      const reaction = getCompanionReplyReaction(character, emotion);
      assert.ok(character.motions.some(item => item.id === reaction.motionId));
      assert.ok(character.expressions.some(item => item.id === reaction.expressionId));
      if (!reaction.expressionId) continue;
      const root = new URL('../../public' + character.modelRoot + '/', import.meta.url);
      if (character.engine === 'cubism') {
        const model = JSON.parse(await readFile(new URL(character.modelFile, root), 'utf8'));
        const entry = model.FileReferences.Expressions.find(item => item.Name === reaction.expressionId);
        assert.ok(entry);
        await readFile(new URL(entry.File, root));
      } else {
        await readFile(new URL(character.assetDir + '/expressions/' + reaction.expressionId + '.koexp.json', root));
      }
    }
  }
});

test('tap and rapid voice selection avoids the previous subtitle and preserves MP3 indexes', async () => {
  const source = await readFile(new URL('./voice.ts', import.meta.url), 'utf8');
  const dataset = JSON.parse(await readFile(new URL('./voice-dataset.json', import.meta.url), 'utf8'));
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const math = Object.create(Math);
  math.random = () => 0;
  vm.runInNewContext(output, { exports, Math: math, require: () => ({ default: dataset }) });
  for (const characterId of ['nari', 'yume', 'lafei', 'mao']) {
    for (const name of ['getRandomTapLine', 'getRapidTapLine']) {
      const first = exports[name](characterId);
      const second = exports[name](characterId, first.text);
      assert.notEqual(second.text, first.text, `${characterId} ${name} must skip the previous subtitle`);
      if (second.audioUrl) {
        const index = dataset[characterId].tap.findIndex(line => line.text === second.text);
        assert.ok(second.audioUrl.endsWith(`/tap_${String(index + 1).padStart(2, '0')}.mp3`));
      }
    }
  }
});

test('Mao tap and rapid reactions only select supported expressions', async () => {
  const source = await readFile(new URL('./behaviors/mao.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const character = companionCharacters.find(item => item.id === 'mao');
  const math = Object.create(Math);
  const exports = {};
  vm.runInNewContext(output, { exports, Math: math });
  const behavior = exports.maoBehavior;
  const reactions = [behavior.getRapidTapReaction(character, '')];
  for (const value of [0, 0.3, 0.6, 0.9]) {
    math.random = () => value;
    reactions.push(behavior.getRandomTapReaction(character, ''));
  }
  for (const reaction of reactions) assert.ok(character.expressions.some(item => item.id === reaction.targetExpression));
});

const routeSource = await readFile(new URL('../../app/api/chat/route.ts', import.meta.url), 'utf8');
const routeOutput = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

async function callChatRoute({ companionMode = true, agentId = 'companion-mao', resolvedAgentId = agentId, message = '你好', fail = false, worldLoader = async () => '' } = {}) {
  const saved = [];
  let modelMessages;
  const db = {
    user: { findUnique: async () => ({ email: 'test@example.com' }) },
    conversation: { findFirst: async () => ({ agentId: resolvedAgentId }), update: async () => ({}) },
    message: { findMany: async () => [], create: async ({ data }) => { saved.push(data); return data; } },
  };
  const exports = {};
  vm.runInNewContext(routeOutput, {
    exports, console, Response, ReadableStream, TextEncoder, AbortController,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: data => Response.json(data) } };
      if (name === 'node:fs/promises') return {};
      if (name === 'node:path') return {};
      if (name.endsWith('/db')) return { default: db };
      if (name.endsWith('/auth')) return { requireAuth: () => 'test-user' };
      if (name.endsWith('/companion/agents')) return { findCompanionAgent: id => id === 'companion-mao' ? { id } : undefined };
      if (name.endsWith('/reply-protocol.mjs')) return { companionReplyInstruction, createCompanionReplyParser };
      if (name.endsWith('/auto-web')) return {
        createChatWebTools: () => ({ attachments: () => [] }),
        runAutoWebChat: async ({ messages, onText }) => {
          modelMessages = messages;
          if (fail) throw new Error('Model unavailable');
          const text = companionMode && agentId === 'companion-mao' ? '你好喵\n[[companion:happy]]' : '普通回复';
          for (const char of text) onText(char);
          return text;
        },
      };
      if (name.endsWith('/model-client')) return { createModelClient: () => ({}), resolveModelName: () => 'test-model' };
      if (name.endsWith('/chat-quota')) return { reserveChatQuota: async () => null };
      if (name.endsWith('/agent-memory')) return { loadAgentMemoryContext: async () => '' };
      if (name.endsWith('/world/context')) return { loadAgentWorldContext: worldLoader };
      if (name.endsWith('/current-time-context.mjs')) return { currentTimeContext: () => '' };
      if (name.endsWith('/user-memory')) return { loadUserMemoryItems: async () => [], buildUserMemoryContext: () => '' };
      if (name.endsWith('/context-compression')) return { estimateMessagesTokens: () => 0 };
      if (name.endsWith('/model-limits.mjs')) return { conversationContextTargetTokens: () => 1000 };
      if (name.endsWith('/knowledge')) return {};
      throw new Error('Unexpected import: ' + name);
    },
  });
  const response = await exports.POST({ json: async () => ({ message, conversationId: 'test-conversation', agentId, companionMode }) });
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  return { events, saved, modelMessages };
}

test('shared chat route streams and saves pure dialogue, emitting emotion separately', async () => {
  const { events, saved, modelMessages } = await callChatRoute();
  assert.equal(events.filter(event => event.type === 'text_delta').map(event => event.text).join(''), '你好喵\n');
  assert.equal(saved.filter(message => message.role === 'assistant').length, 1);
  assert.equal(saved.at(-1).content, '你好喵\n');
  assert.deepEqual(events.filter(event => event.type === 'companion_cue'), [{ type: 'companion_cue', emotion: 'happy' }]);
  assert.ok(modelMessages[0].content.includes(companionReplyInstruction));
});

test('ordinary chat keeps its output and prompt; model errors do not create replies or cues', async () => {
  for (const options of [{ companionMode: false }, { agentId: 'ordinary-agent' }]) {
    const { events, saved, modelMessages } = await callChatRoute(options);
    assert.equal(saved.at(-1).content, '普通回复');
    assert.ok(events.every(event => event.type !== 'companion_cue'));
    assert.ok(modelMessages.every(message => !message.content.includes(companionReplyInstruction)));
  }
  const { events, saved } = await callChatRoute({ fail: true });
  assert.ok(events.some(event => event.type === 'error'));
  assert.ok(saved.every(message => message.role !== 'assistant'));
});

test('FX chat injects shared facts using the owned conversation identity in either display mode', async () => {
  const events = [{
    id: 'adp', title: 'ADP周度就业', category: 'macro', timestamp: '2026-10-20T12:15:00Z',
    impactCoins: ['ALL'], volatilityTier: 1,
    source: { provider: 'faireconomy', url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      title: 'ADP Weekly Employment Change', impact: 'Low', fetchedAt: '2026-10-20T00:00:00Z', calendarWeek: '2026-10-18' },
  }];
  const now = new Date('2026-10-20T04:00:00Z');
  let calls = 0;
  for (const resolvedAgentId of ['fx-kurumi', 'fx-mochiko', 'fx-mebuki', 'fx-yasuko']) {
    const contexts = [];
    for (const companionMode of [false, true]) {
      const { saved, modelMessages } = await callChatRoute({
        agentId: 'requested-other-agent', resolvedAgentId, message: '今晚有什么数据？', companionMode,
        worldLoader: async options => {
          calls++;
          assert.equal(options.agentId, resolvedAgentId);
          return buildAgentWorldContext({ ...options, events, now });
        },
      });
      contexts.push(modelMessages[0].content);
      assert.match(modelMessages[0].content, /ADP周度就业/);
      assert.match(modelMessages[0].content, /20:15/);
      assert.match(modelMessages[0].content, /实际公布值与预期差仍未知/);
      assert.equal(saved.at(-1).content, '普通回复');
    }
    assert.equal(contexts[0], contexts[1]);
  }
  assert.equal(calls, 8);
});
