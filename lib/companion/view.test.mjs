import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { companionCharacters } from './catalog.ts';
import { getCompanionReplyReaction } from './reply.ts';
import { primeChatAudio } from './chat-audio.ts';
import * as protocol from './reply-protocol.mjs';

const require = createRequire(import.meta.url);

function createDOM() {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  window.innerHeight = 900;
  window.location = { search: '' };
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollTo = () => {};
  Object.assign(globalThis, {
    window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: callback => { callback(); return 0; },
  });
  return { root: createRoot(document.getElementById('root')), window };
}

async function loadComponent(relativePath, mocks) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, console, process, window, document, URL, URLSearchParams, Blob, Audio: globalThis.Audio,
    fetch: async () => ({ json: async () => ({ topics: [] }) }),
    localStorage: { getItem: () => null, setItem() {} },
    AbortController, TextDecoder, TextEncoder, setTimeout, clearTimeout,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    require(name) {
      if (name in mocks) return mocks[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name.startsWith('@/components/')) return { default: () => null, MessageItem: () => null };
      throw new Error('Unexpected import: ' + name);
    },
  });
  return exports.default;
}

test('companion only plays fresh replies, stops on mute/new requests, and retries blocked audio', async () => {
  const { root, window } = createDOM();
  const audios = [];
  let plays = 0;
  let blockAudio = false;
  globalThis.Audio = class {
    constructor() { audios.push(this); this.duration = 2; }
    load() {}
    removeAttribute() { this.src = ''; }
    pause() { this.onpause?.(); }
    async play() {
      if (this.src?.startsWith('data:')) return;
      if (blockAudio) throw new Error('Autoplay blocked');
      plays++;
      this.onplaying?.();
    }
  };
  const synthesis = [];
  let pending;
  let synthesisFails = false;
  const inputs = new Map();
  const sent = [];
  const jsxRuntime = require('react/jsx-runtime');
  const stage = { speak() {}, stopSpeaking() {}, restart() {} };
  const Stage = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => stage, []);
    React.useEffect(() => { props.onReady(); }, []);
    return null;
  });
  const behavior = {
    initialMotion: 'Idle', idlePool: ['Idle'], quickPrompts: [], tapSymbols: ['✨'],
    getStartupReaction: () => ({}),
  };
  const Component = await loadComponent('../../components/companion/CompanionPreview.tsx', {
    'react/jsx-runtime': { ...jsxRuntime, jsx: (type, props, key) => {
      if (type === 'input' && props.className?.includes('composer-input')) inputs.set(props.className, props);
      return jsxRuntime.jsx(type, props, key);
    } },
    'next/link': { default: ({ children }) => React.createElement('span', null, children) },
    'next/navigation': { useRouter: () => ({}) },
    './CompanionStage': { default: Stage },
    '@/lib/companion/catalog': { companionCharacters },
    '@/lib/companion/behaviors': { getCompanionBehavior: () => behavior },
    '@/lib/companion/reply': { getCompanionReplyReaction },
    '@/lib/companion/chat-audio': { primeChatAudio },
    '@/lib/companion/voice': { getRandomTapLine: () => ({}), getRapidTapLine: () => ({}) },
    '@/lib/tts/markdown-cleaner': { cleanMarkdownForTTS: text => text },
    '@/app/companion/companion.css': {},
    '@/lib/api': { tts: { synthesizeBlob: async (text, options, signal) => {
      synthesis.push({ text, options, signal });
      if (synthesisFails) throw new Error('TTS unavailable');
      return pending ? pending : new Blob(['audio']);
    } } },
  });
  let props = { characterId: 'mao', voice: 'snapshot-voice', draftValue: '中文选词', onSendMessage: async text => { sent.push(text); }, externalMessages: [{ id: 'old', role: 'assistant', content: '历史' }], reply: { id: 'old', content: '历史', emotion: 'calm' } };
  const render = async changes => { props = { ...props, ...changes }; await act(async () => root.render(React.createElement(Component, props))); };
  try {
    await render({});
    assert.equal(synthesis.length, 0, 'opening history must not speak');
    assert.equal(inputs.size, 2, 'desktop and mobile composers must both be protected');
    for (const input of inputs.values()) {
      input.onCompositionStart();
      let prevented = false;
      input.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: () => { prevented = true; } });
      assert.equal(prevented, true, 'candidate Enter must not submit the form');
      await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(sent.length, 0, 'submitting while composing must not send');
      input.onCompositionEnd();
      for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
        prevented = false;
        input.onKeyDown({ key: 'Enter', nativeEvent, preventDefault: () => { prevented = true; } });
        assert.equal(prevented, true);
      }
      prevented = false;
      input.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: () => { prevented = true; } });
      assert.equal(prevented, false, 'confirmed text may be sent with Enter');
    }
    await render({ reply: { id: 'new', content: '新回复', emotion: 'happy' } });
    assert.equal(synthesis.length, 1);
    assert.equal(synthesis[0].options.voice, 'snapshot-voice');
    assert.equal(plays, 1);
    await render({ reply: { ...props.reply } });
    assert.equal(synthesis.length, 1, 'rerender must not repeat synthesis');
    await render({ isStreaming: true, reply: null });
    assert.ok(audios.every(audio => !audio.src));

    let resolveAudio;
    pending = new Promise(resolve => { resolveAudio = resolve; });
    await render({ isStreaming: false, reply: { id: 'pending', content: '等待语音', emotion: 'shy' } });
    assert.ok(document.body.textContent.includes('正在准备语音'));
    await act(async () => document.querySelector('button[aria-label="伴侣对话语音已开启，点击静音"]').dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.equal(synthesis.at(-1).signal.aborted, true);
    assert.equal(document.body.textContent.includes('正在准备语音'), false);
    await act(async () => resolveAudio(new Blob(['late audio'])));
    assert.equal(plays, 1, 'late synthesis must not play after mute');

    await act(async () => document.querySelector('button[aria-label="伴侣对话语音已静音，点击开启"]').dispatchEvent(new window.Event('click', { bubbles: true })));
    pending = null;
    blockAudio = true;
    await render({ reply: { id: 'blocked', content: '重试语音', emotion: 'calm' } });
    const retry = [...document.querySelectorAll('button')].find(button => button.textContent.includes('点此重试'));
    assert.ok(retry);
    const clip = audios.find(audio => audio.src?.startsWith('blob:'));
    assert.ok(clip, 'blocked playback must retain the prepared clip');
    const clipUrl = clip.src;
    const synthesisCount = synthesis.length;
    blockAudio = false;
    await act(async () => {
      retry.dispatchEvent(new window.Event('click', { bubbles: true }));
      assert.equal(plays, 2, 'retry must call play synchronously inside the click gesture');
    });
    assert.equal(plays, 2);
    assert.equal(synthesis.length, synthesisCount, 'retry must not request TTS again');
    assert.equal(clip.src, clipUrl, 'retry must use the same audio element and Blob URL');
    assert.equal(document.body.textContent.includes('点此重试'), false);
    await act(async () => clip.onended());
    assert.equal(clip.src, '', 'completed playback must release the clip');

    pending = new Promise(resolve => { resolveAudio = resolve; });
    await render({ reply: { id: 'cancel', content: '取消合成', emotion: 'calm' } });
    const cancel = [...document.querySelectorAll('button')].find(button => button.textContent.includes('正在准备语音'));
    assert.ok(cancel);
    await act(async () => cancel.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.equal(synthesis.at(-1).signal.aborted, true);
    await act(async () => resolveAudio(new Blob(['cancelled audio'])));
    assert.equal(plays, 2, 'cancelled synthesis must never start playback');
    assert.equal(document.body.textContent.includes('正在准备语音'), false);

    pending = null;
    synthesisFails = true;
    await render({ reply: { id: 'failure', content: '生成失败', emotion: 'calm' } });
    const regenerate = [...document.querySelectorAll('button')].find(button => button.textContent.includes('语音生成失败'));
    assert.ok(regenerate);
    synthesisFails = false;
    await act(async () => regenerate.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.equal(synthesis.at(-1).text, '生成失败');
    assert.equal(plays, 3, 'a synthesis failure must be recoverable by regenerating');

    pending = new Promise(resolve => { resolveAudio = resolve; });
    await render({ reply: { id: 'leaving', content: '退出前合成', emotion: 'calm' } });
    await act(async () => root.unmount());
    assert.equal(synthesis.at(-1).signal.aborted, true);
    await act(async () => resolveAudio(new Blob(['unmounted audio'])));
    assert.equal(plays, 3, 'leaving must suppress late synthesis');
  } finally {
    await act(async () => root.unmount());
  }
  assert.ok(audios.every(audio => !audio.src), 'leaving companion must release audio');
});

