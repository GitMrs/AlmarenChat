import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeatherContext, createWeatherService, pendingWeatherQuery, weatherRequested } from './weather.mjs';

test('saved location skips geocoding even after cache expiry; other locations still resolve', async () => {
  const saved = { id: '101210101', name: '杭州', city: '杭州', province: '浙江', country: '中国', timezone: 'Asia/Shanghai' };
  const paths = [];
  let clock = 0;
  const service = createWeatherService({ host: 'weather.example', apiKey: 'test', now: () => clock, fetcher: async (url) => {
    paths.push(url.pathname);
    return { ok: true, json: async () => url.pathname.includes('lookup')
      ? { code: '200', location: [{ id: '101010100', name: '北京', adm2: '北京' }] }
      : { code: '200', now: { temp: '20' } } };
  } });
  const result = await service.query({ location: saved.id, resolvedLocation: saved });
  assert.deepEqual(result.location, saved);
  clock += 25 * 3600_000;
  await service.query({ location: saved.id, resolvedLocation: saved });
  assert.deepEqual(paths, ['/v7/weather/now', '/v7/weather/now']);
  const other = await service.query({ location: '北京', resolvedLocation: saved });
  assert.equal(other.location.name, '北京');
  assert.ok(paths.includes('/geo/v2/city/lookup'));
});

test('weather intent covers conversational current temperature but not ordinary chat', () => {
  assert.equal(weatherRequested('看看当前几度'), true);
  assert.equal(weatherRequested('下班需要带伞吗'), true);
  assert.equal(weatherRequested('明天温度如果'), true);
  assert.equal(weatherRequested('明天温度如何'), true);
  assert.equal(weatherRequested('帮我写代码'), false);
});

test('weather reports actual retrieval status rather than the search switch', async () => {
  for (const expected of ['waiting', 'success', 'failed']) {
    let status;
    await buildWeatherContext({ message: '明天温度如何',
      resolve: async () => JSON.stringify({ location: expected === 'waiting' ? '' : '北京', kind: 'daily' }),
      service: { query: async () => { if (expected === 'failed') throw new Error('offline'); return { observations: [] }; } },
      onStatus: value => { status = value; },
    });
    assert.equal(status, expected);
  }
  let status;
  assert.equal(await buildWeatherContext({ message: '你好', service: { query: async () => {} }, resolve: async () => '', onStatus: value => { status = value; } }), null);
  assert.equal(status, undefined);
});

test('weather service shares cached and concurrent requests and refreshes expired data', async () => {
  let clock = 0;
  const calls = [];
  const service = createWeatherService({ host: 'cache-test.example', apiKey: 'secret', now: () => clock, fetcher: async (url, options) => {
    calls.push(url.pathname);
    assert.equal(options.headers['X-QW-Api-Key'], 'secret');
    assert.equal(url.searchParams.has('key'), false);
    return { ok: true, json: async () => url.pathname.includes('lookup')
      ? { code: '200', location: [{ id: '101010100', name: '北京', adm2: '北京', tz: 'Asia/Shanghai' }] }
      : { code: '200', updateTime: '2026-10-15T08:15+08:00', now: { temp: '12', obsTime: '2026-10-15T08:10+08:00' } } };
  } });
  const results = await Promise.all([service.query({ location: '北京' }), service.query({ location: '北京' })]);
  assert.equal(calls.length, 2);
  assert.equal(results[0].observations.temp, '12');
  await service.query({ location: '北京' });
  assert.equal(calls.length, 2);
  clock = 301_000;
  await service.query({ location: '北京' });
  assert.equal(calls.length, 3);
});

test('weather rejects upstream errors and unavailable forecast dates', async () => {
  const service = createWeatherService({ host: 'errors-test.example', apiKey: 'key', fetcher: async (url) => ({ ok: true, json: async () => url.pathname.includes('lookup')
    ? { code: '200', location: [{ id: '1', name: '北京' }] }
    : { code: '200', daily: [{ fxDate: '2026-10-15', tempMax: '20' }] } }) });
  await assert.rejects(service.query({ location: '北京', kind: 'daily', date: '2026-10-20' }), /超出/);
  await assert.rejects(service.query({ location: '北京', kind: 'invalid' }), /类型/);
  const failing = createWeatherService({ host: 'failure-test.example', apiKey: 'key', fetcher: async () => ({ ok: true, json: async () => ({ code: '401' }) }) });
  await assert.rejects(failing.query({ location: '北京' }), /401/);
});

