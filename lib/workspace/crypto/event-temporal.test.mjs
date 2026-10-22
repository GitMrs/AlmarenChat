import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateEventPhase,
  formatCountdownMinutes,
  filterEventsForSpace,
  getHistoricalPlaybook,
  buildEventRadarContext,
  loadGlobalCryptoEvents,
  getVerifiedEventImpact,
  formatEventSurprise,
  formatEventImpactPercent,
  formatEventMarketResult,
} from './event-temporal.ts';

const verifiedHistory = {
  id: 'verified-history', title: '已核验测试事件', category: 'macro',
  timestamp: '2026-10-01T12:30:00Z', impactCoins: ['ALL'], volatilityTier: 3,
  impact: {
    verification: { verifiedAt: '2026-10-03T12:30:00Z', sourceUrls: ['https://example.com/review-evidence'] },
    actualValue: '2.0%', expectedValue: '2.0%', surpriseFactor: 'IN_LINE',
    marketReaction: { fiveMinSpikePct: 0, oneHourTrendPct: 1, twentyFourHourResult: 'CHOPPY' },
    playbookTakeaway: '已核验测试复盘', optimalAction: '仅供参考',
  },
};

test('formatCountdownMinutes formats future and past time correctly', () => {
  assert.equal(formatCountdownMinutes(25), '25 分钟');
  assert.equal(formatCountdownMinutes(135), '2 小时 15 分钟');
  assert.equal(formatCountdownMinutes(60), '1 小时');
  assert.equal(formatCountdownMinutes(24 * 60 + 120), '1 天 2 小时');
  assert.equal(formatCountdownMinutes(-35), '已过去 35 分钟');
  assert.equal(formatCountdownMinutes(-150), '已过去 2 小时 30 分钟');
});

test('evaluateEventPhase accurately classifies the 4 temporal phases', () => {
  const event = {
    id: 'test-cpi',
    title: '测试CPI',
    category: 'macro',
    timestamp: '2026-10-19T12:30:00Z',
    impactCoins: ['ALL'],
    volatilityTier: 3,
    preAlertHours: 24,
    postDigestHours: 4,
  };

  // 1. 决战倒计时 (IMPENDING)：距发布还有 2 小时
  const impendingNow = new Date('2026-10-19T10:30:00Z');
  const impendingRes = evaluateEventPhase(event, impendingNow);
  assert.equal(impendingRes.phase, 'IMPENDING');
  assert.equal(impendingRes.deltaMinutes, 120);
  assert.equal(impendingRes.countdownText, '2 小时');

  // 2. 暴风雨剧变期 (IN_THE_STORM)：发布前 2 分钟至发布后 10 分钟
  const stormNow1 = new Date('2026-10-19T12:28:00Z');
  assert.equal(evaluateEventPhase(event, stormNow1).phase, 'IN_THE_STORM');

  const stormNow2 = new Date('2026-10-19T12:38:00Z');
  assert.equal(evaluateEventPhase(event, stormNow2).phase, 'IN_THE_STORM');

  // 3. 落地消化与复盘期 (DIGESTING)：发布后 1 小时 (在 4 小时 postDigestHours 内)
  const digestingNow = new Date('2026-10-19T13:30:00Z');
  const digestingRes = evaluateEventPhase(event, digestingNow);
  assert.equal(digestingRes.phase, 'DIGESTING');
  assert.equal(digestingRes.deltaMinutes, -60);
  assert.equal(digestingRes.countdownText, '已过去 1 小时');

  // 4. 休眠 (DORMANT)：距发布还有 48 小时 (> 24 小时预警线)
  const distantFuture = new Date('2026-10-17T12:30:00Z');
  assert.equal(evaluateEventPhase(event, distantFuture).phase, 'DORMANT');

  // 5. 休眠 (DORMANT)：发布已过去 24 小时 (> 4 小时消化线)
  const distantPast = new Date('2026-10-20T12:30:00Z');
  assert.equal(evaluateEventPhase(event, distantPast).phase, 'DORMANT');
});

