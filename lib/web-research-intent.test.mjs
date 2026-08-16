import assert from 'node:assert/strict';
import test from 'node:test';
import { needsWebResearch } from './web-research-intent.mjs';

test('negative research requirements stay offline', () => {
  assert.equal(needsWebResearch('页面无需联网资源，可直接在本地打开'), false);
  assert.equal(needsWebResearch('不要搜索或联网，使用本地文件'), false);
  assert.equal(needsWebResearch('本次不进行联网，只分析给定内容'), false);
  assert.equal(needsWebResearch('不联网，不读取或写入工作区文件'), false);
  assert.equal(needsWebResearch('不需要最新数据，也无需提供来源链接'), false);
  assert.equal(needsWebResearch('制作市场营销页面，不使用外部资源'), false);
  assert.equal(needsWebResearch('页面需要包含商品搜索、上架状态筛选和商品列表'), false);
  assert.equal(needsWebResearch('实现按名称和关键词实时过滤的搜索框'), false);
  assert.equal(needsWebResearch('创建支持订单搜索的移动端页面，不使用外部资源'), false);
  assert.equal(needsWebResearch('验收标准：打开即可看到完整页面，搜索、筛选、新增三项交互均可正常工作'), false);
  assert.equal(needsWebResearch(
    '创建移动端商品管理页面 index.html，包含商品搜索框、状态筛选和商品列表。' +
    '不得引用任何外部资源，不依赖网络即可预览。搜索、筛选、新增三项交互均可正常工作。'
  ), false);
});

test('positive research requirements still request web access', () => {
  assert.equal(needsWebResearch('联网检索官方最新利率'), true);
  assert.equal(needsWebResearch('搜索一下当前黄金价格'), true);
  assert.equal(needsWebResearch('页面提供搜索最新行业新闻的功能'), true);
  assert.equal(needsWebResearch('整理数据并提供来源链接'), true);
  assert.equal(needsWebResearch('无需联网运行，但仍需搜索最新资料后写入页面'), true);
});
