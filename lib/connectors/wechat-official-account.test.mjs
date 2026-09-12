import assert from 'node:assert/strict';
import test from 'node:test';
import { createWechatOfficialAccountConnector } from './wechat-official-account.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

test('wechat connector caches access tokens and never puts credentials in request bodies', async () => {
  const requests = [];
  const cache = { value: null, async get() { return this.value; }, async set(value) { this.value = value; } };
  const connector = createWechatOfficialAccountConnector({
    appId: 'wx-app', appSecret: 'secret', tokenCache: cache, now: () => 1_000,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return jsonResponse({ access_token: 'token-1', expires_in: 7200 });
    },
  });
  assert.equal(await connector.accessToken(), 'token-1');
  assert.equal(await connector.accessToken(), 'token-1');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /appid=wx-app/);
  assert.match(requests[0].url, /secret=secret/);
  assert.equal(requests[0].init.body, undefined);
});

test('wechat connection validation forces a fresh credential and IP allowlist check', async () => {
  let calls = 0;
  const cache = { async get() { return { token: 'cached-token', expiresAt: Date.now() + 60_000 }; }, async set() {} };
  const connector = createWechatOfficialAccountConnector({
    appId: 'wx-app', appSecret: 'secret', tokenCache: cache,
    fetchImpl: async () => { calls += 1; return jsonResponse({ access_token: 'fresh-token', expires_in: 7200 }); },
  });
  assert.deepEqual(await connector.validateConnection(), { validated: true });
  assert.equal(calls, 1);
});

test('wechat connection validation explains an IP allowlist rejection', async () => {
  const connector = createWechatOfficialAccountConnector({
    appId: 'wx-app', appSecret: 'secret',
    fetchImpl: async () => jsonResponse({ errcode: 40164, errmsg: 'invalid ip' }),
  });
  await assert.rejects(() => connector.validateConnection(), /IP.*白名单/);
});

test('wechat draft creation retries once after an expired token', async () => {
  const urls = [];
  let tokenNumber = 0;
  const connector = createWechatOfficialAccountConnector({
    appId: 'wx-app', appSecret: 'secret',
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).includes('/token?')) return jsonResponse({ access_token: `token-${++tokenNumber}`, expires_in: 7200 });
      if (String(url).includes('token-1')) return jsonResponse({ errcode: 42001, errmsg: 'access_token expired' });
      return jsonResponse({ media_id: 'draft-1' });
    },
  });
  const result = await connector.createDraft([{ title: '标题', content: '<p>正文</p>', thumbMediaId: 'cover-1' }]);
  assert.deepEqual(result, { mediaId: 'draft-1' });
  assert.equal(urls.filter((url) => url.includes('/token?')).length, 2);
});

test('wechat publication explains missing official-account permission', async () => {
  const connector = createWechatOfficialAccountConnector({
    appId: 'wx-app', appSecret: 'secret',
    fetchImpl: async (url) => String(url).includes('/token?')
      ? jsonResponse({ access_token: 'token', expires_in: 7200 })
      : jsonResponse({ errcode: 48001, errmsg: 'api unauthorized' }),
  });
  await assert.rejects(() => connector.publish('draft-1'), /没有正式发布接口权限/);
});

test('wechat connector validates publishing input before network access', async () => {
  let calls = 0;
  const connector = createWechatOfficialAccountConnector({
    appId: 'wx-app', appSecret: 'secret', fetchImpl: async () => { calls += 1; return jsonResponse({}); },
  });
  await assert.rejects(() => connector.createDraft([]), /1 至 8 篇文章/);
  await assert.rejects(() => connector.uploadImage({ bytes: new Uint8Array() }), /图片内容不能为空/);
  assert.equal(calls, 0);
});

test('wechat publication status returns only auditable ids and article urls', async () => {
  const connector = createWechatOfficialAccountConnector({
    appId: 'wx-app', appSecret: 'secret',
    fetchImpl: async (url) => String(url).includes('/token?')
      ? jsonResponse({ access_token: 'token', expires_in: 7200 })
      : jsonResponse({ publish_status: 0, article_id: 'article-1', article_detail: { item: [{ article_url: 'https://mp.weixin.qq.com/s/abc', content: 'must-not-return' }] } }),
  });
  assert.deepEqual(await connector.publicationStatus('publish-1'), {
    status: 0, articleId: 'article-1', urls: ['https://mp.weixin.qq.com/s/abc'], url: 'https://mp.weixin.qq.com/s/abc', failIndex: null,
  });
});
