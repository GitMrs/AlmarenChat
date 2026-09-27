import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rollSingleDie,
  rollDice,
  evaluateCocCheck,
  evaluateDndCheck,
} from './dice.ts';
import { SCENARIOS } from './scenarios.ts';
import {
  createTrpgGame,
  selectChoice,
  executePendingCheck,
  rerollWithFatePoint,
  performFreeAction,
  generateTrpgBattleReport,
  getItemDefinition,
  useInventoryItem,
  triggerCompanionAssist,
  saveTrpgGame,
  loadSavedTrpgGame,
  clearSavedTrpgGame,
} from './engine.ts';

test('Dice module generates numbers within correct range', () => {
  for (let i = 0; i < 50; i++) {
    const d20 = rollSingleDie(20);
    assert.ok(d20 >= 1 && d20 <= 20, `d20 was ${d20}`);

    const d100 = rollDice('d100');
    assert.ok(d100.roll >= 1 && d100.roll <= 100, `d100 was ${d100.roll}`);
    assert.equal(d100.sides, 100);
  }
});

test('evaluateCocCheck accurately classifies critical success, success, failure, and fumble', () => {
  // Target skill = 60
  // Extreme <= 12, Hard <= 30, Success <= 60, Failure 61-99, Fumble 100

  // 1 is critical success
  const crit = evaluateCocCheck('侦查', 60, 1);
  assert.equal(crit.level, 'critical_success');
  assert.equal(crit.isSuccess, true);

  // 10 is extreme success
  const extreme = evaluateCocCheck('侦查', 60, 10);
  assert.equal(extreme.level, 'extreme_success');
  assert.equal(extreme.isSuccess, true);

  // 25 is hard success
  const hard = evaluateCocCheck('侦查', 60, 25);
  assert.equal(hard.level, 'hard_success');
  assert.equal(hard.isSuccess, true);

  // 55 is regular success
  const regular = evaluateCocCheck('侦查', 60, 55);
  assert.equal(regular.level, 'success');
  assert.equal(regular.isSuccess, true);

  // 75 is failure
  const fail = evaluateCocCheck('侦查', 60, 75);
  assert.equal(fail.level, 'failure');
  assert.equal(fail.isSuccess, false);

  // 100 is fumble
  const fumble = evaluateCocCheck('侦查', 60, 100);
  assert.equal(fumble.level, 'fumble');
  assert.equal(fumble.isSuccess, false);

  // Skill < 50: 97 is fumble
  const fumbleLow = evaluateCocCheck('神秘学', 40, 97);
  assert.equal(fumbleLow.level, 'fumble');
  assert.equal(fumbleLow.isSuccess, false);
});

test('evaluateDndCheck correctly resolves Natural 20, Natural 1, DC pass and fail', () => {
  // DC = 15, modifier = +3
  // Roll = 20 -> Critical Success
  const nat20 = evaluateDndCheck('力量冲锋', 15, 3, 20);
  assert.equal(nat20.level, 'critical_success');
  assert.equal(nat20.isSuccess, true);

  // Roll = 1 -> Fumble
  const nat1 = evaluateDndCheck('力量冲锋', 15, 3, 1);
  assert.equal(nat1.level, 'fumble');
  assert.equal(nat1.isSuccess, false);

  // Roll = 13 + 3 = 16 >= 15 -> Success
  const pass = evaluateDndCheck('力量冲锋', 15, 3, 13);
  assert.equal(pass.isSuccess, true);

  // Roll = 10 + 3 = 13 < 15 -> Failure
  const fail = evaluateDndCheck('力量冲锋', 15, 3, 10);
  assert.equal(fail.isSuccess, false);
});

test('SCENARIOS library has valid structure and nodes', () => {
  assert.ok(SCENARIOS.length >= 3);
  for (const s of SCENARIOS) {
    assert.ok(s.id && s.title && s.description);
    assert.ok(s.characterPresets.length >= 2);
    assert.ok(s.startNodeId in s.nodes, `startNode ${s.startNodeId} missing in ${s.id}`);

    // Check each node
    for (const [nodeId, node] of Object.entries(s.nodes)) {
      assert.equal(node.id, nodeId);
      assert.ok(node.title && node.narration);
      if (!node.isEnding) {
        assert.ok(node.choices.length > 0, `Node ${nodeId} has no choices`);
      }
    }
  }
});

test('createTrpgGame and play complete branch', () => {
  let game = createTrpgGame('coc_blackwood_manor');
  assert.equal(game.status, 'playing');
  assert.equal(game.turnCount, 1);
  assert.ok(game.character.hp > 0);

  // Pick first choice which has check
  const choiceId = game.scenario.nodes[game.currentNodeId].choices[0].id;
  game = selectChoice(game, choiceId);
  assert.equal(game.status, 'rolling');
  assert.ok(game.pendingCheck);

  // Force roll to 1 (critical success)
  game = executePendingCheck(game, 1);
  assert.equal(game.status, 'playing');
  assert.equal(game.criticalCount, 1);
  assert.equal(game.successCount, 1);
  assert.ok(game.history.length >= 2);

  // Check item gained
  assert.ok(game.character.inventory.includes('雕花铜钥匙'));
});