test('ChatRoom shares drafts and conversation, excludes hidden attachments/image mode, and cleans local replies', async () => {
  const { root } = createDOM();
  const captured = {};
  const record = name => props => { captured[name] = props; return null; };
  const requests = [];
  const saved = [];
  let imageRequests = 0;
  let params = new URLSearchParams();
  let Component;
  const render = () => root.render(React.createElement(Component, { agentId: 'companion-nari' }));
  const router = { replace: url => { params = new URLSearchParams(url.split('?')[1]); render(); } };
  const agent = { id: 'companion-nari', name: 'Sunny', companionCharacterId: 'nari', voice: 'fish-nari', systemPrompt: 'Sunny persona' };
  const attachment = { type: 'image', url: '/uploads/images/test.png' };
  const tts = { play() {}, stop() {} };
  const api = {
    agents: { get: async () => ({ agent }), getMainConversation: async () => ({ conversation: { id: 'same-conversation', agentId: agent.id } }) },
    user: { get: async () => ({ user: { imageModelEnabled: true, imageApiBaseUrl: 'test', imageApiKey: 'test', imageModelName: 'test' } }) },
    conversations: { list: async () => ({ conversations: [] }), getMessages: async () => ({ messages: [] }), sendMessage: async (id, content, options) => saved.push({ id, content, ...options }) },
    uploads: { image: async () => ({ attachment }) },
    generateConversationImage: async () => { imageRequests++; },
    streamChat: async data => {
      requests.push(data);
      data.onCompanionCue('happy');
      return { stream: new Response('在线回复').body, conversationId: 'same-conversation' };
    },
  };
  Component = await loadComponent('../../components/chat/ChatRoom.tsx', {
    'next/navigation': { useRouter: () => router, useSearchParams: () => params },
    'react-markdown': { default: () => null }, 'remark-gfm': { default: () => null },
    '@/components/chat/AgentDetailsPanel': { default: record('details') },
    '@/components/chat/ChatComposer': { default: record('composer') },
    '@/components/companion/CompanionPreview': { default: record('companion') },
    '@/hooks/useTTS': { useTTS: () => tts },
    '@/lib/agents-data': { getBuiltInAgents: async () => [agent] },
    '@/lib/companion/agents': { getCompanionCharacterId: () => 'nari' },
    '@/lib/companion/reply-protocol.mjs': protocol,
    '@/lib/api': api,
    '@/lib/browser-model': {
      DEFAULT_BROWSER_MODEL_CONFIG: {}, readBrowserModelConfigForScope: () => ({ source: 'ONLINE' }), saveBrowserModelConfig: config => config,
      streamBrowserModel: async () => new Response('本地回复[[companion:shy]]').body,
    },
    '@/lib/utils': { cn: (...values) => values.filter(value => typeof value === 'string').join(' ') },
    '@/types': { CATEGORY_COLORS: {} },
    '@/lib/personal-assistant/memory-intent.mjs': { shouldExtractMemorySuggestion: () => false },
  });
  try {
    await act(async () => render());
    await act(async () => captured.composer.onCompositionStart());
    const composingTarget = { value: '中'.repeat(2001) };
    await act(async () => captured.composer.onInput({ currentTarget: composingTarget, nativeEvent: { isComposing: true } }));
    assert.equal(captured.composer.draftValue, composingTarget.value, 'composition must not clear a long draft');
    assert.equal(captured.composer.pendingLargeTextMeta, null);
    await act(async () => captured.composer.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault: () => assert.fail('candidate Enter must be left to IME') }));
    await act(async () => captured.composer.onSend());
    assert.equal(requests.length, 0, 'send must not interrupt composition');
    await act(async () => captured.composer.onCompositionEnd({ currentTarget: { value: '中文输入' } }));
    assert.equal(captured.composer.draftValue, '中文输入');
    for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
      await act(async () => captured.composer.onKeyDown({ key: 'Enter', nativeEvent, preventDefault: () => assert.fail('candidate Enter must not send') }));
    }
    assert.equal(requests.length, 0);
    const longTarget = { value: '长'.repeat(2001) };
    await act(async () => captured.composer.onInput({ currentTarget: longTarget, nativeEvent: {} }));
    assert.equal(longTarget.value.length, 2001, 'normalization must not write to the textarea DOM');
    assert.equal(captured.composer.pendingLargeTextMeta.chars, 2001);
    await act(async () => captured.composer.onPaste({ clipboardData: { files: [], getData: () => '粘'.repeat(2002) }, preventDefault() {} }));
    assert.equal(captured.composer.pendingLargeTextMeta.chars, 2002);
    await act(async () => captured.composer.onInput({ currentTarget: { value: '未发送的草稿' }, nativeEvent: {} }));
    assert.equal(captured.composer.draftValue, '未发送的草稿', 'typing immediately after paste must not be discarded');
    assert.equal(captured.composer.pendingLargeTextMeta, null);
    await act(async () => captured.details.onToggleCompanionView());
    assert.equal(captured.companion.draftValue, '未发送的草稿');
    await act(async () => captured.companion.onDraftChange('陪伴里修改的草稿'));
    await act(async () => captured.details.onToggleCompanionView());
    assert.equal(captured.composer.draftValue, '陪伴里修改的草稿');

    await act(async () => captured.composer.onModeChange('image'));
    await act(async () => captured.composer.onImageSelect({ target: { files: [{ type: 'image/png' }], value: '' } }));
    await act(async () => captured.details.onToggleCompanionView());
    await act(async () => captured.companion.onSendMessage('陪伴里修改的草稿'));
    assert.equal(imageRequests, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].conversationId, 'same-conversation');
    assert.equal(requests[0].attachments.length, 0);
    assert.equal(captured.companion.reply.emotion, 'happy');
    assert.equal(captured.companion.draftValue, '');
    await act(async () => captured.details.onToggleCompanionView());
    assert.equal(captured.composer.pendingAttachment.url, attachment.url, 'hidden attachment must remain unsent');

    await act(async () => captured.composer.onModelSourceChange('OLLAMA'));
    await act(async () => captured.details.onToggleCompanionView());
    assert.equal(captured.companion.reply, null, 'reentering must not replay a completed reply');
    await act(async () => captured.companion.onSendMessage('本地聊天'));
    assert.equal(captured.companion.reply.content, '本地回复');
    assert.equal(captured.companion.reply.emotion, 'shy');
    assert.equal(saved.at(-1).content, '本地回复');
    assert.equal(saved.at(-1).id, 'same-conversation');
    await act(async () => captured.details.onToggleCompanionView());
    await act(async () => captured.composer.onClearAttachment());
    await act(async () => captured.composer.onModeChange('chat'));
    await act(async () => captured.composer.onModelSourceChange('ONLINE'));
    await act(async () => captured.composer.onInput({ currentTarget: { value: '选词完成后发送' }, nativeEvent: {} }));
    let prevented = false;
    await act(async () => captured.composer.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: {}, preventDefault: () => { prevented = true; } }));
    assert.equal(prevented, true);
    assert.equal(requests.length, 2, 'normal Enter must still send once');
  } finally {
    await act(async () => root.unmount());
  }
});
