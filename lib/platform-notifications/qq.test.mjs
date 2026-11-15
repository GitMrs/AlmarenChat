import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlatformConfig, encryptPlatformToken, sendPlatformQQ } from './qq.mjs';

process.env.SPACE_CONNECTOR_SECRET = 'platform-test-secret-with-at-least-32-characters';
const base = { baseUrl: 'https://qq.example.com/api', targetType: 'PRIVATE', targetId: '12345678', tokenCiphertext: encryptPlatformToken('test-key') };

test('private and group requests match the external QQ API and keep authentication out of the URL', async () => {
  for (const targetType of ['PRIVATE', 'GROUP']) {
    const result = await sendPlatformQQ({ ...base, targetType }, '重要变化 & 下一步？', async (url, options) => {
      assert.equal(url.pathname, `/api/${targetType === 'GROUP' ? 'send_group_msg' : 'send_private_msg'}`);
      assert.equal(url.searchParams.get(targetType === 'GROUP' ? 'group_id' : 'user_id'), base.targetId);
      assert.equal(url.searchParams.get('message'), '重要变化 & 下一步？');
      assert.equal(options.headers['X-Auth-Key'], 'test-key');
      assert.equal(options.redirect, 'error');
      assert.doesNotMatch(url.toString(), /test-key/);
      return Response.json({ status: 'ok', retcode: 0, data: { message_id: 123 } });
    });
    assert.equal(result.messageId, '123');
  }
});

test('HTTP, malformed JSON, API failures and network errors are never treated as delivered', async () => {
  for (const response of [new Response('', { status: 403 }), new Response('invalid'), Response.json(null), Response.json({ status: 'failed' }), Response.json({ retcode: 100, message: 'private-secret' })]) {
    await assert.rejects(sendPlatformQQ(base, 'hello', async () => response), error => !error.message.includes('private-secret'));
  }
  await assert.rejects(sendPlatformQQ(base, 'hello', async () => { throw new Error('secret-url'); }), /连接通知机器人失败/);
});

test('configuration validates addresses and numeric targets', () => {
  assert.equal(normalizePlatformConfig({ ...base, baseUrl: 'https://qq.example.com/api/' }).baseUrl, base.baseUrl);
  for (const baseUrl of ['file:///tmp/a', 'https://user:pass@example.com', 'https://example.com?key=secret']) {
    assert.throws(() => normalizePlatformConfig({ ...base, baseUrl }));
  }
  assert.throws(() => normalizePlatformConfig({ ...base, targetId: 'abc' }));
});
