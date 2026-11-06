import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanDate, planDateQuery } from './plan-time.mjs';
import { archiveMemorySegments, buildChatArchiveFallback } from './chat-archive.mjs';
import { recallExperiences, memoryArchiveDateFilter } from './memory-recall.mjs';

const monday = '2026-11-02 09:00';
const friday = new Date('2026-11-06T10:00:00Z');
const record = (id, time, content, type = 'plan', source = 'user') => ({
  id, startAt: `${time.replace(' ', 'T')}:00+08:00`, endAt: `${time.replace(' ', 'T')}:00+08:00`,
  summary: content, memorySegments: [{ source, type, occurredAt: time, content }],
});

test('plan dates use original Beijing source time and refuse ambiguous or invalid dates', () => {
  for (const [index, weekday] of [...'一二三四五六日'].entries()) {
    assert.equal(resolvePlanDate(`周${weekday}要出门`, monday), `2026-11-0${index + 2}`);
  }
  assert.equal(resolvePlanDate('周五要坐火车', monday), '2026-11-06');
  assert.equal(resolvePlanDate('明天坐火车', '2026-12-31 23:59'), '2027-01-01');
  assert.equal(resolvePlanDate('明天坐火车', new Date('2026-11-02T17:00:00Z')), '2026-11-04');
  assert.equal(resolvePlanDate('下周五坐火车', monday), '2026-11-13');
  assert.equal(resolvePlanDate('周五坐火车', '2026-11-07 09:00'), null);
  assert.equal(resolvePlanDate('周末坐火车', monday), null);
  assert.equal(resolvePlanDate('2026-02-30坐火车', monday), null);
  assert.equal(resolvePlanDate('周五或周六坐火车', monday), null);
  assert.equal(resolvePlanDate('周五火车改到周六', monday), '2026-11-07');
  assert.equal(planDateQuery('周五有什么计划', friday), '2026-11-06');
  assert.equal(planDateQuery('周一我说过什么计划', friday), null);
});

test('model and offline archives retain source time separately from the plan target', () => {
  const summary = '- [用户陈述，2026-11-02 09:00，北京时间，类型：plan] 周五要坐火车。';
  for (const text of [summary, '- [用户当时陈述，2026-11-02 09:00，北京时间；当时计划，是否完成待确认] 周五要坐火车。', buildChatArchiveFallback([{ id: 'm', role: 'user', content: '周五要坐火车。', createdAt: new Date('2026-11-02T01:00:00Z') }])]) {
    const [segment] = archiveMemorySegments(text);
    assert.equal(segment.occurredAt, monday);
    assert.equal(segment.targetDate, '2026-11-06');
    assert.equal(segment.type, 'plan');
    assert.match(segment.content, /火车/);
  }
  const explicit = buildChatArchiveFallback([{ id: 'explicit', role: 'user', content: '2026-11-06要坐火车。', createdAt: new Date('2026-11-02T01:00:00Z') }]);
  assert.equal(archiveMemorySegments(explicit)[0].targetDate, '2026-11-06');
});

test('Friday schedules recall Monday plans, while source-date questions retain their original meaning', () => {
  const pool = [record('train', monday, '周五要坐火车'), record('meal', monday, '周六去聚餐')];
  for (const query of ['周五有什么计划', '今天有什么安排', '2026-11-06有什么行程']) {
    const result = recallExperiences(pool, query, { now: friday });
    assert.deepEqual(result.items.map(item => item.id), ['train']);
    assert.match(result.context, /计划目标日期：2026-11-06/);
    assert.match(result.context, /2026-11-02 09:00/);
    assert.match(result.context, /没有完成证据/);
    assert.deepEqual(memoryArchiveDateFilter(query, 'assistant'), {});
    assert.deepEqual(memoryArchiveDateFilter(query, 'agent'), {});
  }
  assert.equal(recallExperiences(pool, '周一我说过什么计划', { now: friday }).items.length, 2);
  assert.equal(recallExperiences(pool, '周五我说过什么计划', { now: friday }).items.length, 0);
  assert.match(recallExperiences(pool, '之前有什么计划', { now: new Date('2026-11-09T10:00:00Z') }).context, /日期已过不代表已完成/);
});

test('reschedules, cancellations and completions return later user evidence without promoting assistant guesses', () => {
  const original = record('train', monday, '周五要坐火车');
  for (const content of ['火车取消了，不去了', '周五火车改到周六了', '火车已经坐完了']) {
    const result = recallExperiences([
      original, record('change', '2026-11-05 10:00', content, 'event'),
      record('other', '2026-11-05 11:00', '聚餐取消了', 'event'),
      record('guess', '2026-11-05 12:00', '火车取消了', 'event', 'assistant'),
      record('suggestion', monday, '周五去看电影', 'plan', 'assistant'),
    ], '今天有什么安排', { now: friday });
    assert.match(result.context, /相关后续变更证据/);
    assert.match(result.context, new RegExp(content));
    assert.doesNotMatch(result.context, /聚餐|看电影|记忆存档ID：guess/);
  }
  const changed = record('changed', '2026-11-05 10:00', '周五火车改到周六了');
  assert.deepEqual(recallExperiences([original, changed], '周六有什么计划', { now: friday }).items.map(item => item.id), ['changed']);
});