test('filterEventsForSpace isolates altcoin events to relevant spaces', () => {
  const events = [
    { id: 'macro-cpi', title: 'CPI', impactCoins: ['ALL'], volatilityTier: 3 },
    { id: 'tia-unlock', title: 'TIA解锁', impactCoins: ['TIA'], volatilityTier: 3 },
    { id: 'sui-upgrade', title: 'SUI升级', impactCoins: ['SUI'], volatilityTier: 2 },
  ];

  // 空间 A：只做 BTC 和 ETH -> 只看到 ALL，不看到 TIA/SUI
  const spaceAEvents = filterEventsForSpace(events, [], ['BTC', 'ETH']);
  assert.equal(spaceAEvents.length, 1);
  assert.equal(spaceAEvents[0].id, 'macro-cpi');

  // 空间 B：做 TIA 合约 -> 看到 ALL 和 TIA，看不到 SUI
  const spaceBEvents = filterEventsForSpace(events, [], ['TIA-USDT-SWAP']);
  assert.equal(spaceBEvents.length, 2);
  const ids = spaceBEvents.map((e) => e.id);
  assert.ok(ids.includes('macro-cpi'));
  assert.ok(ids.includes('tia-unlock'));
  assert.ok(!ids.includes('sui-upgrade'));

  // 空间 C：包含私有自定义事件
  const customEvents = [
    { id: 'custom-private', title: '私有发布会', impactCoins: ['BTC'], volatilityTier: 1 },
  ];
  const spaceCEvents = filterEventsForSpace(events, customEvents, ['BTC']);
  assert.equal(spaceCEvents.length, 2);
  assert.ok(spaceCEvents.some((e) => e.id === 'custom-private'));
});

test('getHistoricalPlaybook returns structured historical outcomes and takeaways', () => {
  const allEvents = [...loadGlobalCryptoEvents(), verifiedHistory];
  const playbooks = getHistoricalPlaybook(allEvents, 'macro', 2, new Date('2026-10-20T00:00:00Z'));

  assert.ok(playbooks.length > 0);
  const first = playbooks[0];
  assert.ok(first.eventTitle);
  assert.ok(first.impact.marketReaction.twentyFourHourResult);
  assert.ok(first.impact.playbookTakeaway);
  assert.ok(first.impact.optimalAction);
});

test('buildEventRadarContext generates unmistakable prompt context during impending events', () => {
  // 模拟发布前 25 分钟：2026-10-20 11:50:00 UTC (预定 12:15:00 UTC 发布 ADP)
  const testNow = new Date('2026-10-20T11:50:00Z');

  const context = buildEventRadarContext({
    events: [...loadGlobalCryptoEvents(), verifiedHistory],
    now: testNow,
    activeSymbols: ['BTC'],
  });

  assert.ok(context.includes('【🚨 宏观与重大事件实时战备雷达】'));
  assert.ok(context.includes('ADP'));
  assert.ok(context.includes('临近决战倒计时'));
  assert.ok(context.includes('25 分钟'));
  assert.ok(context.includes('【📚 历史同类事件复盘与战术剧本参考】'));
  assert.ok(context.includes('实战剧本总结'));
  assert.ok(context.includes('已核验测试复盘'));
  assert.ok(context.includes('https://example.com/review-evidence'));
});

test('buildEventRadarContext returns empty string when no events are active', () => {
  // 模拟一个没有任何临近事件的时刻 (2026-11-20)
  const quietNow = new Date('2026-11-20T00:00:00Z');

  const context = buildEventRadarContext({
    now: quietNow,
    activeSymbols: ['BTC'],
  });

  assert.equal(context, '');
});

