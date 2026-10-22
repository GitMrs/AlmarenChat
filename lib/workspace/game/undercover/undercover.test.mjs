import test from 'node:test';
import assert from 'node:assert/strict';
import { WORD_PAIRS, getRandomWordPair } from './words.ts';
import {
  createUndercoverGame,
  getAgentClueStatement,
  getAgentDebateLine,
  determineAgentVote,
  tallyVotes,
  checkUndercoverGameOver,
} from './engine.ts';

test('WORD_PAIRS has rich balanced pairs and non-empty clues', () => {
  assert.ok(WORD_PAIRS.length >= 5);
  for (const pair of WORD_PAIRS) {
    assert.ok(pair.civilianWord && pair.civilianWord.length > 0);
    assert.ok(pair.undercoverWord && pair.undercoverWord.length > 0);
    assert.notEqual(pair.civilianWord, pair.undercoverWord);
    assert.ok(pair.clues.lulu.civilian.length >= 2);
    assert.ok(pair.clues.lulu.undercover.length >= 2);
    assert.ok(pair.clues.koko.civilian.length >= 2);
    assert.ok(pair.clues.nox.civilian.length >= 2);
  }
});

test('createUndercoverGame sets up 4 players with exactly 1 undercover', () => {
  const game = createUndercoverGame('测试玩家');
  assert.equal(game.players.length, 4);

  const user = game.players.find((p) => p.id === 'user');
  assert.ok(user);
  assert.equal(user.name, '测试玩家');

  const undercovers = game.players.filter((p) => p.role === 'undercover');
  const civilians = game.players.filter((p) => p.role === 'civilian');
  assert.equal(undercovers.length, 1);
  assert.equal(civilians.length, 3);

  // Verify word assignment
  for (const p of game.players) {
    if (p.role === 'undercover') {
      assert.equal(p.word, game.undercoverWord);
    } else {
      assert.equal(p.word, game.civilianWord);
    }
  }

  assert.equal(game.speakerOrder.length, 4);
});

test('getAgentClueStatement produces personality-driven statements', () => {
  const game = createUndercoverGame();
  const lulu = game.players.find((p) => p.id === 'gaming-lulu');
  const statement = getAgentClueStatement(lulu, game.wordPair, 1);
  assert.ok(typeof statement === 'string' && statement.length > 0);

  const koko = game.players.find((p) => p.id === 'gaming-koko');
  const kokoStmt = getAgentClueStatement(koko, game.wordPair, 1);
  assert.ok(typeof kokoStmt === 'string' && kokoStmt.length > 0);

  const nox = game.players.find((p) => p.id === 'gaming-nox');
  const noxStmt = getAgentClueStatement(nox, game.wordPair, 1);
  assert.ok(typeof noxStmt === 'string' && noxStmt.length > 0);
});

test('tallyVotes resolves clear winners and ties', () => {
  const players = [
    { id: 'p1', isAlive: true },
    { id: 'p2', isAlive: true },
    { id: 'p3', isAlive: true },
    { id: 'p4', isAlive: true },
  ];

  // Clear winner
  const votes1 = { p1: 'p2', p3: 'p2', p4: 'p1' };
  const res1 = tallyVotes(votes1, players);
  assert.equal(res1.isTie, false);
  assert.equal(res1.eliminatedId, 'p2');

  // Tie
  const votes2 = { p1: 'p2', p3: 'p4' };
  const res2 = tallyVotes(votes2, players);
  assert.equal(res2.isTie, true);
  assert.equal(res2.eliminatedId, null);
});

test('checkUndercoverGameOver correctly detects civilian or undercover win', () => {
  // Case 1: Undercover eliminated -> civilian wins
  const players1 = [
    { id: 'u', role: 'undercover', isAlive: false },
    { id: 'c1', role: 'civilian', isAlive: true },
    { id: 'c2', role: 'civilian', isAlive: true },
  ];
  const res1 = checkUndercoverGameOver(players1);
  assert.equal(res1.isOver, true);
  assert.equal(res1.winner, 'civilian');

  // Case 2: 1 civilian vs 1 undercover -> undercover wins
  const players2 = [
    { id: 'u', role: 'undercover', isAlive: true },
    { id: 'c1', role: 'civilian', isAlive: true },
    { id: 'c2', role: 'civilian', isAlive: false },
  ];
  const res2 = checkUndercoverGameOver(players2);
  assert.equal(res2.isOver, true);
  assert.equal(res2.winner, 'undercover');

  // Case 3: Still in progress (2 civilians, 1 undercover)
  const players3 = [
    { id: 'u', role: 'undercover', isAlive: true },
    { id: 'c1', role: 'civilian', isAlive: true },
    { id: 'c2', role: 'civilian', isAlive: true },
  ];
  const res3 = checkUndercoverGameOver(players3);
  assert.equal(res3.isOver, false);
  assert.equal(res3.winner, null);
});

