import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeatherContext, createWeatherService, weatherRequested } from './weather.mjs';

test('weather intent covers conversational current temperature but not ordinary chat', () => {
  assert.equal(weatherRequested('看看当前几度'), true);
  assert.equal(weatherRequested('下班需要带伞吗'), true);
  assert.equal(weatherRequested('帮我写代码'), false);
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
