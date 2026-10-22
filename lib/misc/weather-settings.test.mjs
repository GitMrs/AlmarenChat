import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { normalizeWeatherLocation } from './weather.mjs';

async function loadRoute(lookup) {
  const source = await readFile(new URL('../../app/api/user/route.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const writes = [];
  const exports = {};
  const dbNull = Symbol('DbNull');
  vm.runInNewContext(output, { exports, require: (name) => {
    if (name === 'next/server') return { NextResponse: { json: (data, options = {}) => ({ data, status: options.status || 200 }) } };
    if (name.includes('generated/prisma')) return { Prisma: { DbNull: dbNull } };
    if (name.includes('/db')) return { default: { user: { update: async (args) => { writes.push(args); return args.data; } } } };
    if (name.includes('/auth')) return { requireAuth: () => 'current-user' };
    if (name.includes('weather.mjs')) return { normalizeWeatherLocation, platformWeather: { lookup } };
    if (name.includes('model-limits')) return { MODEL_CONTEXT_WINDOW_OPTIONS: [] };
    if (name.includes('mcp-config')) return { parseMcpServers: () => [] };
    throw new Error(name);
  } });
  return { patch: (value) => exports.PATCH({ json: async () => ({ defaultWeatherLocation: value }) }), writes, dbNull };
}

test('settings save canonical provider location for the authenticated account', async () => {
  const route = await loadRoute(async (id) => {
    assert.equal(id, '101210101');
    return [{ id, name: '杭州', province: '浙江' }];
  });
  assert.equal((await route.patch({ id: '101210101', name: '伪造名称', country: '伪造国家' })).status, 200);
  assert.equal(route.writes[0].where.id, 'current-user');
  assert.equal(route.writes[0].data.defaultWeatherLocation.name, '杭州');
  assert.equal(route.writes[0].data.defaultWeatherLocation.country, '');
  assert.equal((await route.patch(null)).status, 200);
  assert.equal(route.writes[1].data.defaultWeatherLocation, route.dbNull);
});

test('invalid locations and provider failures never overwrite the saved setting', async () => {
  const invalid = await loadRoute(async () => []);
  assert.equal((await invalid.patch({})).status, 400);
  assert.equal((await invalid.patch({ id: 'unknown', name: '不存在' })).status, 400);
  assert.equal(invalid.writes.length, 0);
  const failing = await loadRoute(async () => { throw new Error('offline'); });
  assert.equal((await failing.patch({ id: '101210101', name: '杭州' })).status, 502);
  assert.equal(failing.writes.length, 0);
});

async function loadWeatherRoute() {
  const source = await readFile(new URL('../../app/api/weather/route.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const calls = [];
  const saved = { id: '101210101', name: '杭州' };
  const exports = {};
  vm.runInNewContext(output, { exports, URL, require: (name) => {
    if (name === 'next/server') return { NextResponse: { json: (data, options = {}) => ({ data, status: options.status || 200 }) } };
    if (name.includes('/auth')) return { requireAuth: () => 'weather-user' };
    if (name.includes('/db')) return { default: { user: { findUnique: async (args) => {
      assert.equal(args.where.id, 'weather-user');
      calls.push('profile');
      return { defaultWeatherLocation: saved };
    } } } };
    if (name.includes('weather.mjs')) return { normalizeWeatherLocation, platformWeather: {
      query: async (args) => { calls.push(args); return { observations: { temp: '20' } }; },
      lookup: async (location) => { calls.push(location); return [saved]; },
    } };
    throw new Error(name);
  } });
  return { get: (query) => exports.GET({ url: `https://app.example/api/weather?${query}` }), calls };
}

test('weather API reuses only the authenticated users saved location code', async () => {
  const route = await loadWeatherRoute();
  assert.equal((await route.get('location=101210101&kind=now')).status, 200);
  assert.equal(route.calls[1].resolvedLocation.name, '杭州');
  assert.equal((await route.get('location=北京&kind=now')).status, 200);
  assert.equal(route.calls[3].resolvedLocation, undefined);
});

test('weather location lookup stays independent of the saved account location', async () => {
  const route = await loadWeatherRoute();
  const result = await route.get('location=杭州&kind=locations');
  assert.equal(result.status, 200);
  assert.equal(result.data.locations[0].id, '101210101');
  assert.deepEqual(route.calls, ['杭州']);
});
