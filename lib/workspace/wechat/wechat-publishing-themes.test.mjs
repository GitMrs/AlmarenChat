import assert from 'node:assert/strict';
import test from 'node:test';
import { getWechatPublishingTheme, WECHAT_PUBLISHING_THEMES } from './wechat-publishing-themes.mjs';

test('wechat publishing exposes three stable themes', () => {
  assert.deepEqual(WECHAT_PUBLISHING_THEMES.map((item) => item.id), [
    'minimal',
    'fresh-green',
    'business-blue',
  ]);
  assert.equal(new Set(WECHAT_PUBLISHING_THEMES.map((item) => item.accent)).size, 3);
});

test('wechat publishing theme lookup falls back to fresh green', () => {
  assert.equal(getWechatPublishingTheme('minimal').name, '简约黑白');
  assert.equal(getWechatPublishingTheme('unknown').id, 'fresh-green');
});
