import assert from 'node:assert/strict';
import test from 'node:test';
import { needsWebResearch } from './web-research-intent.mjs';

test('negative research requirements stay offline', () => {
  assert.equal(needsWebResearch('页面无需联网资源，可直接在本地打开'), false);
  assert.equal(needsWebResearch('不要搜索或联网，使用本地文件'), false);
  assert.equal(needsWebResearch('不需要最新数据，也无需提供来源链接'), false);
  assert.equal(needsWebResearch('制作市场营销页面，不使用外部资源'), false);
});

test('positive research requirements still request web access', () => {
  assert.equal(needsWebResearch('联网检索官方最新利率'), true);
  assert.equal(needsWebResearch('整理数据并提供来源链接'), true);
  assert.equal(needsWebResearch('无需联网运行，但仍需搜索最新资料后写入页面'), true);
});
