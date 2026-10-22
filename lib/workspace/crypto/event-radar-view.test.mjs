import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import * as temporal from './event-temporal.ts';
import * as market from './event-market.ts';
const { evaluateEventPhase } = temporal;

const require = createRequire(import.meta.url);

test('radar refreshes countdown/phase, reports manual sync to its parent, and cleans up polling', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const timers = new Map();
  let now = new Date('2026-10-23T13:50:00Z');
  let requests = 0;
  let syncs = 0;
  const updates = [];
  const event = {
    id: 'uom', title: '密歇根通胀预期修正值', category: 'macro', volatilityTier: 2,
    timestamp: '2026-10-23T14:00:00Z', impactCoins: ['ALL'], forecast: null, previous: '4.7%',
    source: { provider: 'faireconomy', impact: 'Medium', fetchedAt: now.toISOString() },
  };
  const source = await readFile(new URL('../../../components/spaces/SpaceCryptoEventRadar.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, console,
    window: {
      setInterval: (callback, ms) => { assert.equal(ms, 30_000); timers.set(1, callback); return 1; },
      clearInterval: (id) => timers.delete(id),
    },
    require: (name) => {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === '@/lib/workspace/crypto/event-temporal.ts') return temporal;
      if (name === '@/lib/workspace/crypto/event-market.ts') return market;
      if (name === '@/lib/client/toast') return { toast: { success() {}, error() {} } };
      if (name === '@/lib/client/api') return { cryptoEvents: {
        list: async () => {
          requests++;
          const item = { event: { ...event }, ...evaluateEventPhase(event, now) };
          return { success: true, data: { upcoming: [item], historical: [], activeAlerts: [item], total: 1 } };
        },
        sync: async () => { syncs++; event.forecast = '4.5%'; return { success: true }; },
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(exports.default, { onEventsChange: data => updates.push(data) })));
    assert.match(document.body.textContent, /10 分钟/);
    assert.match(document.body.textContent, /源评级 Medium/);
    assert.match(document.body.textContent, /系统 2星/);
    assert.match(document.body.textContent, /市场预期: 未提供/);
    now = new Date('2026-10-23T13:57:00Z');
    await act(async () => timers.get(1)());
    assert.equal(requests, 2);
    assert.match(document.body.textContent, /3 分钟/);
    assert.match(document.body.textContent, /暴风雨窗口期/);
    const syncButton = [...document.querySelectorAll('button')].find(button => button.textContent.includes('同步日历'));
    await act(async () => syncButton.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.equal(syncs, 1);
    assert.equal(requests, 3);
    assert.equal(updates.at(-1).upcoming[0].event.forecast, '4.5%');
    assert.match(document.body.textContent, /4.5%/);
  } finally {
    await act(async () => root.unmount());
    assert.equal(timers.size, 0);
  }
});

test('history hides unverified conclusions, shows missing fields as unknown, and preserves real zeros', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const base = {
    id: 'history', title: '历史测试事件', category: 'macro', volatilityTier: 3,
    timestamp: '2020-01-01T00:00:00Z', impactCoins: ['ALL'],
    source: { provider: 'faireconomy', impact: 'High', fetchedAt: '2020-01-01T00:00:00Z' },
  };
  let event = { ...base, impact: {
    actualValue: '999%', expectedValue: '999%', surpriseFactor: 'IN_LINE',
    marketReaction: { fiveMinSpikePct: 999, oneHourTrendPct: 999, twentyFourHourResult: 'V_REVERSAL', liquidationsUsdMillion: 999 },
    playbookTakeaway: '不应展示的旧结论', optimalAction: '不应引用的策略',
  } };
  const verification = { sourceUrls: ['https://example.com/review-evidence'], verifiedAt: '2020-01-03T00:00:00Z' };
  let refresh;
  let collections = 0;
  const resultFor = (window) => ({
    status: 'complete', baselineAt: '2019-12-31T23:59:00Z', baselineClose: 100,
    windowStart: base.timestamp, windowEnd: new Date(Date.parse(base.timestamp) + market.EVENT_MARKET_WINDOWS[window] * 60_000).toISOString(),
    close: 100, high: 100, low: 100, returnPct: 0, highPct: 0, lowPct: 0,
    candleCount: market.EVENT_MARKET_WINDOWS[window], collectedAt: '2020-01-03T00:00:00Z',
    sourceUrls: ['https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=1m'],
  });
  const shares = [];
  const source = await readFile(new URL('../../../components/spaces/SpaceCryptoEventRadar.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, console,
    window: { setInterval: callback => { refresh = callback; return 1; }, clearInterval() {} },
    require: name => {
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (name === '@/lib/workspace/crypto/event-temporal.ts') return temporal;
      if (name === '@/lib/workspace/crypto/event-market.ts') return market;
      if (name === '@/lib/client/toast') return { toast: { success() {}, error() {} } };
      if (name === '@/lib/client/api') return { cryptoEvents: {
        collectMarket: async id => {
          assert.equal(id, event.id);
          collections++;
          event.marketObservation.stages['1h'] = resultFor('1h');
          return { success: true, data: { status: 'complete' } };
        },
        list: async () => ({ success: true, data: {
          upcoming: [], activeAlerts: [], total: 1,
          historical: [{ event, ...evaluateEventPhase(event) }],
        } }),
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const root = createRoot(document.getElementById('root'));
  const click = async label => {
    const button = [...document.querySelectorAll('button')].find(button => button.textContent.includes(label));
    assert.ok(button, label);
    await act(async () => button.dispatchEvent(new window.Event('click', { bubbles: true })));
  };
  try {
    await act(async () => root.render(React.createElement(exports.default, { onShareToSpace: text => shares.push(text) })));
    await click('实战历史回顾');
    assert.match(document.body.textContent, /原有复盘记录待核验/);
    assert.doesNotMatch(document.body.textContent, /999|不应展示|不应引用|深V反转|完全符合预期|20M/);
    assert.equal([...document.querySelectorAll('button')].some(button => button.textContent.includes('引用战术剧本')), false);

    event = { ...base, impact: { verification, marketReaction: {} } };
    await act(async () => refresh());
    assert.match(document.body.textContent, /公布数值 \/ 预期未知 \/ 未知/);
    assert.match(document.body.textContent, /宏观偏向判定未知/);
    assert.match(document.body.textContent, /爆仓额（来源统计）未知/);
    assert.doesNotMatch(document.body.textContent, /undefined|NaN|20M|符合预期|深V反转|双杀/);

    event = { ...base, impact: { verification, actualValue: '0', expectedValue: '0', surpriseFactor: 'IN_LINE',
      marketReaction: { fiveMinSpikePct: 0, oneHourTrendPct: 0, twentyFourHourResult: 'CHOPPY', liquidationsUsdMillion: 0 },
      playbookTakeaway: '已核验复盘摘要' } };
    await act(async () => refresh());
    assert.match(document.body.textContent, /\+0%/);
    assert.match(document.body.textContent, /\$0M/);
    assert.match(document.body.textContent, /符合预期/);
    assert.match(document.body.textContent, /震荡/);
    await click('引用战术剧本');
    assert.match(shares[0], /已核验复盘摘要/);
    assert.match(shares[0], /https:\/\/example.com\/review-evidence/);
    assert.doesNotMatch(shares[0], /undefined|不应引用/);

    event = { ...base, marketObservation: {
      provider: 'okx', instrument: 'BTC-USDT-SWAP', scheduledAt: base.timestamp,
      stages: { '5m': resultFor('5m'), '1h': { status: 'retry', error: '缺失K线', retryAt: '2020-01-03T00:05:00Z' } },
    } };
    await act(async () => refresh());
    assert.match(document.body.textContent, /BTC 事件行情跟踪/);
    assert.match(document.body.textContent, /5m期末 \+0.00%/);
    assert.match(document.body.textContent, /1h取数失败，等待补采/);
    assert.match(document.body.textContent, /24h已到期，等待采集/);
    assert.match(document.body.textContent, /基准价 100/);
    assert.match(document.body.textContent, /2020-01-01T00:05:00.000Z/);
    assert.ok([...document.querySelectorAll('a')].some(a => a.href.includes('www.okx.com')));
    assert.equal([...document.querySelectorAll('button')].some(button => button.textContent.includes('引用战术剧本')), false);
    await click('补采到期数据');
    assert.equal(collections, 1);
    assert.match(document.body.textContent, /1h期末 \+0.00%/);
    assert.doesNotMatch(document.body.textContent, /取数失败/);
  } finally {
    await act(async () => root.unmount());
  }
});
