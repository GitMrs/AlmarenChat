import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automationAuthorization,
  initialAutomationRunAt,
  normalizeAutomationSchedule,
  nextAutomationRunAt,
  normalizeAutomationInterval,
  normalizeAutomationCompletion,
} from './space-automation-policy.mjs';

test('automation intervals are bounded and skip missed occurrences', () => {
  assert.equal(normalizeAutomationInterval(15), 15);
  assert.throws(() => normalizeAutomationInterval(14), /15 到 43200/);
  assert.equal(
    nextAutomationRunAt('2026-09-08T00:00:00.000Z', 60, '2026-09-08T03:20:00.000Z').toISOString(),
    '2026-09-08T04:00:00.000Z'
  );
});

test('automation completion actions are restricted to matching scenario templates', () => {
  assert.deepEqual(normalizeAutomationCompletion({}, 'wechat-article'), {
    completionAction: 'NONE', completionConfig: null,
  });
  assert.deepEqual(normalizeAutomationCompletion({
    completionAction: 'WECHAT_CREATE_DRAFT', completionConfig: { themeId: 'editorial-red' },
  }, 'wechat-article'), {
    completionAction: 'WECHAT_CREATE_DRAFT', completionConfig: { themeId: 'editorial-red' },
  });
  assert.throws(() => normalizeAutomationCompletion({ completionAction: 'WECHAT_CREATE_DRAFT' }, 'short-video-script'), /只有公众号创作室/);
  assert.throws(() => normalizeAutomationCompletion({
    completionAction: 'WECHAT_CREATE_DRAFT', completionConfig: { themeId: 'unknown' },
  }, 'wechat-article'), /主题无效/);
});

test('daily and weekly schedules resolve local wall-clock time into UTC', () => {
  const daily = normalizeAutomationSchedule({
    scheduleType: 'DAILY', timeZone: 'Asia/Shanghai', scheduleHour: 9, scheduleMinute: 0,
  });
  assert.equal(initialAutomationRunAt(daily, '2026-09-08T00:00:00.000Z').toISOString(), '2026-09-08T01:00:00.000Z');

  const weekly = normalizeAutomationSchedule({
    scheduleType: 'WEEKLY', timeZone: 'Asia/Shanghai', scheduleHour: 9, scheduleMinute: 0, weekdays: [1],
  });
  assert.equal(initialAutomationRunAt(weekly, '2026-09-08T02:00:00.000Z').toISOString(), '2026-09-14T01:00:00.000Z');
});

test('automation authorization keeps network access explicit', () => {
  const offline = automationAuthorization({ prompt: '写一篇文章', networkPolicy: 'forbidden' }, {
    deliverables: ['article.md'],
  });
  assert.deepEqual(offline.capabilities, ['workspace_read', 'workspace_write']);
  assert.equal(offline.networkPolicy, 'forbidden');
  assert.deepEqual(offline.deliverables, ['article.md']);

  const online = automationAuthorization({ prompt: '调研后写文章', networkPolicy: 'allowed' });
  assert.equal(online.capabilities.includes('web_research'), true);
  assert.equal(online.networkPolicy, 'allowed');

  const publishing = automationAuthorization({
    prompt: '写文章', networkPolicy: 'forbidden', completionAction: 'WECHAT_CREATE_DRAFT',
  });
  assert.equal(publishing.capabilities.includes('image_generate'), true);
  assert.equal(publishing.capabilities.includes('image_generation'), false);
  assert.equal(publishing.deliverables.some((item) => item.includes('Markdown')), true);
});
