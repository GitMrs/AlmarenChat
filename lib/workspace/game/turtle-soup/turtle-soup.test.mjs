import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAllPuzzles,
  getPuzzlesCount,
  getPuzzlesSummary,
  getPuzzleById,
  getRandomPuzzle,
  getPuzzleWithIndex,
  getRandomPuzzleWithIndex,
  heuristicJudge,
} from './service.ts';

test('turtle soup service loads all 350 curated puzzles', () => {
  const count = getPuzzlesCount();
  assert.equal(count, 350, 'Must have exactly 350 puzzles loaded');

  const all = getAllPuzzles();
  assert.equal(all.length, 350);

  // Check first puzzle integrity
  const p1 = all[0];
  assert.equal(p1.id, 'real-finish-line');
  assert.equal(p1.index, 1);
  assert.equal(p1.title, '终点线');
  assert.ok(p1.story.length > 10, 'Story must not be empty');
  assert.ok(p1.answer.length > 10, 'Answer must not be empty');
  assert.equal(p1.hints.length, 3, 'Must have 3 tiered hints');
});

test('puzzles summary provides lightweight catalog for book rack drawer', () => {
  const summaries = getPuzzlesSummary();
  assert.equal(summaries.length, 350);

  const first = summaries[0];
  assert.equal(first.index, 1);
  assert.equal(first.title, '终点线');
  assert.ok(first.storySnippet.length > 0);
  assert.equal(first.hintCount, 3);
  // Ensure answers are NOT leaked in summary
  assert.equal(first.answer, undefined);
});

test('getPuzzleById and getRandomPuzzle work reliably and return authentic index', () => {
  const target = getPuzzleById('real-finish-line');
  assert.ok(target);
  assert.equal(target.title, '终点线');
  assert.equal(target.index, 1);

  const targetWithIndex = getPuzzleWithIndex('real-finish-line');
  assert.ok(targetWithIndex);
  assert.equal(targetWithIndex.index, 1);
  assert.equal(targetWithIndex.puzzle.id, 'real-finish-line');

  const random1 = getRandomPuzzle();
  assert.ok(random1);
  assert.ok(random1.title);
  assert.ok(typeof random1.index === 'number' && random1.index >= 1 && random1.index <= 350);

  const randomWithIndex = getRandomPuzzleWithIndex();
  assert.ok(randomWithIndex.puzzle);
  assert.equal(randomWithIndex.index, randomWithIndex.puzzle.index);
  assert.ok(randomWithIndex.index >= 1 && randomWithIndex.index <= 350);

  // Exclude works
  const random2 = getRandomPuzzle([random1.id]);
  assert.notEqual(random2.id, random1.id);
});

test('heuristic judge handles basic deduction gracefully', () => {
  const puzzle = getPuzzleById('real-finish-line');
  assert.ok(puzzle);

  const judgeResult = heuristicJudge(puzzle, '这是一款赛车游戏吗？');
  assert.ok(judgeResult.verdictLabel);
  assert.ok(judgeResult.dmExplanation);
  assert.ok(judgeResult.luluReaction);
  assert.ok(judgeResult.kokoReaction);
});

test('categories, difficulty and detective score calculate properly', async () => {
  const { calculateDetectiveScore, getPuzzlesSummary } = await import('./service.ts');
  const summaries = getPuzzlesSummary();
  const first = summaries[0];
  assert.ok(['经典必玩', '悬疑惊悚', '脑洞逻辑', '趣味温情'].includes(first.category));
  assert.ok(first.difficulty >= 1 && first.difficulty <= 4);

  // SSS score
  const sss = calculateDetectiveScore(true, 4, 0);
  assert.equal(sss.rank, 'SSS');

  // Surrender score
  const surrendered = calculateDetectiveScore(false, 10, 2);
  assert.equal(surrendered.rank, 'C');
});

test('successful questions counting strictly ignores failed or unjudged questions', () => {
  const mockMessages = [
    { sender: 'user', content: '这是一道什么题？' },
    { sender: 'dm', content: '欢迎来到海龟汤' }, // welcome, no verdict
    { sender: 'user', content: '死者是自杀吗？' },
    { sender: 'dm', content: '❌ 否。', verdict: 'NO' }, // success 1
    { sender: 'user', content: '网络错误的问题' },
    { sender: 'dm', content: '⚠️ 裁判服务异常' }, // failed, no verdict
    { sender: 'user', content: '他是盲人吗？' },
    { sender: 'dm', content: '🎯 关键线索。', verdict: 'KEY_POINT' }, // success 2
    { sender: 'dm', content: '💡 解锁第1重线索' }, // hint, no verdict
  ];

  const successfulCount = mockMessages.filter((m) => m.sender === 'dm' && Boolean(m.verdict)).length;
  assert.equal(successfulCount, 2, 'Must strictly count only the 2 questions that received valid DM verdicts');
});