test('daily forecast selects the requested local date and caches for fifteen minutes', async () => {
  let clock = 0;
  let forecastCalls = 0;
  const service = createWeatherService({ host: 'daily-test.example', apiKey: 'key', now: () => clock, fetcher: async (url) => {
    if (url.pathname.includes('lookup')) return { ok: true, json: async () => ({ code: '200', location: [{ id: '1', name: '北京', tz: 'Asia/Shanghai' }] }) };
    forecastCalls++;
    return { ok: true, json: async () => ({ code: '200', daily: [
      { fxDate: '2026-10-15', tempMax: '28', tempMin: '16' },
      { fxDate: '2026-10-16', tempMax: '24', tempMin: '12' },
    ] }) };
  } });
  assert.equal(forecastCalls, 0);
  const result = await service.query({ location: '1', kind: 'daily', date: '2026-10-15' });
  assert.deepEqual(result.observations, [{ fxDate: '2026-10-15', tempMax: '28', tempMin: '16' }]);
  await service.query({ location: '1', kind: 'daily', date: '2026-10-16' });
  assert.equal(forecastCalls, 1);
  clock = 900_001;
  await service.query({ location: '1', kind: 'daily', date: '2026-10-15' });
  assert.equal(forecastCalls, 2);
});

test('weather context asks for missing location and never fills missing readings', async () => {
  let queried = false;
  const missing = await buildWeatherContext({ message: '现在几度', resolve: async () => '{"location":""}', service: { query: async () => { queried = true; } } });
  assert.match(missing, /询问用户/);
  assert.equal(queried, false);
  const failed = await buildWeatherContext({ message: '北京天气', resolve: async () => '{"location":"北京"}', service: { query: async () => { throw new Error('服务暂不可用'); } } });
  assert.match(failed, /不得凭季节/);
  assert.equal(await buildWeatherContext({ message: '你好' }), null);
});

test('region lookup returns selectable IDs and does not query weather or expose credentials', async () => {
  const paths = [];
  const service = createWeatherService({ host: 'regions-test.example', apiKey: 'secret', fetcher: async (url) => {
    paths.push(url.pathname);
    return { ok: true, json: async () => ({ code: '200', location: [
      { id: '101010100', name: '北京', adm1: '北京', adm2: '北京', country: '中国', tz: 'Asia/Shanghai', lat: '39.9' },
      { id: '101011100', name: '房山', adm1: '北京', adm2: '北京', country: '中国', tz: 'Asia/Shanghai' },
    ] }) };
  } });
  const places = await service.lookup('北京');
  assert.equal(places[0].id, '101010100');
  assert.equal(places[1].name, '房山');
  assert.equal(places[0].province, '北京');
  assert.equal('lat' in places[0], false);
  await service.lookup('北京');
  assert.deepEqual(paths, ['/geo/v2/city/lookup']);
  await assert.rejects(service.lookup(''), /城市/);
});

test('weather clarification persists the query and resumes a bare city reply', async () => {
  let pending;
  const first = await buildWeatherContext({ message: '明天需要带伞吗', now: 1000,
    resolve: async () => JSON.stringify({ location: '', kind: 'daily', date: '2026-10-16' }),
    service: { query: async () => { throw new Error('must not query without a location'); } },
    onPending: value => { pending = value; },
  });
  assert.match(first, /询问用户/);
  assert.equal(pending.expiresAt, 601000);
  const history = JSON.parse(JSON.stringify([{ role: 'assistant', attachments: [pending] }]));
  let actual;
  let nextPending;
  const result = await buildWeatherContext({ message: '北京', history, now: 2000,
    resolve: async () => JSON.stringify({ continues: true, location: '北京' }),
    service: { query: async query => { actual = query; return { observations: [{ tempMax: '20' }] }; } },
    onPending: value => { nextPending = value; },
  });
  assert.deepEqual(actual, { location: '北京', kind: 'daily', date: '2026-10-16' });
  assert.match(result, /平台天气查询结果/);
  assert.equal(nextPending, undefined);
  const withKeyword = await buildWeatherContext({ message: '北京的天气', history, now: 2000,
    resolve: async () => '{"continues":true,"location":"北京"}',
    service: { query: async query => { assert.equal(query.date, '2026-10-16'); return {}; } },
  });
  assert.match(withKeyword, /平台天气查询结果/);
  let parses = 0;
  await buildWeatherContext({ message: '改查上海现在几度', history, now: 2000,
    resolve: async () => ++parses === 1 ? '{"continues":false}' : '{"location":"上海","kind":"now"}',
    service: { query: async query => { assert.equal(query.location, '上海'); assert.equal(query.kind, 'now'); return {}; } },
  });
  assert.equal(parses, 2);
});

