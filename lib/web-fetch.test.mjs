import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWebPage } from './web-fetch.mjs';

function response(body, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Map(Object.entries(headers)), text: async () => body };
}

test('web fetch reads HTTPS pages and truncates large responses', async () => {
  const result = await fetchWebPage('https://example.com/article', {
    fetchImpl: async () => response('x'.repeat(20_001)),
  });
  assert.equal(result.truncated, true);
  assert.equal(result.content.includes('正文已截断'), true);
});

test('web fetch blocks insecure and internal addresses before requesting', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response('no'); };
  await assert.rejects(fetchWebPage('http://example.com', { fetchImpl }), /HTTPS/);
  await assert.rejects(fetchWebPage('https://127.0.0.1/private', { fetchImpl }), /内部地址/);
  assert.equal(calls, 0);
});

test('web fetch validates every redirect target', async () => {
  let calls = 0;
  await assert.rejects(fetchWebPage('https://example.com/start', {
    fetchImpl: async () => {
      calls += 1;
      return response('', 302, { location: 'https://127.0.0.1/secret' });
    },
  }), /内部地址/);
  assert.equal(calls, 1);
});