test('Undercover dual engine switch defaults to ai and toggles correctly', async () => {
  const { setUndercoverEngineMode } = await import('./engine.ts');
  const game = createUndercoverGame();
  assert.equal(game.engineMode, 'ai');

  const gameCode = setUndercoverEngineMode(game, 'code');
  assert.equal(gameCode.engineMode, 'code');
  assert.equal(game.engineMode, 'ai');
});

test('Undercover AI player prompt builders and parsers handle JSON and fallback gracefully', async () => {
  const {
    buildStatementPrompt,
    parseStatementResponse,
    buildDebatePrompt,
    parseDebateResponse,
    buildVotePrompt,
    parseVoteResponse,
    buildGuessPrompt,
    parseGuessResponse,
  } = await import('./ai-player.ts');

  // Statement prompt & parse
  const stmtP = buildStatementPrompt({
    agentName: '璐璐',
    agentPersona: '傲娇猫系',
    word: '西瓜',
    round: 1,
    historyStatements: [{ playerName: '玩家', text: '夏天的水果' }],
  });
  assert.ok(stmtP.systemPrompt.includes('璐璐') && stmtP.systemPrompt.includes('西瓜'));
  assert.equal(parseStatementResponse('```json\n{"statement": "红瓤黑籽很清甜"}\n```', '兜底'), '红瓤黑籽很清甜');
  assert.equal(parseStatementResponse('', '兜底语句'), '兜底语句');

  // Debate prompt & parse
  const debateP = buildDebatePrompt({
    agentName: '诺克斯',
    agentPersona: '战术军师',
    word: '西瓜',
    round: 1,
    allStatements: [
      { playerId: 'user', playerName: '玩家', text: '必须趁热吃' },
      { playerId: 'gaming-lulu', playerName: '璐璐', text: '夏天的解暑水果' },
    ],
    candidates: [{ playerId: 'user', playerName: '玩家' }],
  });
  assert.ok(debateP.userPrompt.includes('必须趁热吃'));
  const parsedDebate = parseDebateResponse(
    '{"suspectId": "user", "suspectName": "玩家", "debateText": "逻辑冲突极大，建议集中投票"}',
    { playerId: 'fallback', playerName: '备选' },
    '兜底辩论'
  );
  assert.equal(parsedDebate.suspectId, 'user');
  assert.equal(parsedDebate.debateText, '逻辑冲突极大，建议集中投票');

  // Vote prompt & parse
  const voteP = buildVotePrompt({
    agentName: '可可',
    agentPersona: '元气小狐狸',
    word: '西瓜',
    round: 1,
    allStatements: [],
    aliveCandidates: [{ id: 'gaming-lulu', name: '璐璐' }, { id: 'user', name: '玩家' }],
  });
  assert.ok(voteP.systemPrompt.includes('璐璐(id: gaming-lulu)'));
  const parsedVote = parseVoteResponse('{"targetId": "user", "reason": "嫌疑最大"}', ['user', 'gaming-lulu'], 'gaming-lulu');
  assert.equal(parsedVote.targetId, 'user');
  assert.equal(parsedVote.reason, '嫌疑最大');

  // Guess prompt & parse
  const guessP = buildGuessPrompt({
    agentName: '璐璐',
    agentPersona: '傲娇猫系',
    undercoverWord: '哈密瓜',
    allClues: [{ playerName: '玩家', text: '夏天大圆瓜，红色的瓤' }],
  });
  assert.ok(guessP.userPrompt.includes('夏天大圆瓜'));
  const parsedGuess = parseGuessResponse('{"guessWord": "西瓜", "reasoning": "根据红瓤线索推断"}', '');
  assert.equal(parsedGuess.guessWord, '西瓜');
});

