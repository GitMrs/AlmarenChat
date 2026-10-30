import test from 'node:test';
import assert from 'node:assert/strict';
import { completeExperienceEntries, deterministicUserExperience, selectExperienceContext } from './experience-context-policy.mjs';

function experience(summary, id = 'one', startAt = '2026-10-30T16:10:00Z') {
  return { id, summary, startAt: new Date(startAt), endAt: new Date(startAt), messageCount: 48 };
}

test('time questions and greetings do not recall old generic chatter', () => {
  const pool = [experience('- 用户当时提到：现在几点？\n- 助理当时回应：现在都已经是凌晨了，你有点累。')];
  assert.equal(selectExperienceContext(pool, '现在时间对吗'), '');
  assert.equal(selectExperienceContext(pool, '你好'), '');
});

test('retrieval selects matching entries rather than an entire archive and uses Beijing dates', () => {
  const pool = [experience('- 用户明确预约手机换电池，费用159元，当时计划。\n- 助理曾称T1已晋级。\n- 用户修改了时间标注策略：不带标签直接对话。')];
  const text = selectExperienceContext(pool, '还记得手机换电池的安排吗？');
  assert.match(text, /2026-10-31，北京时间/);
  assert.match(text, /159元/);
  assert.doesNotMatch(text, /T1|时间标注策略/);
  assert.match(text, /转述用户信息，未复核/);
});

test('assistant assertions and mixed legacy summaries are explicitly unverified', () => {
  const text = selectExperienceContext([experience('- 用户询问T1赛程，助理称T1已经晋级八强。')], '还记得T1赛程吗');
  assert.match(text, /含助理说法，未独立核实/);
  assert.match(text, /T1已经晋级/);
});

test('fallback archives only substantive user statements, not assistant inventions or old rules', () => {
  const createdAt = new Date('2026-10-30T16:10:00Z');
  const summary = deterministicUserExperience([
    { role: 'user', content: 'hello', createdAt },
    { role: 'assistant', content: '你昨晚只睡了六个小时，T1已经晋级。', createdAt },
    { role: 'user', content: '用户修改时间标注策略，不带时间就不计算间隔。', createdAt },
    { role: 'user', content: '我预约了明天11点换手机电池。', createdAt },
  ]);
  assert.match(summary, /用户当时陈述，2026-10-31 00:10，北京时间/);
  assert.match(summary, /明天11点换手机电池/);
  assert.doesNotMatch(summary, /hello|六个小时|T1|时间标注/);
});

test('whole-entry budgets never inject half a timestamp or cut an item', () => {
  assert.equal(completeExperienceEntries('- 完整条目。\n- ' + '长'.repeat(1000) + '\n- [202', 50), '- 完整条目。');
  const summary = Array.from({ length: 12 }, (_, index) => `- 用户手机换电池记录${index}，${'细节'.repeat(80)}。`).join('\n');
  const text = selectExperienceContext([experience(summary)], '手机换电池', { maxChars: 1000 });
  assert.ok(text.length <= 1000);
  assert.ok(text.endsWith('。'));
});

test('fallback does not truncate long commands into spurious user facts', () => {
  const summary = deterministicUserExperience([{ role: 'user', content: '指令'.repeat(1000), createdAt: new Date() }]);
  assert.match(summary, /归档说明/);
  assert.equal(selectExperienceContext([experience(summary)], '回顾过去的经历'), '');
});

test('yesterday recall does not retrieve a matching event from a month earlier', () => {
  const text = selectExperienceContext([
    experience('- 用户当时提到：我吃了饺子。', 'old', '2026-09-24T12:00:00Z'),
    experience('- 用户当时提到：我吃了饺子。', 'yesterday', '2026-10-29T12:00:00Z'),
  ], '昨天吃了什么饺子？', { now: new Date('2026-10-30T12:00:00Z') });
  assert.match(text, /2026-10-29/);
  assert.doesNotMatch(text, /2026-09-24/);
});

test('user questions are not archived as confirmed claims', () => {
  const summary = deterministicUserExperience([{ role: 'user', content: 'T1已经晋级了吗？', createdAt: new Date() }]);
  assert.match(summary, /归档说明/);
  assert.doesNotMatch(summary, /T1/);
});
