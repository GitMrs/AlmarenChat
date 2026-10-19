import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateEventPhase,
  formatCountdownMinutes,
  filterEventsForSpace,
  getHistoricalPlaybook,
  buildEventRadarContext,
  loadGlobalCryptoEvents,
} from './event-temporal.ts';
import { persistEventImpact } from './event-sync.ts';

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
  const allEvents = loadGlobalCryptoEvents();
  const playbooks = getHistoricalPlaybook(allEvents, 'macro', 2);

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
    now: testNow,
    activeSymbols: ['BTC'],
  });

  assert.ok(context.includes('【🚨 宏观与重大事件实时战备雷达】'));
  assert.ok(context.includes('ADP'));
  assert.ok(context.includes('临近决战倒计时'));
  assert.ok(context.includes('25 分钟'));
  assert.ok(context.includes('【📚 历史同类事件复盘与战术剧本参考】'));
  assert.ok(context.includes('实战剧本总结'));
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

test('persistEventImpact successfully updates event impact and closes the data loop', async () => {
  const events = loadGlobalCryptoEvents();
  const targetId = 'macro-adp-weekly-employment-change-2026-10-20';
  const targetEvent = events.find((e) => e.id === targetId);
  assert.ok(targetEvent, 'Target event should exist');

  // 保存原始 impact
  const originalImpact = targetEvent.impact;

  const testImpact = {
    actualValue: '26.0K',
    expectedValue: '25.0K',
    surpriseFactor: 'IN_LINE',
    marketReaction: {
      fiveMinSpikePct: -0.8,
      oneHourTrendPct: 1.2,
      twentyFourHourResult: 'V_REVERSAL',
      liquidationsUsdMillion: 12.5,
    },
    playbookTakeaway: '实战测试复盘：ADP温和放缓符合软着陆，下插后稳步回升',
    optimalAction: '实战测试战术：不追空，回踩支撑确认后低吸',
  };

  const success = await persistEventImpact(targetId, testImpact);
  assert.equal(success, true);

  // 验证内存缓存已更新
  const updatedEvent = loadGlobalCryptoEvents().find((e) => e.id === targetId);
  assert.deepEqual(updatedEvent.impact, testImpact);

  // 验证可被 getHistoricalPlaybook 召回，真正实现闭环！
  const playbooks = getHistoricalPlaybook(loadGlobalCryptoEvents(), 'macro', 5);
  const foundInPlaybook = playbooks.some((p) => p.impact.playbookTakeaway.includes('实战测试复盘'));
  assert.equal(foundInPlaybook, true);

  // 还原
  if (originalImpact) {
    await persistEventImpact(targetId, originalImpact);
  } else {
    delete targetEvent.impact;
    await persistEventImpact(targetId, undefined);
  }
});

