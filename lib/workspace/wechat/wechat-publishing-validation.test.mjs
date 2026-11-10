import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWechatPublishingSettings, validateWechatArticle, wechatCoverCrop } from './wechat-publishing-validation.mjs';

test('publishing limits reject excess text without truncating Unicode titles', () => {
  assert.equal(validateWechatArticle({ title: '🐱'.repeat(32), content: '文'.repeat(19999) }).title, '🐱'.repeat(32));
  for (const input of [
    { title: '文'.repeat(33), content: '正文' },
    { title: '标题', content: '文'.repeat(20000) },
    { title: '标题', content: '正文', author: '文'.repeat(17) },
    { title: '标题', content: '正文', digest: '文'.repeat(121) },
    { title: ' ', content: '正文' },
  ]) assert.throws(() => validateWechatArticle(input), { code: 'INVALID_INPUT' });
});

test('publishing settings constrain URLs, switches and crop ownership', () => {
  const crops = ['2.35_1', '1_1'].map((ratio) => wechatCoverCrop(1200, 800, ratio));
  const settings = normalizeWechatPublishingSettings({ coverFileId: 'cover-1', coverInfo: { crop_percent_list: crops }, contentSourceUrl: 'https://example.com/source', fansOnlyComment: true });
  assert.equal(settings.fansOnlyComment, false);
  assert.equal(settings.coverInfo.crop_percent_list[0].x1, '0');
  for (const input of [
    { contentSourceUrl: 'javascript:alert(1)' }, { contentSourceUrl: 'https://user:pass@example.com' },
    { openComment: 'false' }, { themeId: 'missing' },
    { coverInfo: { crop_percent_list: crops } },
    { coverFileId: 'cover-1', coverInfo: { crop_percent_list: [null, crops[0]] } },
    { coverFileId: 'cover-1', coverInfo: { crop_percent_list: [crops[0], crops[0]] } },
    { coverFileId: 'cover-1', coverInfo: { crop_percent_list: [{ ...crops[0], x2: 2 }, crops[1]] } },
  ]) assert.throws(() => normalizeWechatPublishingSettings(input), { code: 'INVALID_INPUT' });
});

test('cover crop coordinates match object-fit cover at edge and center positions', () => {
  for (const [width, height] of [[1200, 800], [800, 1200], [1000, 1000]]) {
    for (const ratio of ['2.35_1', '1_1']) for (const focus of [0, 50, 100]) {
      const crop = wechatCoverCrop(width, height, ratio, focus, focus);
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((key) => Number(crop[key]));
      assert.ok(x1 >= 0 && y1 >= 0 && x2 <= 1 && y2 <= 1);
      assert.ok(Math.abs((x2 - x1) * width / ((y2 - y1) * height) - (ratio === '1_1' ? 1 : 2.35)) < 0.00002);
      assert.ok(Math.abs(x1 - (1 - (x2 - x1)) * focus / 100) < 0.000002);
      assert.ok(Math.abs(y1 - (1 - (y2 - y1)) * focus / 100) < 0.000002);
    }
  }
  assert.throws(() => wechatCoverCrop(Infinity, 800, '1_1'), { code: 'INVALID_INPUT' });
  assert.throws(() => wechatCoverCrop(1200, 800, '1_1', NaN), { code: 'INVALID_INPUT' });
});
