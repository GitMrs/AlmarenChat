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
  isChoiceAvailable,
  selectChoice,
  executePendingCheck,
  rerollWithFatePoint,
  performFreeAction,
  generateTrpgBattleReport,
  getItemDefinition,
  useInventoryItem,
  triggerCompanionAssist,
  getTrpgAiContext,
  saveTrpgGame,
  loadSavedTrpgGame,
  clearSavedTrpgGame,
  BLACKWOOD_SANDBOX_ROOMS,
  getSandboxRoomByNodeId,
  evaluateSandboxPlayerAction,
  buildSandboxCheckOutcome,
  MANOR_CLUES,
  setTrpgAiEnabled,
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

test('all story choice transitions resolve to existing nodes', () => {
  for (const scenario of SCENARIOS) {
    const assertTarget = (target, source) => {
      if (target) assert.ok(target in scenario.nodes, `${scenario.id}:${source} -> missing ${target}`);
    };
    for (const node of Object.values(scenario.nodes)) {
      for (const choice of node.choices) {
        assertTarget(choice.directNextNodeId, `${node.id}/${choice.id}`);
        assertTarget(choice.nextNodeId, `${node.id}/${choice.id}`);
        assertTarget(choice.successOutcome?.nextNodeId, `${node.id}/${choice.id}/success`);
        assertTarget(choice.failureOutcome?.nextNodeId, `${node.id}/${choice.id}/failure`);
      }
    }
  }
});

test('Blackwood Manor adds an archive investigation before the chapel and finale', () => {
  const manor = SCENARIOS.find((scenario) => scenario.id === 'coc_blackwood_manor');
  assert.ok(manor);
  const archive = manor.nodes.node_archive_vault;
  assert.ok(archive);
  assert.equal(archive.choices.length, 3);
  assert.ok(archive.choices.some((choice) => (
    choice.nextNodeId === 'node_hidden_chapel'
    || choice.successOutcome?.nextNodeId === 'node_hidden_chapel'
    || choice.failureOutcome?.nextNodeId === 'node_hidden_chapel'
  )));
  assert.ok(archive.choices.some((choice) => choice.directNextNodeId === 'node_hidden_chapel'));
  assert.match(archive.narration, /档案/);
});

test('Blackwood Manor exposes character-specific study routes', () => {
  const manor = SCENARIOS.find((scenario) => scenario.id === 'coc_blackwood_manor');
  const study = manor.nodes.node_study;
  const allen = createTrpgGame('coc_blackwood_manor', 'investigator-allen');
  const sara = createTrpgGame('coc_blackwood_manor', 'investigator-sara');
  const allenChoice = study.choices.find((choice) => choice.id === 'c_study_allen_caseboard');
  const saraChoice = study.choices.find((choice) => choice.id === 'c_study_sara_marginalia');
  assert.equal(isChoiceAvailable(allen, allenChoice), true);
  assert.equal(isChoiceAvailable(allen, saraChoice), false);
  assert.equal(isChoiceAvailable(sara, saraChoice), true);
});

test('Chapel ritual choices reflect whether the old servant was rescued', () => {
  const manor = SCENARIOS.find((scenario) => scenario.id === 'coc_blackwood_manor');
  const ritual = manor.nodes.node_chapel_ritual;
  const servantChoice = ritual.choices.find((choice) => choice.id === 'c_ritual_question_servant');
  const echoChoice = ritual.choices.find((choice) => choice.id === 'c_ritual_listen_echo');
  const state = createTrpgGame('coc_blackwood_manor');
  assert.equal(isChoiceAvailable(state, servantChoice), false);
  assert.equal(isChoiceAvailable(state, echoChoice), true);
  const rescued = { ...state, flags: { rescued_old_servant: true } };
  assert.equal(isChoiceAvailable(rescued, servantChoice), true);
  assert.equal(isChoiceAvailable(rescued, echoChoice), false);
});

test('Final altar confrontation requires prior evidence that the scholar survived', () => {
  const manor = SCENARIOS.find((scenario) => scenario.id === 'coc_blackwood_manor');
  const confrontation = manor.nodes.node_basement.choices.find((choice) => choice.id === 'c0_confront_scholar');
  const state = createTrpgGame('coc_blackwood_manor');
  assert.equal(isChoiceAvailable(state, confrontation), false);
  const informed = { ...state, flags: {}, evidence: ['艾伯纳仍然活着'] };
  assert.equal(isChoiceAvailable(informed, confrontation), true);
  const completed = { ...informed, flags: { scholar_confronted: true } };
  assert.equal(isChoiceAvailable(completed, confrontation), false);
});

