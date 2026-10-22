import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWechatPublicationStatus, MAX_WECHAT_PUBLICATION_POLLS, wechatPublicationPollDelayMs } from './wechat-publication-policy.mjs';

test('wechat publication status separates submitted, success and terminal failure', () => {
  assert.equal(classifyWechatPublicationStatus({ status: 1 }).state, 'pending');
  assert.equal(classifyWechatPublicationStatus({ status: 0 }).state, 'completed');
  assert.deepEqual(classifyWechatPublicationStatus({ status: 4 }), { state: 'failed', message: '平台审核未通过' });
});

test('wechat publication polling backs off and remains bounded', () => {
  assert.equal(wechatPublicationPollDelayMs(0), 30_000);
  assert.equal(wechatPublicationPollDelayMs(4), 300_000);
  assert.equal(wechatPublicationPollDelayMs(20), 300_000);
  assert.equal(MAX_WECHAT_PUBLICATION_POLLS, 24);
});
