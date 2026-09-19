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

test('web fetch extracts clean article content from HTML pages via Readability', async () => {
  const html = `
    <!DOCTYPE html>
    <html lang="zh">
    <head>
      <title>深度思考：一人公司的核心逻辑</title>
      <style>body { color: red; }</style>
    </head>
    <body>
      <header><nav><ul><li>首页</li><li>关于我们</li><li>广告位招租</li></ul></nav></header>
      <article>
        <h1>深度思考：一人公司的核心逻辑</h1>
        <p>一人公司并不是简单的全栈开发，而是个人商业意志与自动化杠杆的结合。</p>
        <p>通过构建高质量的情报收集管道与自运行工作区，个人也可以具备跨维度的生产力。</p>
      </article>
      <footer><p>Copyright 2026 某某公司 广告</p></footer>
    </body>
    </html>
  `;
  const result = await fetchWebPage('https://example.com/blog/solopreneur', {
    fetchImpl: async () => response(html, 200, { 'content-type': 'text/html; charset=utf-8' }),
  });
  assert.equal(result.title, '深度思考：一人公司的核心逻辑');
  assert.equal(result.content.includes('# 深度思考：一人公司的核心逻辑'), true);
  assert.equal(result.content.includes('一人公司并不是简单的全栈开发'), true);
  assert.equal(result.content.includes('广告位招租'), false);
  assert.equal(result.content.includes('body { color: red; }'), false);
});

test('web fetch preserves JSON format and does not treat JSON as HTML', async () => {
  const json = JSON.stringify([{ id: 1, title: 'Item 1' }, { id: 2, title: 'Item 2' }]);
  const result = await fetchWebPage('https://example.com/api/items', {
    fetchImpl: async () => response(json, 200, { 'content-type': 'application/json' }),
  });
  assert.equal(result.title, undefined);
  assert.equal(result.content, json);
});