test('pending weather is limited to the immediate conversation reply and ten minutes', async () => {
  const pending = { type: 'weather_query_v1', query: { kind: 'now', date: '' }, expiresAt: 10000 };
  const history = [{ role: 'assistant', attachments: [pending] }];
  assert.equal(pendingWeatherQuery(history, 9999), pending);
  assert.equal(pendingWeatherQuery(history, 10000), null);
  assert.equal(pendingWeatherQuery([], 100), null);
  assert.equal(pendingWeatherQuery([...history, { role: 'user', content: '换个话题' }], 100), null);
  assert.equal(pendingWeatherQuery([...history, { role: 'assistant', content: '好的' }], 100), null);
  for (const message of ['取消', '帮我写代码', '谢谢']) {
    const result = await buildWeatherContext({ message, history, now: 100,
      resolve: async () => '{"continues":false}',
      service: { query: async () => assert.fail('unrelated chat must not query weather') },
      onPending: () => assert.fail('unrelated chat must not renew pending state'),
    });
    assert.equal(result, null);
  }
  assert.equal(await buildWeatherContext({ message: '北京', history, now: 10000,
    resolve: async () => assert.fail('expired pending must not invoke the model'), service: { query: async () => {} },
  }), null);
});

test('weather lookup disambiguates all matching names and never queries weather before confirmation', async () => {
  const paths = [];
  const candidates = [
    { id: '1', name: '朝阳', adm1: '辽宁', adm2: '朝阳' },
    { id: '2', name: '海淀', adm1: '北京', adm2: '北京' },
    { id: '3', name: '朝阳', adm1: '北京', adm2: '北京' },
  ];
  const service = createWeatherService({ host: 'ambiguous-test.example', apiKey: 'key', fetcher: async url => {
    paths.push(url.pathname);
    return { ok: true, json: async () => url.pathname.includes('lookup') ? { code: '200', location: candidates } : { code: '200', now: { temp: '20' } } };
  } });
  const result = await service.query({ location: '朝阳' });
  assert.equal(result.needsLocation, true);
  assert.deepEqual(result.candidateLocations.map(p => p.id), ['1', '3']);
  assert.deepEqual(paths, ['/geo/v2/city/lookup']);
  assert.equal((await service.query({ location: '3' })).location.id, '3');
  assert.equal((await service.query({ location: '海淀' })).location.id, '2');
});

test('weather candidate confirmation preserves forecast intent and validates the chosen ID', async () => {
  let pending;
  const candidates = [{ id: '1', name: '朝阳', province: '辽宁' }, { id: '3', name: '朝阳', province: '北京' }];
  const service = { query: async query => query.location === '朝阳'
    ? { needsLocation: true, candidateLocations: candidates }
    : { location: { id: query.location }, kind: query.kind, date: query.date } };
  const result = await buildWeatherContext({ message: '朝阳明天天气', now: 1000,
    resolve: async () => '{"location":"朝阳","kind":"daily","date":"2026-10-16"}', service,
    onPending: value => { pending = value; },
  });
  assert.match(result, /尚未查询天气/);
  const history = [{ role: 'assistant', attachments: [pending] }];
  const selected = await buildWeatherContext({ message: '第二个', history, now: 2000, service,
    resolve: async () => '{"continues":true,"candidateId":"3"}',
  });
  assert.match(selected, /"id":"3"/);
  assert.match(selected, /2026-10-16/);
  let renewed;
  const unclear = await buildWeatherContext({ message: '是哪个呢', history, now: 2000, service,
    resolve: async () => '{"continues":true,"location":""}', onPending: value => { renewed = value; },
  });
  assert.match(unclear, /不得默认第一项/);
  assert.equal(renewed.expiresAt, pending.expiresAt);
  const invalid = await buildWeatherContext({ message: '第二个', history, now: 2000,
    resolve: async () => '{"continues":true,"candidateId":"999"}',
    service: { query: async () => assert.fail('unlisted IDs must not reach the service') },
  });
  assert.match(invalid, /查询失败/);
});
