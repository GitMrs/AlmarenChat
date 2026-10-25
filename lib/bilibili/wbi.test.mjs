import test from 'node:test';
import assert from 'node:assert/strict';
import { getMixinKey, signWbi, wbiQueryString } from './wbi.mjs';

test('mixin key keeps 32 characters', () => {
  const key = getMixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45');
  assert.equal(key.length, 32);
  assert.equal(key, 'ea1db124af3c7062474693fa704f4ff8');
});

test('wbi signature is stable and sorted', () => {
  const mixin = getMixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45');
  const signed = signWbi({ foo: '114', bar: '514', zab: 1919810 }, mixin, 1700000000000);
  assert.equal(String(signed.wts), '1700000000');
  assert.equal(typeof signed.w_rid, 'string');
  assert.equal(signed.w_rid.length, 32);
  assert.deepEqual(Object.keys(signed).sort(), ['bar', 'foo', 'w_rid', 'wts', 'zab']);
});

test('wbi strips forbidden characters and skips empty values', () => {
  const mixin = '0123456789abcdef0123456789abcdef';
  const signed = signWbi({ keyword: "a!b'c(d)e*f", empty: '', missing: null }, mixin, 1700000000000);
  assert.equal(signed.keyword, 'abcdef');
  assert.equal('empty' in signed, false);
  assert.equal('missing' in signed, false);
});

test('wbi query string is url encoded', () => {
  const mixin = '0123456789abcdef0123456789abcdef';
  const query = wbiQueryString({ keyword: '中文 视频' }, mixin, 1700000000000);
  assert.match(query, /keyword=%E4%B8%AD%E6%96%87(?:\+|%20)%E8%A7%86%E9%A2%91/);
  assert.match(query, /wts=1700000000/);
  assert.match(query, /w_rid=[0-9a-f]{32}/);
});
