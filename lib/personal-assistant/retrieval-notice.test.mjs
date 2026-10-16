import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRetrievalNotice, stripRetrievalNotices } from './retrieval-notice.mjs';

test('retrieval notices distinguish no retrieval, weather success, pending and failure', () => {
  assert.match(buildRetrievalNotice(), /本轮未进行联网搜索或外部数据查询/);
  const success = buildRetrievalNotice({ weatherStatus: 'success' });
  assert.match(success, /和风天气/);
  assert.match(success, /可能使用缓存/);
  assert.doesNotMatch(success, /未进行|实时查到/);
  assert.match(buildRetrievalNotice({ weatherStatus: 'waiting' }), /尚未获取天气数据/);
  assert.match(buildRetrievalNotice({ weatherStatus: 'failed' }), /未获取可靠天气数据/);
});

test('QQ finalization replaces repeated model notices with one actual retrieval status', () => {
  for (const footer of [
    '查询状态：本轮未进行联网搜索或外部数据查询。',
    '_查询状态：本轮未进行联网搜索或外部数据查询。_',
    '**查询状态：** 本轮已联网。',
    '> 查询状态：本轮已联网。',
  ]) {
    const raw = `正文\n\n${footer}\n\n${footer}\n`;
    const cleaned = stripRetrievalNotices(raw);
    assert.equal(cleaned, '正文');
    const finalized = cleaned + buildRetrievalNotice({ weatherStatus: 'success' });
    assert.equal((finalized.match(/查询状态[：:]/g) || []).length, 1);
    assert.match(finalized, /和风天气/);
    assert.doesNotMatch(finalized, /未进行联网/);
    assert.equal(stripRetrievalNotices(finalized), '正文');
  }
  const explanation = '你问的“查询状态：未联网”是什么意思？\n\n这是一个状态说明。';
  assert.equal(stripRetrievalNotices(explanation), explanation);
  const code = '```text\n查询状态：示例\n```';
  assert.equal(stripRetrievalNotices(code), code);
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
