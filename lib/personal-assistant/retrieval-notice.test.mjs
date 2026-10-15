import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRetrievalNotice } from './retrieval-notice.mjs';

test('retrieval notices distinguish no retrieval, weather success, pending and failure', () => {
  assert.match(buildRetrievalNotice(), /本轮未进行联网搜索或外部数据查询/);
  const success = buildRetrievalNotice({ weatherStatus: 'success' });
  assert.match(success, /和风天气/);
  assert.match(success, /可能使用缓存/);
  assert.doesNotMatch(success, /未进行|实时查到/);
  assert.match(buildRetrievalNotice({ weatherStatus: 'waiting' }), /尚未获取天气数据/);
  assert.match(buildRetrievalNotice({ weatherStatus: 'failed' }), /未获取可靠天气数据/);
});

test('retrieval notices report actual operations without equating tool calls with successful network access', () => {
  assert.match(buildRetrievalNotice({ searched: true }), /已执行联网搜索/);
  assert.match(buildRetrievalNotice({ webpage: true }), /已请求读取网页/);
  assert.match(buildRetrievalNotice({ crypto: true }), /平台行情查询/);
  assert.match(buildRetrievalNotice({ trending: true }), /平台热榜/);
  assert.match(buildRetrievalNotice({ toolCalled: true }), /是否访问网络以工具结果为准/);
  const mixed = buildRetrievalNotice({ weatherStatus: 'failed', searched: true });
  assert.match(mixed, /未获取可靠天气数据/);
  assert.match(mixed, /已执行联网搜索/);
});
