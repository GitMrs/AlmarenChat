import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from './agent-policy.ts';
import * as world from './events.ts';
import { EVENT_MARKET_WINDOWS } from '../crypto/event-market.ts';

const now = new Date('2026-10-20T04:00:00Z');
const event = {
  id: 'macro-adp-weekly-employment-change-2026-10-20', title: '美国ADP周度就业人数变动 (ADP Weekly Employment Change)',
  category: 'macro', timestamp: '2026-10-20T12:15:00.000Z', impactCoins: ['ALL'], volatilityTier: 1,
  forecast: null, previous: '10K',
  source: { provider: 'faireconomy', url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    title: 'ADP Weekly Employment Change', impact: 'Low', fetchedAt: '2026-10-20T03:11:27Z', calendarWeek: '2026-10-18' },
};
const build = (options = {}) => world.buildAgentWorldContext({
  agentId: 'fx-kurumi', query: '今晚有什么数据？', events: [event], now, ...options,
});

test('the four FX agents share identical public event facts while unrelated agents are untouched', async () => {
  const catalogue = JSON.parse(await readFile(new URL('../../src/lib/agent.json', import.meta.url), 'utf8'));
  const identities = ['fx-kurumi', 'fx-mochiko', 'fx-mebuki', 'fx-yasuko'];
  for (const agentId of identities) {
    assert.ok(catalogue.some(agent => agent.identifier === agentId));
    assert.equal(build({ agentId }), build());
  }
  for (const agentId of ['companion-nari', 'ordinary-agent', 'fx-other', null]) {
    assert.equal(build({ agentId }), '');
  }
  const context = build();
  assert.match(context, /20:15/);
  assert.match(context, /ADP Weekly Employment Change/);
  assert.match(context, /"impact":"Low"/);
  assert.match(context, /"forecast":null/);
  assert.match(context, /实际公布值与预期差仍未知/);
  assert.match(context, /保留你原本的角色性格/);
  assert.match(context, /不得替未在场的伙伴说话/);
});

test('financial followups reuse topic context but unrelated chat does not import finance facts', () => {
  const history = [{ role: 'user', content: '今晚ADP有什么影响？' }, { role: 'assistant', content: '日历有一场ADP。' }];
  assert.notEqual(build({ query: '那公布了吗？', history }), '');
  for (const query of ['早上好', '今天吃什么？', '帮我写一个故事', '这个蛋糕真好吃']) {
    assert.equal(build({ query, history }), '');
  }
  assert.equal(build({ query: '然后呢？', history: [...history, { role: 'user', content: '今天吃什么？' }] }), '');
});

test('date and named-topic queries do not substitute another event or day', () => {
  const tomorrow = { ...event, id: 'tomorrow', timestamp: '2026-10-21T12:15:00Z' };
  const morning = { ...event, id: 'morning', timestamp: '2026-10-20T01:00:00Z' };
  const events = [event, tomorrow, morning];
  assert.deepEqual(world.selectPublicFinanceEvents(events, '今晚有什么数据', now).map(item => item.id), [event.id]);
  assert.deepEqual(world.selectPublicFinanceEvents(events, '明天有什么数据', now).map(item => item.id), ['tomorrow']);
  assert.deepEqual(world.selectPublicFinanceEvents(events, '今天有什么数据', now).map(item => item.id), [event.id, 'morning']);
  assert.deepEqual(world.selectPublicFinanceEvents(events, '今晚CPI有多少', now), []);
  const empty = build({ query: '今晚CPI有多少' });
  assert.match(empty, /空列表只表示本地资料没有匹配项/);
  assert.equal(empty.split('\n').at(-1), '[]');
});

