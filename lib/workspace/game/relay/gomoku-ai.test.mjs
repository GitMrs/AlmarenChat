import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findBestMove,
  checkWin,
  getCharacterLine,
  getUndoLine,
  getAdvisorHint,
  getKokoCheer,
} from './gomoku-ai.ts';

test('getCharacterLine should produce valid clean lines without character name prefixes', () => {
  const agents = ['gaming-lulu', 'gaming-nox', 'gaming-koko'];
  const situations = [
    'normal',
    'player_blocked',
    'player_formed_three',
    'ai_formed_four',
    'ai_blocked_three',
    'ai_won',
    'player_won',
    'corner_move',
  ];

  for (const agent of agents) {
    for (const situation of situations) {
      for (let i = 0; i < 5; i++) {
        const line = getCharacterLine(agent, situation);
        assert.ok(typeof line === 'string' && line.length > 0, `Line for ${agent}-${situation} should not be empty`);
        assert.ok(!line.startsWith('璐璐：'), `Line "${line}" should not have prefix 璐璐：`);
        assert.ok(!line.startsWith('诺克斯：'), `Line "${line}" should not have prefix 诺克斯：`);
        assert.ok(!line.startsWith('可可：'), `Line "${line}" should not have prefix 可可：`);
      }
    }
  }
});

test('getCharacterLine handles opening and endgame context', () => {
  const openingLine = getCharacterLine('gaming-lulu', 'normal', { moveCount: 2 });
  assert.ok(typeof openingLine === 'string' && openingLine.length > 0);

  const endgameLine = getCharacterLine('gaming-nox', 'normal', { moveCount: 25 });
  assert.ok(typeof endgameLine === 'string' && endgameLine.length > 0);
});

test('getCharacterLine handles opponent interaction context', () => {
  // Over multiple iterations, opponent banter should be callable without error
  for (let i = 0; i < 20; i++) {
    const banter = getCharacterLine('gaming-lulu', 'normal', { opponentId: 'gaming-nox' });
    assert.ok(typeof banter === 'string' && banter.length > 0);
    assert.ok(!banter.startsWith('璐璐：'));
  }
});

test('getUndoLine returns characteristic lines for all agents', () => {
  const agents = ['gaming-lulu', 'gaming-nox', 'gaming-koko', 'unknown'];
  for (const agent of agents) {
    const undoLine = getUndoLine(agent);
    assert.ok(typeof undoLine === 'string' && undoLine.length > 0);
    assert.ok(!undoLine.startsWith('璐璐：'));
    assert.ok(!undoLine.startsWith('诺克斯：'));
    assert.ok(!undoLine.startsWith('可可：'));
  }
});

test('getAdvisorHint returns coordinates and tactical reasoning', () => {
  const board = Array(225).fill(0);
  // Human has two stones at center
  board[7 * 15 + 7] = 1; // row 8, col 8
  board[7 * 15 + 8] = 1; // row 8, col 9

  const hint = getAdvisorHint(board);
  assert.ok(hint.row >= 1 && hint.row <= 15);
  assert.ok(hint.col >= 1 && hint.col <= 15);
  assert.ok(typeof hint.reason === 'string' && hint.reason.length > 0);
});

test('getKokoCheer produces clean and varied cheers', () => {
  const cheer1 = getKokoCheer('gaming-lulu', null);
  const cheer2 = getKokoCheer('gaming-nox', null);
  const cheerWin = getKokoCheer('gaming-lulu', 'player');
  const cheerLoss = getKokoCheer('gaming-lulu', 'ai');

  for (const c of [cheer1, cheer2, cheerWin, cheerLoss]) {
    assert.ok(typeof c === 'string' && c.length > 0);
    assert.ok(!c.startsWith('可可：'));
  }
});

test('checkWin detects 5 consecutive stones correctly', () => {
  const board = Array(225).fill(0);
  for (let c = 3; c <= 7; c++) {
    board[5 * 15 + (c - 1)] = 1;
  }
  const result = checkWin(board, 6, 7, 1);
  assert.equal(result.won, true);
  assert.equal(result.line?.length, 5);
});
