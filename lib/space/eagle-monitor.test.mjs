import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { buildWatchHealth, eagleRuntimeStatus, watchHealthPresentation } from './eagle-monitor.mjs';
import { loadEagleMonitorUI } from './eagle-monitor-ui-fixture.mjs';

const rule = { symbol: 'BTC', period: 'PRICE', direction: 'ABOVE', level: 58000 };
const quote = (now, price = 57000) => ({ symbol: 'BTC', price, realtimeFetchedAt: new Date(now).toISOString(), dataQuality: { ticker: true } });

test('enabled switches and saved conditions never imply a live engine without heartbeat evidence', () => {
  const now = Date.now();
  assert.equal(eagleRuntimeStatus(null, { now, conditions: 2 }).state, 'UNKNOWN');
  assert.equal(eagleRuntimeStatus(null, { enabled: false, now }).state, 'PAUSED');
  const heartbeat = { lastStartedAt: new Date(now - 20000).toISOString(), lastFinishedAt: new Date(now - 10000).toISOString() };
  assert.equal(eagleRuntimeStatus(heartbeat, { now, conditions: 2 }).state, 'HEALTHY');
  assert.equal(eagleRuntimeStatus(heartbeat, { now: now + 100000, conditions: 2 }).state, 'DELAYED');
  assert.equal(eagleRuntimeStatus({ ...heartbeat, errorCode: 'WATCH_SCAN_FAILED' }, { now }).state, 'ERROR');
  assert.equal(eagleRuntimeStatus(heartbeat, { now, conditions: 2, problemTasks: 1 }).state, 'PARTIAL_ERROR');
  assert.equal(eagleRuntimeStatus(heartbeat, { now, conditions: 2, unknownTasks: 1 }).state, 'CHECKING');
});

test('failed quote attempts update checks without fabricating success; recovery keeps the last error', () => {
  const now = Date.now();
  const baseline = buildWatchHealth({ rules: [rule], snapshots: { BTC: quote(now) }, now });
  const failed = buildWatchHealth({ rules: [rule], snapshots: {}, previousHealth: baseline, now: now + 30000 });
  assert.equal(failed.status, 'DATA_ERROR');
  assert.equal(failed.lastSuccessAt, baseline.lastSuccessAt);
  assert.notEqual(failed.lastCheckedAt, baseline.lastCheckedAt);
  assert.equal(failed.samples[0].price, null);
  const repeated = buildWatchHealth({ rules: [rule], snapshots: {}, previousHealth: failed, now: now + 60000 });
  assert.equal(repeated.consecutiveFailures, 2);
  assert.equal(repeated.events.length, failed.events.length, 'repeated failures must not flood event history');
  const recovered = buildWatchHealth({ rules: [rule], snapshots: { BTC: quote(now + 90000) }, previousHealth: repeated, now: now + 90000 });
  assert.equal(recovered.error, null);
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.lastError.at, repeated.error.at);
  assert.equal(recovered.lastSuccessAt, new Date(now + 90000).toISOString());
});

test('cooldown, waiting for candle close and triggered monitoring stay distinct from follow-up execution', () => {
  const now = Date.now();
  const sample = quote(now);
  const cooldown = buildWatchHealth({ rules: [rule], snapshots: { BTC: sample }, event: { price: 59000 }, cooldown: true, now });
  assert.equal(cooldown.status, 'COOLDOWN');
  const task = { status: 'COMPLETED', watchConditions: [rule], watchTriggeredAt: new Date(now).toISOString() };
  assert.equal(watchHealthPresentation(task, now).state, 'TRIGGERED', 'a trigger is a historical fact, not an AI completion status');
  assert.equal(watchHealthPresentation({ ...task, status: 'PENDING', watchTriggeredAt: null, runAt: new Date(now + 3600000).toISOString() }, now).state, 'UNKNOWN');
  const triggered = buildWatchHealth({ rules: [rule], snapshots: { BTC: quote(now, 59000) },
    previousState: { [JSON.stringify(rule)]: { price: 57000, at: now - 30000 } }, event: { price: 59000 }, now });
  assert.equal(triggered.samples[0].state, 'CROSSED');
  assert.match(triggered.samples[0].message, /已发现穿越/);
  assert.doesNotMatch(triggered.samples[0].message, /未发现/);
});

test('monitor details are collapsed by default and do not alter the existing follow-up progress', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { EagleMonitorSummary, TaskEagleMonitor } = loadEagleMonitorUI();
  const now = Date.now();
  const health = buildWatchHealth({ rules: [rule], snapshots: {}, now });
  const info = eagleRuntimeStatus({ lastStartedAt: new Date(now), lastFinishedAt: new Date(now), lastSuccessAt: new Date(now) }, { now, problemTasks: 1, conditions: 1 });
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement('div', null,
      React.createElement('p', null, '跟进进度：正在复查'), React.createElement(EagleMonitorSummary, { info }),
      React.createElement(TaskEagleMonitor, { task: { status: 'PENDING', runAt: new Date(now + 3600000).toISOString(), watchConditions: [rule], watchHealth: health } }))));
    assert.match(document.body.textContent, /跟进进度：正在复查/);
    assert.match(document.body.textContent, /部分条件异常/);
    assert.match(document.body.textContent, /行情获取失败/);
    assert.doesNotMatch(document.body.textContent, /巡检流程最近成功/);
    const button = document.querySelector('[aria-label="鹰眼跟进监测"] button');
    await act(async () => button.dispatchEvent(new window.Event('click', { bubbles: true })));
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.match(document.body.textContent, /巡检流程最近成功/);
    assert.match(document.body.textContent, /跟进进度：正在复查/);
    assert.doesNotMatch(document.body.textContent, /审核完成|复查完成/);
  } finally { await act(async () => root.unmount()); }
});

test('stale cached API status cannot keep a green normal label', () => {
  const { EagleMonitorSummary } = loadEagleMonitorUI();
  const old = new Date(Date.now() - 120000).toISOString();
  const html = renderToStaticMarkup(React.createElement(EagleMonitorSummary, { info: {
    state: 'HEALTHY', label: '监测正常', message: 'Old success', conditions: 1, problemTasks: 0,
    lastStartedAt: old, lastFinishedAt: old, consecutiveFailures: 0,
  } }));
  assert.match(html, /巡检状态已过期/);
  assert.doesNotMatch(html, /监测正常/);
});

test('malformed stored conditions show diagnostics instead of breaking the report UI', () => {
  const { TaskEagleMonitor } = loadEagleMonitorUI();
  const now = Date.now();
  const health = buildWatchHealth({ rules: [], snapshots: {}, now, invalid: true });
  const html = renderToStaticMarkup(React.createElement(TaskEagleMonitor, { detailed: true, task: {
    status: 'PENDING', runAt: new Date(now + 3600000).toISOString(), watchConditions: {}, watchHealth: health,
  } }));
  assert.match(html, /观察条件无效/);
  assert.doesNotMatch(html, /正在复查|审核完成/);
});
