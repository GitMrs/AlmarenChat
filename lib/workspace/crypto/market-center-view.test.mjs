import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../../../components/spaces/SpaceCryptoCenter.tsx', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const response = data => ({ ok: true, json: async () => ({ success: true, data }) });

async function mountCenter(fetcher, initialState = Promise.resolve({ success: true, data: { updatedAt: 'fixture' } })) {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const timers = new Map();
  let sequence = 0;
  const exports = {};
  vm.runInNewContext(output, {
    exports, console, fetch: fetcher,
    window: { setInterval: () => ++sequence, clearInterval() {} },
    setInterval: () => ++sequence, clearInterval() {},
    setTimeout: (callback, ms) => {
      const id = ++sequence;
      timers.set(id, { callback: () => { timers.delete(id); return callback(); }, ms });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    localStorage: { getItem: () => null, removeItem() {} },
    require(name) {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === './SpaceCryptoEventRadar') return { default: () => null };
      if (name === '@/lib/workspace/crypto/trade-lifecycle') return { calculatePlanRiskReward: () => 2, isPlanExpired: () => false };
      if (name === '@/lib/client/toast') return { toast: {} };
      if (name === '@/lib/client/api') return {
        assistant: { getQQBinding: async () => ({}) },
        spaces: { messages: async () => ({ messages: [] }) },
        cryptoEvents: { list: async () => ({ success: true, data: { activeAlerts: [] } }) },
        cryptoSentinel: { get: () => initialState, save: async () => ({ success: true }) },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const root = createRoot(window.document.getElementById('root'));
  await act(async () => root.render(React.createElement(exports.default, { spaceId: 'fixture', messages: [] })));
  return { window, timers, text: () => window.document.body.textContent,
    close: async () => { await act(async () => root.unmount()); assert.equal(timers.size, 0); } };
}

test('entering the tab shows the first quote before slow analysis or a refresh timer; restoring plans does not restart it', async () => {
  const quote = deferred(), snapshot = deferred(), hydration = deferred();
  const calls = [];
  const view = await mountCenter(async url => {
    calls.push(url);
    return url.includes('mode=quote') ? quote.promise : snapshot.promise;
  }, hydration.promise);
  try {
    assert.equal(calls.length, 2, 'quote and analysis start on mount without advancing timers');
    assert.match(view.text(), /正在获取行情/);
    assert.equal([...view.timers.values()].filter(t => t.ms === 6000).length, 0);
    await act(async () => quote.resolve(response({ symbol: 'BTC', price: 100 })));
    assert.match(view.text(), /BTC 撮合价:\$100/);
    assert.match(view.text(), /正在加载分析指标/);
    assert.doesNotMatch(view.text(), /1H:/, 'missing indicators must not be displayed as zero');
    await act(async () => hydration.resolve({ success: true, data: {
      updatedAt: 'fixture', activePositions: [], reviews: [], ambushPlans: [{
        id: 'plan', symbol: 'BTC', name: 'BTC plan', direction: 'LONG',
        entryMin: 95, entryMax: 100, stopLoss: 90, invalidationPrice: 90,
        takeProfit1: 110, takeProfit2: 120, createdAt: new Date().toISOString(), expiresInHours: 24,
      }],
    } }));
    assert.equal(calls.length, 2, 'hydration must not replace an in-flight market request');
    await act(async () => snapshot.resolve(response({ symbol: 'BTC', price: 100, priceDelta1hPercent: 2 })));
    assert.match(view.text(), /1H: \+2.00%/);
    const poll = [...view.timers.values()].find(t => t.ms === 6000);
    assert.ok(poll, 'periodic refresh starts after the initial request completes');
    await act(async () => poll.callback());
    assert.equal(calls.length, 4);
  } finally { await view.close(); }
});

test('switching symbols ignores responses from the previous symbol', async () => {
  const btcQuote = deferred(), btcSnapshot = deferred();
  const view = await mountCenter(async url => {
    if (url.includes('symbol=BTC')) return url.includes('mode=quote') ? btcQuote.promise : btcSnapshot.promise;
    return response({ symbol: 'ETH', price: 200, priceDelta1hPercent: 3 });
  });
  try {
    const eth = [...view.window.document.querySelectorAll('button')].find(button => button.textContent === 'ETH');
    await act(async () => eth.dispatchEvent(new view.window.Event('click', { bubbles: true })));
    assert.match(view.text(), /ETH 撮合价:\$200/);
    await act(async () => {
      btcQuote.resolve(response({ symbol: 'BTC', price: 100 }));
      btcSnapshot.resolve(response({ symbol: 'BTC', price: 100, priceDelta1hPercent: 99 }));
    });
    assert.match(view.text(), /ETH 撮合价:\$200/);
    assert.match(view.text(), /1H: \+3.00%/);
    assert.doesNotMatch(view.text(), /99.00%/);
  } finally { await view.close(); }
});

test('failed initial requests expose a retry without waiting for the next refresh', async () => {
  let fail = true;
  const view = await mountCenter(async () => fail ? { ok: false } : response({ symbol: 'BTC', price: 100 }));
  try {
    assert.match(view.text(), /行情获取失败，请重试/);
    const retry = view.window.document.querySelector('button[title="刷新行情"]');
    assert.equal(retry.disabled, false);
    fail = false;
    await act(async () => retry.dispatchEvent(new view.window.Event('click', { bubbles: true })));
    assert.match(view.text(), /BTC 撮合价:\$100/);
    assert.doesNotMatch(view.text(), /行情获取失败/);
  } finally { await view.close(); }
});

test('a failed quote refresh falls back to the current snapshot instead of retaining the old price', async () => {
  let refreshing = false;
  const view = await mountCenter(async url => {
    if (refreshing && url.includes('mode=quote')) return { ok: false };
    return response({ symbol: 'BTC', price: refreshing ? 120 : 100 });
  });
  try {
    assert.match(view.text(), /BTC 撮合价:\$100/);
    refreshing = true;
    await act(async () => [...view.timers.values()].find(t => t.ms === 6000).callback());
    assert.match(view.text(), /BTC 撮合价:\$120/);
  } finally { await view.close(); }
});
