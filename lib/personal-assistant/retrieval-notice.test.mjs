import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRetrievalNotice, stripHistoryRetrievalNotices, stripRetrievalNotices } from './retrieval-notice.mjs';
import { buildAssistantHistory } from './history-context.mjs';
import { createAutoWebTools } from '../web/auto-web-core.mjs';

test('history strips generated source footers including cache, failure and partial notices', async () => {
  for (const result of [
    { sources: [{ title: '资料 [一]', url: 'https://example.com/one', dataTime: '2026-10-27' }, { title: '资料二', url: 'https://example.com/two' }], cacheNotice: '可能使用缓存', partial: true },
    { status: 'empty', sources: [] },
    { status: 'failed', error: '查询失败', sources: [] },
  ]) {
    const web = createAutoWebTools({ search: async () => result });
    await web.execute('web_search', { query: '测试' });
    if (result.sources.length) await web.execute('web_fetch', { url: 'https://example.com/failure' });
    const body = '回答正文，参考 [文内链接](https://example.com/body)。';
    const stored = body + web.footer();
    assert.match(stored, /查询来源|本轮查询未取得/);
    assert.equal(stripHistoryRetrievalNotices(stored), body);
    assert.equal(stripHistoryRetrievalNotices(stored.replaceAll('\n', '\r\n')), body);
    const withStatus = stored + buildRetrievalNotice({ toolCalled: true });
    assert.equal(stripHistoryRetrievalNotices(withStatus), body);
    assert.equal(stripHistoryRetrievalNotices(withStatus + '\n\n_回复已中止_'), body + '\n\n_回复已中止_');
    assert.equal(stripRetrievalNotices(withStatus), stored, 'QQ finalization retains this turn’s sources');
  }
});

test('history retains ordinary source sections, body text and fenced examples', () => {
  const footer = '\n\n---\n**查询来源**（查询时间：2026-10-27T00:00:00.000Z）\n\n1. [资料](<https://example.com>)';
  for (const content of [
    '正文中的 **查询来源** 与 https://example.com',
    '正文\n\n---\n**查询来源**\n\n1. [资料](https://example.com)',
    '正文' + footer + '\n\n这里还有正文。',
    '```markdown\n示例' + footer + '\n```',
    '```markdown\n示例' + footer,
    '~~~markdown\n示例' + footer,
  ]) assert.equal(stripHistoryRetrievalNotices(content), content);
  assert.equal(stripHistoryRetrievalNotices('```\n代码\n```\n\n正文' + footer), '```\n代码\n```\n\n正文');
});

test('web and QQ history strips only assistant footers without changing stored messages', () => {
  const content = '正文\n\n---\n**查询来源**（查询时间：2026-10-27T00:00:00.000Z）\n\n1. [资料](<https://example.com>)';
  const history = ['user', 'assistant'].map(role => ({ role, content, createdAt: new Date('2026-10-27T00:00:00Z') }));
  const prepared = buildAssistantHistory(history);
  assert.equal(prepared[0].content, content);
  assert.equal(prepared[1].content, '正文');
  assert.equal(prepared[1].createdAt.toISOString(), '2026-10-27T00:00:00.000Z');
  assert.equal(history[1].content, content);
});

test('retrieval notices distinguish no retrieval, weather success, pending and failure', () => {
  assert.equal(buildRetrievalNotice(), '');
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