test('radar context distinguishes source rating, system rating and unverified events', () => {
  const event = {
    id: 'test', title: 'ADP Weekly Employment Change', category: 'macro',
    timestamp: '2026-10-20T12:15:00.000Z', impactCoins: ['ALL'], volatilityTier: 1,
    forecast: null, previous: '24.8K',
    source: { provider: 'faireconomy', title: 'ADP Weekly Employment Change', impact: 'Low',
      url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      fetchedAt: '2026-10-20T10:00:00Z', calendarWeek: '2026-10-18' },
  };
  const context = buildEventRadarContext({ events: [event], now: new Date('2026-10-20T11:50:00Z') });
  assert.match(context, /源评级 Low/);
  assert.match(context, /系统评级 1 星/);
  assert.match(context, /市场预期 源未提供/);
  assert.match(context, /影响币种（系统规则）：ALL/);
  const manualContext = buildEventRadarContext({ events: [{ ...event, source: undefined }], now: new Date('2026-10-20T11:50:00Z') });
  assert.match(manualContext, /未记录来源（待核验）/);
});

test('legacy, simulated, premature or future-verified reviews cannot become historical evidence', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const invalid = [
    { ...verifiedHistory, impact: { ...verifiedHistory.impact, verification: undefined } },
    { ...verifiedHistory, simulated: true },
    { ...verifiedHistory, impact: { ...verifiedHistory.impact, verification: { sourceUrls: [], verifiedAt: '2026-10-03T00:00:00Z' } } },
    { ...verifiedHistory, impact: { ...verifiedHistory.impact, verification: { sourceUrls: ['javascript:alert(1)'], verifiedAt: '2026-10-03T00:00:00Z' } } },
    { ...verifiedHistory, impact: { ...verifiedHistory.impact, verification: { sourceUrls: ['https://example.com'], verifiedAt: '2026-10-01T12:50:00Z' } } },
    { ...verifiedHistory, impact: { ...verifiedHistory.impact, verification: { sourceUrls: ['https://example.com'], verifiedAt: '2026-10-21T00:00:00Z' } } },
  ];
  for (const event of invalid) assert.equal(getVerifiedEventImpact(event, now), undefined);
  assert.equal(getHistoricalPlaybook(invalid, 'macro', 5, now).length, 0);
  assert.equal(getHistoricalPlaybook([verifiedHistory], 'macro', 2, now).length, 1);
});

test('missing metrics and surprise judgments remain unknown while explicit zeros remain valid', () => {
  assert.equal(formatEventSurprise({ marketReaction: {} }), '未知');
  assert.equal(formatEventSurprise({ surpriseFactor: 'IN_LINE', marketReaction: {} }), '未知');
  assert.equal(formatEventSurprise({ actualValue: '已公布（见官方快讯）', expectedValue: '2%', surpriseFactor: 'IN_LINE', marketReaction: {} }), '未知');
  assert.equal(formatEventSurprise(verifiedHistory.impact), '符合预期');
  assert.equal(formatEventImpactPercent(), '未知');
  assert.equal(formatEventImpactPercent(NaN), '未知');
  assert.equal(formatEventImpactPercent(0), '+0%');
  assert.equal(formatEventMarketResult(), '未知');
  assert.equal(formatEventMarketResult('CHOPPY'), '震荡');
});

test('Agent context excludes unverified narratives and does not invent absent verified fields', () => {
  const event = loadGlobalCryptoEvents().find(e => e.id === 'macro-adp-weekly-employment-change-2026-10-20');
  const legacy = { ...verifiedHistory, title: '不可引用的旧记录', impact: { ...verifiedHistory.impact, verification: undefined } };
  const sparse = { ...verifiedHistory, impact: { verification: verifiedHistory.impact.verification, marketReaction: {} } };
  const context = buildEventRadarContext({ events: [event, legacy, sparse], now: new Date('2026-10-20T11:50:00Z') });
  assert.doesNotMatch(context, /不可引用的旧记录|符合预期|undefined|NaN|0%/);
  assert.match(context, /公布值 未知，预期差 未知/);
  assert.match(context, /5分钟瞬时波动 未知，1小时走势 未知，24小时形态 未知/);
});