test('Scholar regret and the silver stake unlock the counterseal ending route', () => {
  const manor = SCENARIOS.find((scenario) => scenario.id === 'coc_blackwood_manor');
  const counterseal = manor.nodes.node_basement.choices.find((choice) => choice.id === 'c0_scholar_counterseal');
  const state = createTrpgGame('coc_blackwood_manor');
  assert.equal(isChoiceAvailable(state, counterseal), false);
  const prepared = {
    ...state,
    flags: { scholar_regrets: true },
    evidence: ['银色阵钉'],
  };
  assert.equal(isChoiceAvailable(prepared, counterseal), true);
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

test('story state effects update flags, evidence, time, and NPC trust', () => {
  const game = createTrpgGame('coc_blackwood_manor');
  const choice = game.scenario.nodes[game.currentNodeId].choices[0];
  const originalEffects = choice.effects;
  choice.effects = {
    setFlags: ['found-wet-footprints'],
    addEvidence: ['wet-footprints'],
    timeMinutes: 15,
    npcs: { scholar: { trustDelta: 10 } },
  };
  try {
    const next = selectChoice(game, choice.id);
    assert.equal(next.flags['found-wet-footprints'], true);
    assert.deepEqual(next.evidence, ['wet-footprints']);
    assert.equal(next.clockMinutes, 15);
    assert.deepEqual(next.npcs.scholar, { alive: true, trust: 10 });
  } finally {
    choice.effects = originalEffects;
  }
});

test('AI context stays compact and exposes only available choices', () => {
  const game = createTrpgGame('coc_blackwood_manor');
  const context = getTrpgAiContext(game);
  assert.equal(context.scenario, '迷雾庄园怪谈');
  assert.equal(context.chapter, 1);
  assert.equal(context.availableChoices.length, 4);
  assert.equal(context.evidence.length, 0);
  assert.deepEqual(context.flags, []);
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

test('BLACKWOOD_SANDBOX_ROOMS defines complete physical mansion layout with 7 rooms', () => {
  const roomKeys = Object.keys(BLACKWOOD_SANDBOX_ROOMS);
  assert.ok(roomKeys.includes('foyer'));
  assert.ok(roomKeys.includes('dining_hall'));
  assert.ok(roomKeys.includes('greenhouse'));
  assert.ok(roomKeys.includes('study'));
  assert.ok(roomKeys.includes('attic'));
  assert.ok(roomKeys.includes('cellar_corridor'));
  assert.ok(roomKeys.includes('abyss_shrine'));

  // Each room has interactive affordances and default suggestions
  for (const key of roomKeys) {
    const room = BLACKWOOD_SANDBOX_ROOMS[key];
    assert.ok(room.name);
    assert.ok(room.interactables.length >= 2, `${key} should have interactables`);
    assert.ok(room.defaultSuggestions.length >= 2, `${key} should have suggestions`);
  }
});

test('performFreeAction seamlessly executes room movement in sandbox', () => {
  let game = createTrpgGame('coc_blackwood_manor');
  assert.equal(game.currentNodeId, 'node_foyer');

  // Move to west wing dining hall
  game = performFreeAction(game, '我穿过走廊前往西侧宴会大厅');
  assert.equal(game.currentNodeId, 'node_dining');
  assert.equal(game.status, 'playing');
  assert.ok(game.history[game.history.length - 1].narration.includes('幽暗长桌宴会大厅'));

  // Move back or to cellar
  game = performFreeAction(game, '顺着升降井滑入地窖');
  assert.equal(game.currentNodeId, 'node_cellar_corridor');
  assert.equal(game.status, 'playing');
});

test('performFreeAction awards +15% bonus for detailed RP and tool usage', () => {
  const game = createTrpgGame('coc_blackwood_manor');
  const allen = game.character; // allen has 放大镜 and 手电

  // Detailed tool action on carpet
  const stateWithCheck = performFreeAction(game, '我蹲下身，打开随身强光防风手电和放大镜，仔细勘验地毯上的泥泞血迹与脚印');
  assert.equal(stateWithCheck.status, 'rolling');
  assert.ok(stateWithCheck.pendingCheck);
  assert.equal(stateWithCheck.pendingCheck.skillName, '侦查');
  // Base 侦查 is 75, bonus +15% gives targetValue 90
  assert.ok(stateWithCheck.pendingCheck.targetValue >= 85);
  assert.ok(stateWithCheck.pendingChoice.description.includes('+15%'));
});

test('performFreeAction directly uses consumables to heal HP/SAN without rolling', () => {
  let game = createTrpgGame('coc_blackwood_manor', 'investigator-reyno'); // reyno starts with bandages
  game.character.hp = 10;
  assert.ok(game.character.inventory.some((i) => i.includes('绷带')));

  game = performFreeAction(game, '取出随身急救绷带包扎伤口止血');
  assert.equal(game.status, 'playing'); // Direct resolution, no rolling needed!
  assert.equal(game.character.hp, 15);
  assert.ok(game.history[game.history.length - 1].narration.includes('急救绷带'));
});

test('performFreeAction allows creative non-violent sedation of guard in cellar', () => {
  let game = createTrpgGame('coc_blackwood_manor', 'investigator-allen'); // allen starts with 浓缩镇静剂
  game.currentNodeId = 'node_cellar_corridor';
  assert.ok(game.character.inventory.includes('浓缩镇静剂'));

  game = performFreeAction(game, '飞身上前，趁异化守卫恍惚之际将浓缩镇静剂刺入其颈部');
  assert.equal(game.status, 'playing');
  assert.ok(game.character.inventory.includes('银制旧神星之护符'));
  assert.ok(!game.character.inventory.includes('浓缩镇静剂'));
  assert.ok(game.history[game.history.length - 1].narration.includes('银制旧神星之护符'));
});

test('Successful check in sandbox discovers clue and records into game.evidence', () => {
  let game = createTrpgGame('coc_blackwood_manor');
  assert.equal(game.evidence.length, 0);

  // Free action inspecting clock
  game = performFreeAction(game, '用手电仔细检查停摆座钟的指针与钟摆');
  assert.equal(game.status, 'rolling');

  // Roll a success (e.g. 15 on targetValue ~85)
  game = executePendingCheck(game, 15);
  assert.equal(game.status, 'playing');
  assert.ok(game.evidence.includes('停摆座钟') || game.evidence.some((e) => e.includes('座钟')));
});

test('Free action check outcomes trigger authentic companion reactions from Lulu and Koko', () => {
  // Test critical success -> Lulu speaks
  let gameCrit = createTrpgGame('coc_blackwood_manor');
  gameCrit = performFreeAction(gameCrit, '用手电仔细检查停摆座钟');
  gameCrit = executePendingCheck(gameCrit, 1); // 1 is critical success on d100
  const critSpeech = gameCrit.history[gameCrit.history.length - 1].companionSpeech;
  assert.ok(critSpeech);
  assert.equal(critSpeech.agentId, 'gaming-lulu');
  assert.ok(critSpeech.text.includes('帅得犯规'));

  // Test failure -> Koko speaks
  let gameFail = createTrpgGame('coc_blackwood_manor');
  gameFail = performFreeAction(gameFail, '用手电仔细检查停摆座钟');
  gameFail = executePendingCheck(gameFail, 95); // 95 is failure
  const failSpeech = gameFail.history[gameFail.history.length - 1].companionSpeech;
  assert.ok(failSpeech);
  assert.equal(failSpeech.agentId, 'gaming-koko');
  assert.ok(failSpeech.text.includes('冲鸭') || failSpeech.text.includes('再试一次'));
});

test('TRPG AI dual engine switch toggles correctly and persists in save state', () => {
  // 1. Defaults to aiEnabled = true
  const gameDefault = createTrpgGame('coc_blackwood_manor');
  assert.equal(gameDefault.aiEnabled, true);

  // 2. Can be initialized with aiEnabled = false (local sandbox)
  const gameSandbox = createTrpgGame('coc_blackwood_manor', undefined, undefined, 'free', false);
  assert.equal(gameSandbox.aiEnabled, false);

  // 3. setTrpgAiEnabled toggles state without mutating original
  const gameToggled = setTrpgAiEnabled(gameSandbox, true);
  assert.equal(gameToggled.aiEnabled, true);
  assert.equal(gameSandbox.aiEnabled, false);

  // 4. State save and load preserves aiEnabled
  saveTrpgGame(gameSandbox);
  const loaded = loadSavedTrpgGame();
  assert.ok(loaded);
  assert.equal(loaded.aiEnabled, false);

  // Clean up
  clearSavedTrpgGame();
});