test('rerollWithFatePoint reduces luck and sets status to rolling', () => {
  let game = createTrpgGame('coc_blackwood_manor');
  const initialLuck = game.character.luck;

  // Make choice and force fail
  const choiceId = game.scenario.nodes[game.currentNodeId].choices[0].id;
  game = selectChoice(game, choiceId);
  game = executePendingCheck(game, 85); // fail

  assert.equal(game.character.luck, initialLuck);

  // Reroll
  game = rerollWithFatePoint(game);
  assert.equal(game.character.luck, initialLuck - 1);
  assert.equal(game.status, 'rolling');

  // Roll again with success
  game = executePendingCheck(game, 20);
  assert.equal(game.status, 'playing');
});

test('performFreeAction and battle report generation', () => {
  let game = createTrpgGame('coc_blackwood_manor');
  game = performFreeAction(game, '我拿出放大镜仔细观察墙壁上的暗纹');
  assert.equal(game.status, 'rolling');
  assert.equal(game.pendingCheck.skillName, '侦查');

  game = executePendingCheck(game, 15);
  assert.equal(game.status, 'playing');

  const report = generateTrpgBattleReport(game);
  assert.ok(report.includes('沉浸跑团战报'));
  assert.ok(report.includes('艾伦 · 怀尔德') || report.includes('调查员'));
});

test('useInventoryItem restores HP/SAN and consumes consumable items', () => {
  let game = createTrpgGame('coc_blackwood_manor', 'investigator-reyno');
  // Reyno has 2 bandages in inventory
  assert.ok(game.character.inventory.includes('战地急救绷带'));
  game.character.hp = 10; // injured from maxHp 16

  const res = useInventoryItem(game, '战地急救绷带');
  assert.equal(res.success, true);
  assert.equal(res.state.character.hp, 15); // +5 HP
  // One bandage consumed
  const bandages = res.state.character.inventory.filter((it) => it === '战地急救绷带');
  assert.equal(bandages.length, 1);

  // Key item inspection does not consume
  const keyItemRes = useInventoryItem(res.state, '柯尔特转轮手枪 (空包/实弹)');
  assert.equal(keyItemRes.success, true);
  assert.ok(keyItemRes.state.character.inventory.includes('柯尔特转轮手枪 (空包/实弹)'));
});

test('triggerCompanionAssist applies Koko healing, Nox tactical boost, and Lulu critical upgrade', () => {
  let game = createTrpgGame('coc_blackwood_manor');
  game.character.hp = 5;
  game.character.san = 50;

  // 1. Koko heals 8 HP and 10 SAN (clamped to maxHp 12)
  game = triggerCompanionAssist(game, 'gaming-koko');
  assert.equal(game.companionSkills.koko.used, true);
  assert.equal(game.character.hp, 12); // clamped to maxHp
  assert.equal(game.character.san, 60); // 50 + 10 = 60

  // 2. Nox adds +25 target value to next check
  game = triggerCompanionAssist(game, 'gaming-nox');
  assert.equal(game.companionSkills.nox.used, true);
  assert.equal(game.companionSkills.nox.activeForNextCheck, true);

  // Pick first choice
  const choiceId = game.scenario.nodes[game.currentNodeId].choices[0].id;
  game = selectChoice(game, choiceId);
  assert.equal(game.status, 'rolling');
  // Allen's 侦查 skill is 75, Nox buff adds +25 (making it 99 max)
  assert.equal(game.pendingCheck.targetValue, 75);
  // When executed with roll 85 (which would fail 75, but pass with Nox's +25 buff):
  game = executePendingCheck(game, 85);
  assert.equal(game.lastCheckResult.isSuccess, true);
  assert.equal(game.companionSkills.nox.activeForNextCheck, false);

  // 3. Lulu upgrades regular success to Critical Success
  game = triggerCompanionAssist(game, 'gaming-lulu');
  assert.equal(game.companionSkills.lulu.used, true);
  assert.equal(game.companionSkills.lulu.activeForNextCheck, true);

  const checkChoice = game.scenario.nodes[game.currentNodeId].choices.find((c) => Boolean(c.check));
  assert.ok(checkChoice);
  game = selectChoice(game, checkChoice.id);
  assert.equal(game.status, 'rolling');
  // Roll regular success (e.g. 50 with skill 65)
  game = executePendingCheck(game, 50);
  assert.equal(game.lastCheckResult.level, 'critical_success');
  assert.equal(game.companionSkills.lulu.activeForNextCheck, false);
});

test('saveTrpgGame, loadSavedTrpgGame, and clearSavedTrpgGame preserve game state', () => {
  const store = new Map();
  const mockStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.localStorage = mockStorage;

  let game = createTrpgGame('coc_blackwood_manor');
  game.character.hp = 9;
  game.turnCount = 3;
  game.currentNodeId = 'node_study';

  // Save game
  saveTrpgGame(game);

  // Load game
  const loaded = loadSavedTrpgGame();
  assert.ok(loaded);
  assert.equal(loaded.scenarioId, 'coc_blackwood_manor');
  assert.equal(loaded.character.hp, 9);
  assert.equal(loaded.turnCount, 3);
  assert.equal(loaded.currentNodeId, 'node_study');
  assert.ok(loaded.scenario.nodes['node_study']);

  // Clear save
  clearSavedTrpgGame();
  const empty = loadSavedTrpgGame();
  assert.equal(empty, null);
});


