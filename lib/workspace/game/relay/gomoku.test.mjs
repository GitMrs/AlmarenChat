import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGomokuAction, createGomokuState, gomokuResult, validateGomokuAction } from './gomoku.mjs';

test('gomoku validates bounds and occupied cells', () => {
  const state = createGomokuState();
  assert.throws(() => validateGomokuAction(state, { row: 0, column: 1 }), /超出/);
  const next = applyGomokuAction(state, { row: 8, column: 8 }, 0, 'a', '甲');
  assert.throws(() => validateGomokuAction(next, { row: 8, column: 8 }), /已有棋子/);
});

test('gomoku detects a five-stone line without mutating earlier states', () => {
  let state = createGomokuState();
  for (let column = 1; column <= 5; column += 1) {
    state = applyGomokuAction(state, { row: 8, column }, 0, 'a', '甲');
    if (column < 5) state = applyGomokuAction(state, { row: 9, column }, 1, 'b', '乙');
  }
  assert.equal(state.status, 'won');
  assert.equal(state.winner, 1);
  assert.match(gomokuResult(state), /甲 获胜/);
  assert.equal(createGomokuState().board.every((cell) => cell === 0), true);
});