test('unverified legacy narratives, simulations and invalid calendar sources cannot become public facts', () => {
  const poisoned = { ...event, impact: { actualValue: '999%', playbookTakeaway: '私有爆仓内幕', marketReaction: {} },
    privatePosition: '私有持仓', source: { ...event.source, privateNote: '其他用户私聊' } };
  const excluded = [
    { ...poisoned, id: 'sim', simulated: true }, { ...poisoned, id: 'manual', source: undefined },
    { ...poisoned, id: 'invalid-time', timestamp: 'invalid' },
    { ...poisoned, id: 'invalid-url', source: { ...event.source, url: 'javascript:alert(1)' } },
    { ...poisoned, id: 'invalid-fetch', source: { ...event.source, fetchedAt: 'invalid' } },
  ];
  const context = build({ events: [poisoned, ...excluded] });
  const facts = JSON.parse(context.split('\n').at(-1));
  assert.equal(facts.length, 1);
  assert.equal(facts[0].id, event.id);
  assert.doesNotMatch(context, /999|私有爆仓内幕|私有持仓|其他用户私聊|javascript:/);
  assert.equal(build({ events: [] }).split('\n').at(-1), '[]');
});

test('the scheduled time passing never confirms a release; only full 24h tracking enters historical facts', () => {
  const at = Date.parse(event.timestamp);
  const later = new Date(at + 25 * 3600_000);
  const makeResult = window => ({
    status: 'complete', baselineAt: new Date(at - 60_000).toISOString(), baselineClose: 100,
    windowStart: event.timestamp, windowEnd: new Date(at + EVENT_MARKET_WINDOWS[window] * 60_000).toISOString(),
    close: 100, high: 100, low: 100, returnPct: 0, highPct: 0, lowPct: 0,
    candleCount: EVENT_MARKET_WINDOWS[window], collectedAt: later.toISOString(),
    sourceUrls: ['https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=1m'],
  });
  const tracked = { ...event, marketObservation: { provider: 'okx', instrument: 'BTC-USDT-SWAP', scheduledAt: event.timestamp,
    stages: { '5m': makeResult('5m') } } };
  const partial = world.selectPublicFinanceEvents([tracked], '上次ADP复盘', later)[0];
  assert.equal(partial.schedulePhase, 'scheduled_time_passed');
  assert.equal(partial.actualValueStatus, 'not_connected');
  assert.equal(partial.marketObservation, undefined);
  tracked.marketObservation.stages['1h'] = makeResult('1h');
  tracked.marketObservation.stages['24h'] = makeResult('24h');
  const complete = world.selectPublicFinanceEvents([tracked], '上次ADP复盘', later)[0];
  assert.equal(complete.marketObservation.windows.length, 3);
  assert.equal(complete.marketObservation.windows[0].returnPct, 0);
  assert.equal(complete.marketObservation.instrument, 'BTC-USDT-SWAP');
  assert.match(complete.marketObservation.windows[2].sourceUrls[0], /www.okx.com/);
});

async function loadServerContext() {
  let calls = 0;
  let events = [event];
  let failure = false;
  const source = await readFile(new URL('./context.ts', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, console: { warn() {} }, Error,
    require(name) {
      if (name === './events.ts') return world;
      if (name === './agent-policy.ts') return policy;
      if (name === '../crypto/event-sync.ts') return { readCryptoEventsFromDisk: async () => {
        calls++;
        if (failure) throw Error('read failed');
        return events;
      } };
      throw Error(name);
    },
  });
  return { ...exports, get calls() { return calls; }, replace: value => { events = value; }, fail: () => { failure = true; } };
}

test('server reads the current calendar only for relevant FX queries and degrades without blocking chat', async () => {
  const loader = await loadServerContext();
  assert.equal(await loader.loadAgentWorldContext({ agentId: 'ordinary', query: 'ADP' }), '');
  assert.equal(await loader.loadAgentWorldContext({ agentId: 'fx-kurumi', query: '你好' }), '');
  assert.equal(loader.calls, 0);
  assert.match(await loader.loadAgentWorldContext({ agentId: 'fx-kurumi', query: 'ADP' }), /共享现实事件/);
  loader.fail();
  assert.equal(await loader.loadAgentWorldContext({ agentId: 'fx-kurumi', query: 'ADP' }), policy.WORLD_EVENTS_UNAVAILABLE_CONTEXT);
  assert.equal(loader.calls, 2);
});
