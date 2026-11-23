import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as release from './event-release.ts';

const at = '2026-11-23T14:45:00.000Z';
const clock = Date.parse('2026-11-23T14:50:00.000Z');
const before = '2026-11-23T02:56:00.000Z';
const sourceUrl = 'https://api.nasdaq.com/api/calendar/economicevents?date=2026-11-24';
const event = (extra = {}) => ({ id: 'pmi', category: 'macro', title: '美国制造业 PMI', timestamp: at,
  impactCoins: ['ALL'], volatilityTier: 2, forecast: '54.5', previous: '56.0', calendarRecordedAt: before,
  source: { provider: 'faireconomy', title: 'Flash Manufacturing PMI', fetchedAt: before }, ...extra });
const published = (extra = {}) => ({ status: 'published', scheduledAt: at, checkedAt: new Date(clock).toISOString(), attempts: 1,
  forecast: '54.5', previous: '56.0', forecastRecordedAt: before, actual: '55.2',
  source: { provider: 'nasdaq', url: sourceUrl, title: 'S&P Global Manufacturing PMI', fetchedAt: new Date(clock).toISOString() }, ...extra });

class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
async function load(file, dependencies) {
  const text = await readFile(new URL(file, import.meta.url), 'utf8');
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, console, Date: ClockDate, URL, Intl, globalThis: {},
    require(name) { if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected dependency: ${name}`); } });
  return exports;
}
const source = await load('./event-release-source.ts', {
  './event-release.ts': release, '../../web/proxy.ts': { smartFetch: async () => assert.fail('no network') },
});
function sourceDay(rows, date = '2026-11-23') {
  return source.parseReleaseSourceDay({ status: { rCode: 200 }, data: { rows } }, date, new Date(clock).toISOString());
}
const raw = (extra = {}) => ({ gmt: '09:45', country: 'United States', eventName: 'S&P Global Manufacturing PMI',
  actual: '55.2', consensus: '54.5', previous: '54.9', ...extra });

function collectorFixture(initial, fetcher) {
  const events = structuredClone(initial);
  const requests = [];
  const writes = [];
  return load('./event-release-collector.ts', {
    './event-release.ts': release,
    './event-release-source.ts': { ...source, fetchReleaseSourceDay: async date => { requests.push(date); return fetcher(date); } },
    './event-sync.ts': {
      readCryptoEventsFromDisk: async () => structuredClone(events),
      persistEventRelease: async (id, scheduledAt, record) => {
        const target = events.find(e => e.id === id && e.timestamp === scheduledAt);
        if (!target) return false;
        target.release = structuredClone(record); writes.push(target.release); return true;
      },
    },
  }).then(api => ({ ...api, events, requests, writes }));
}

test('strict number parsing preserves zero and converts K/M/B units; never parses missing values or ranges as scalars', () => {
  assert.equal(release.cleanReleaseValue(0), '0');
  for (const missing of ['', '&nbsp;', '—', 'N/A', null, undefined]) assert.equal(release.cleanReleaseValue(missing), null);
  for (const invalid of ['4.00%-4.25%', '1,23K', '1.2% text', '<b>3</b>', 'Infinity', true]) assert.equal(release.parseReleaseNumber(invalid), null);
  assert.equal(release.compareReleaseValues('203K', '0.198M').delta, 5000);
  assert.equal(release.compareReleaseValues('0%', '0.1%').text, '-0.1 个百分点');
  assert.equal(release.compareReleaseValues('3%', '3'), null);
  assert.equal(release.compareReleaseValues('0', '0').direction, 'inline');
});

test('PMI may beat forecast while falling from prior; growth strength never forces BTC bullishness', () => {
  const p = release.getReleasePresentation(event({ release: published() }), new Date(clock));
  assert.equal(p.surprise.delta, 0.7); assert.equal(p.change.delta, -0.8);
  assert.equal(p.result, '高于日历预期'); assert.equal(p.bias, 'MIXED');
  assert.ok(p.previousDiffers === false);
  const different = release.getReleasePresentation(event({ release: published({ sourcePrevious: '54.9' }) }), new Date(clock));
  assert.equal(different.previousDiffers, true);
  assert.match(release.formatEventReleaseContext(event({ release: published({ sourcePrevious: '54.9' }) }), new Date(clock)), /未确认为官方修正/);
});

test('inflation uses its own policy path; missing/prepublication/late/conflicting baselines stay unknown', () => {
  const cpi = extra => event({ source: { title: 'CPI m/m' }, ...extra });
  const good = published({ actual: '0.1%', forecast: '0.2%', previous: '0.3%' });
  assert.equal(release.getReleasePresentation(cpi({ release: good }), new Date(clock)).bias, 'BULLISH');
  assert.equal(release.getReleasePresentation(cpi({ release: { ...good, actual: '0.3%' } }), new Date(clock)).bias, 'BEARISH');
  assert.equal(release.getReleasePresentation(cpi({ release: { ...good, actual: '0.2%' } }), new Date(clock)).bias, 'NEUTRAL');
  for (const extra of [{ forecast: null }, { forecastRecordedAt: new Date(clock).toISOString() }, { sourceForecast: '0.4%' }]) {
    assert.equal(release.getReleasePresentation(cpi({ release: { ...good, ...extra } }), new Date(clock)).bias, 'UNKNOWN');
  }
  assert.equal(release.getPublishedRelease(event({ release: published() }), new Date(Date.parse(at) - 1)), undefined);
  assert.equal(release.getPublishedRelease(event({ release: published({ scheduledAt: '2026-11-24T14:45:00Z' }) }), new Date(clock)), undefined);
  assert.equal(release.getPublishedRelease(event({ release: published({ source: { provider: 'nasdaq', url: 'https://evil.test', fetchedAt: new Date(clock).toISOString() } }) }), new Date(clock)), undefined);
});

test('speech, unrecognized components and simulated events do not invent numerical results', () => {
  assert.equal(release.getMacroIndicator(event({ source: { title: 'Flash Services PMI' } })).key, 'flash-services-pmi');
  assert.equal(release.getMacroIndicator(event({ source: { title: 'Core CPI y/y' } })).key, 'core-cpi-yy');
  const speech = release.getReleasePresentation(event({ source: { title: 'FOMC Press Conference' } }), new Date(clock));
  assert.equal(speech.supported, false); assert.match(speech.status, /文字事件/);
  assert.equal(release.getMacroIndicator(event({ source: { title: 'ADP Weekly Employment Change' } })), undefined);
  assert.equal(release.getPublishedRelease(event({ simulated: true, release: published() }), new Date(clock)), undefined);
});

test('source adapter handles US-date query boundaries and accepts exactly one US series at its own local time', () => {
  assert.match(source.releaseSourceUrl('2026-11-23'), /date=2026-11-24$/);
  assert.match(source.releaseSourceUrl('2026-12-31'), /date=2027-01-01$/);
  assert.throws(() => source.releaseSourceUrl('2026-02-30'));
  const day = sourceDay([raw(), raw({ eventName: 'S&P Global Services PMI', actual: '60.1' }), raw({ country: 'Australia', actual: '48.7' })]);
  assert.equal(source.matchReleaseSource(event(), day).row.actual, '55.2');
  assert.equal(source.matchReleaseSource(event(), sourceDay([raw({ gmt: '10:45' })])).row, undefined);
  assert.equal(source.matchReleaseSource(event(), sourceDay([raw(), raw()])).row, undefined);
  assert.equal(source.matchReleaseSource(event(), sourceDay([raw()], '2026-11-24')).row, undefined);
  const summer = event({ timestamp: '2026-06-23T13:45:00Z' });
  assert.equal(source.matchReleaseSource(summer, sourceDay([raw({ gmt: '08:45' })], '2026-06-23')).row.actual, '55.2');
  assert.equal(source.matchReleaseSource(event(), sourceDay([raw({ actual: 'TBD' })])).row, undefined);
  const ppi = event({ timestamp: '2026-11-23T13:30:00Z', source: { title: 'PPI m/m' } });
  const ambiguous = source.matchReleaseSource(ppi, sourceDay([raw({ eventName: 'PPI', gmt: '08:30', actual: '0.3%' }), raw({ eventName: 'PPI', gmt: '08:30', actual: '6.5%' })]));
  assert.equal(ambiguous.row, undefined); assert.match(ambiguous.reason, /未明确区分/);
  const summerRate = event({ timestamp: '2026-10-28T18:00:00Z', source: { title: 'Federal Funds Rate' } });
  assert.equal(source.matchReleaseSource(summerRate, sourceDay([raw({ eventName: 'Fed Interest Rate Decision', gmt: '13:00', actual: '4.25%' })], '2026-10-28')).row.actual, '4.25%');
  assert.equal(source.matchReleaseSource(event(), sourceDay([raw({ actual: '&nbsp;' })])).row.actual, null);
  assert.throws(() => source.parseReleaseSourceDay({ status: { rCode: 200 }, data: null }, '2026-11-23', at));
});

test('collector groups one day, saves actual and pending independently, and honors durable retry times', async () => {
  const service = await collectorFixture([event(), event({ id: 'services', source: { title: 'Flash Services PMI' } })], () => sourceDay([
    raw(), raw({ eventName: 'S&P Global Services PMI', actual: '&nbsp;' }),
  ]));
  const result = await service.collectNextEventRelease();
  assert.equal(result.published, 1); assert.equal(result.saved, 2); assert.equal(service.requests.length, 1);
  assert.equal(service.events[0].release.actual, '55.2');
  assert.equal(service.events[0].release.sourcePrevious, '54.9');
  assert.equal(service.events[0].previous, '56.0');
  assert.equal(service.events[1].release.status, 'pending');
  assert.equal((await service.collectNextEventRelease()).status, 'idle');
  assert.equal(service.requests.length, 1);
});

test('source failure persists a safe retry; published actual survives later missing rows and outages', async () => {
  const pending = await collectorFixture([event()], () => { throw new Error('secret upstream payload'); });
  assert.equal((await pending.collectNextEventRelease()).status, 'retry');
  assert.equal(pending.events[0].release.status, 'retry');
  assert.doesNotMatch(pending.events[0].release.error, /secret/);
  const initial = event({ release: published({ checkedAt: '2026-11-23T14:46:00Z',
    source: { provider: 'nasdaq', url: sourceUrl, title: 'S&P Global Manufacturing PMI', fetchedAt: '2026-11-23T14:46:00Z' } }) });
  for (const fetcher of [() => { throw new Error('HTTP bad'); }, () => sourceDay([raw({ actual: '&nbsp;' })])]) {
    const service = await collectorFixture([initial], fetcher);
    await service.collectNextEventRelease();
    assert.equal(service.events[0].release.status, 'published');
    assert.equal(service.events[0].release.actual, '55.2');
    assert.ok(service.events[0].release.error);
  }
});

test('changed source actual preserves prior observations and the frozen calendar baseline', async () => {
  const initial = event({ release: published({ actual: '55.0', forecast: '54.4' }) });
  const service = await collectorFixture([initial], () => sourceDay([raw()]));
  await service.collectNextEventRelease();
  const updated = service.events[0].release;
  assert.equal(updated.actual, '55.2'); assert.equal(updated.forecast, '54.4');
  assert.equal(updated.revisions.length, 1); assert.equal(updated.revisions[0].actual, '55.0');
});

test('future, unsupported, simulated and completed old releases never fetch; expired missing results become unavailable', async () => {
  const oldAt = '2026-11-19T14:45:00Z';
  const service = await collectorFixture([
    event({ id: 'future', timestamp: '2026-11-24T14:45:00Z' }),
    event({ id: 'speech', source: { title: 'FOMC Meeting Minutes' } }),
    event({ id: 'simulated', simulated: true }),
    event({ id: 'old', timestamp: oldAt }),
  ], () => assert.fail('must not fetch'));
  await service.collectNextEventRelease();
  assert.equal(service.requests.length, 0);
  assert.equal(service.events[3].release.status, 'unavailable');
  assert.equal((await service.collectNextEventRelease()).status, 'idle');
});

test('context carries actual and provenance without using price reaction to manufacture an actual value', () => {
  const text = release.formatEventReleaseContext(event({ release: published() }), new Date(clock));
  assert.match(text, /实际值 55.2/); assert.match(text, /\+0.7 点/); assert.match(text, /-0.8 点/);
  assert.match(text, /Nasdaq 聚合日历/); assert.match(text, /影响可能分歧/);
  assert.match(release.formatEventReleaseContext(event(), new Date(clock)), /实际值 未知/);
});

test('a grouped statement retains a separate numeric decision and does not assign the decision result to the press conference', () => {
  const decision = event({ id: 'rate', source: { title: 'Federal Funds Rate' }, release: published({ actual: '4.25%', forecast: '4.25%' }) });
  const group = event({ id: 'statement', source: { title: 'FOMC Statement' }, eventGroupMembers: [decision] });
  assert.equal(release.getReleasePresentation(group, new Date(clock)).release, undefined);
  const context = release.formatEventReleaseContext(group, new Date(clock));
  assert.match(context, /文字事件/); assert.match(context, /实际值 4.25%/);
  assert.equal(release.getAdditionalReleaseEvents(group)[0].id, 'rate');
});
