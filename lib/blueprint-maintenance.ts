import {
  createBlueprintRuntimeState,
  executeBlueprintAction,
  getAvailableBlueprintActions,
} from '@/lib/story-engine';
import type { BlueprintRuntimeState, MysteryBlueprint } from '@/types/blueprint';

export function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function collectIds(items: any[], groupName: string, notes: string[]) {
  const ids = new Set<string>();

  for (const item of items) {
    if (!item?.id || typeof item.id !== 'string') {
      notes.push(`${groupName} has an item without a string id`);
      continue;
    }
    if (ids.has(item.id)) {
      notes.push(`${groupName} has duplicate id: ${item.id}`);
    }
    ids.add(item.id);
  }

  return ids;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0)));
}

function ensureOneShotAction(action: any) {
  const key = `done_${action.id}`;
  action.conditions = [
    ...asArray(action.conditions).filter((condition) => condition.type !== 'flagNot' || condition.key !== key),
    { type: 'flagNot', key, value: true },
  ];
  action.effects = asArray(action.effects);
  if (!action.effects.some((effect) => effect.type === 'flag.set' && effect.key === key)) {
    action.effects.push({ type: 'flag.set', key, value: true });
  }
}

function clueDiscoveryActionId(actions: any[], clueId: string): string | undefined {
  const action = actions.find((item) =>
    asArray(item.effects).some((effect) => effect.type === 'clue.discover' && effect.clueId === clueId)
  );
  return action?.id;
}

function repairClueVisibility(blueprint: MysteryBlueprint) {
  const discoverableClueIds = new Set<string>();
  for (const action of asArray(blueprint.actions)) {
    for (const effect of asArray(action.effects)) {
      if (effect.type === 'clue.discover' && effect.clueId) discoverableClueIds.add(effect.clueId);
    }
  }

  for (const clue of asArray(blueprint.clues)) {
    if (discoverableClueIds.has(clue.id)) {
      clue.visibility = 'hidden';
    }
  }
}

function repairEvidenceChain(blueprint: MysteryBlueprint) {
  const clues = asArray(blueprint.clues);
  const actions = asArray(blueprint.actions);
  const requiredClueIds = new Set(asArray(blueprint.accusation?.requiredClueIds));
  const existingEvidence = asArray(blueprint.evidenceChain);
  const evidenceByClueId = new Map<string, any>();

  for (const evidence of existingEvidence) {
    if (evidence?.clueId) evidenceByClueId.set(evidence.clueId, evidence);
  }

  blueprint.evidenceChain = clues.map((clue) => {
    const existing = evidenceByClueId.get(clue.id);
    const obtainedByActionId = existing?.obtainedByActionId || clueDiscoveryActionId(actions, clue.id);
    return {
      id: existing?.id || `evidence_${clue.id}`,
      title: existing?.title || clue.name || clue.id,
      proves: asArray(existing?.proves).length > 0 ? asArray(existing.proves) : [clue.description || clue.name || clue.id],
      clueId: clue.id,
      suspectIds: asArray(existing?.suspectIds),
      requiredForAccusation: Boolean(existing?.requiredForAccusation || requiredClueIds.has(clue.id)),
      ...(obtainedByActionId ? { obtainedByActionId } : {}),
    };
  });
}

function repairFailState(blueprint: MysteryBlueprint) {
  if (blueprint.failState) return;
  const fallbackEnding = asArray(blueprint.endings).find((ending) =>
    /timeout|unresolved|fog|fail|mist|沉|迷|超时|失败|僵局/.test(`${ending.id || ''} ${ending.name || ''}`)
  );
  if (!fallbackEnding?.id) return;

  blueprint.failState = {
    maxActionCount: 100,
    endingId: fallbackEnding.id,
  };
}

function repairAccusationConditions(blueprint: MysteryBlueprint) {
  const accusation = blueprint.accusation;
  if (!accusation) return;

  const conditions = asArray(accusation.enabledWhen);
  for (const clueId of asArray(accusation.requiredClueIds)) {
    if (!conditions.some((condition) => condition.type === 'hasClue' && condition.clueId === clueId)) {
      conditions.push({ type: 'hasClue', clueId });
    }
  }
  accusation.enabledWhen = conditions;
}

function buildConfrontationText(params: {
  clueName: string;
  clueDescription?: string;
  evidenceProves: string[];
  suspectName: string;
}) {
  const proofText = params.evidenceProves.find((item) => typeof item === 'string' && item.trim().length > 0);
  const detail = proofText || params.clueDescription;

  if (!detail) {
    return `你拿出“${params.clueName}”质问${params.suspectName}。对方的说法被迫收缩，这条线索终于从现场细节变成了可以指向嫌疑人的矛盾点。`;
  }

  return `你拿出“${params.clueName}”质问${params.suspectName}：${detail}。这与对方刚才的说法无法同时成立，沉默让这条证据的指向变得清楚起来。`;
}

function isOneShotDoneCondition(condition: any, actionId: string) {
  return condition?.type === 'flagNot' && condition.key === `done_${actionId}` && condition.value === true;
}

function hasGameplayPrerequisite(action: any) {
  return asArray(action.conditions).some((condition) => !isOneShotDoneCondition(condition, action.id));
}

function isDeepInvestigationAction(action: any) {
  return /拆|打开|剥|内部|定时器|显微|比对|深入|复查|进一步|异常处|disassemble|open|internal|timer|microscope|compare|deeper|anomaly/i.test(
    `${action.id || ''} ${action.label || ''}`
  );
}

function repairProgressiveInvestigationUnlocks(actions: any[]) {
  const byTargetId = new Map<string, any[]>();

  for (const action of actions) {
    if ((action.intent !== 'inspect' && action.intent !== 'use') || !action.targetId) continue;
    byTargetId.set(action.targetId, [...(byTargetId.get(action.targetId) || []), action]);
  }

  for (const targetActions of byTargetId.values()) {
    if (targetActions.length < 2) continue;
    const shallowActions = targetActions.filter((action) => !isDeepInvestigationAction(action));
    if (shallowActions.length === 0) continue;

    for (let index = 0; index < targetActions.length; index += 1) {
      const action = targetActions[index];
      if (!isDeepInvestigationAction(action) || hasGameplayPrerequisite(action)) continue;

      const previousAction =
        [...targetActions.slice(0, index)].reverse().find((item) => !isDeepInvestigationAction(item)) ||
        shallowActions[0];
      const requiredFlag = `done_${previousAction.id}`;

      action.conditions = [
        ...asArray(action.conditions),
        { type: 'flag', key: requiredFlag, value: true },
      ];
    }
  }
}

function repairConfrontations(blueprint: MysteryBlueprint) {
  const accusation = blueprint.accusation;
  if (!accusation?.correctSuspectId) return;

  const clues = asArray(blueprint.clues);
  const actions = asArray(blueprint.actions);
  const evidenceChain = asArray(blueprint.evidenceChain);
  const interrogationScene = asArray(blueprint.scenes).find((scene) => scene.id === 'interrogation_room');
  if (!interrogationScene) return;

  const correctSuspect = asArray(blueprint.suspects).find((suspect) => suspect.id === accusation.correctSuspectId);
  const requiredClueIds = asArray(accusation.requiredClueIds);
  const sourceClueIds = requiredClueIds.filter((clueId) => !clueId.startsWith(`deduction_${accusation.correctSuspectId}_`));
  const confrontationClueIds: string[] = [];

  for (const clueId of sourceClueIds) {
    const clue = clues.find((item) => item.id === clueId);
    const evidence = evidenceChain.find((item) => item.clueId === clueId);
    const confrontationClueId = `deduction_${accusation.correctSuspectId}_${clueId}`;
    const confrontationFlag = `confronted_${accusation.correctSuspectId}_${clueId}`;
    const actionId = `confront_${accusation.correctSuspectId}_${clueId}`;
    const clueName = clue?.name || evidence?.title || clueId;
    const suspectName = correctSuspect?.name || accusation.correctSuspectId;
    confrontationClueIds.push(confrontationClueId);

    if (!clues.some((item) => item.id === confrontationClueId)) {
      clues.push({
        id: confrontationClueId,
        name: `${suspectName}的${clueName}矛盾`,
        description: `${clueName}经过对峙后，成为指向${suspectName}的推理结论。`,
        visibility: 'hidden',
      });
    }

    if (!actions.some((item) => item.id === actionId)) {
      actions.push({
        id: actionId,
        label: `用${clueName}质问${suspectName}`,
        intent: 'reason',
        targetId: accusation.correctSuspectId,
        conditions: [
          { type: 'inScene', sceneId: 'interrogation_room' },
          { type: 'hasClue', clueId },
          { type: 'flag', key: `asked_${accusation.correctSuspectId}`, value: true },
          { type: 'flagNot', key: confrontationFlag, value: true },
        ],
        effects: [
          { type: 'flag.set', key: confrontationFlag, value: true },
          { type: 'clue.discover', clueId: confrontationClueId },
        ],
        successText: buildConfrontationText({
          clueName,
          clueDescription: clue?.description,
          evidenceProves: asArray(evidence?.proves),
          suspectName,
        }),
        blockedText: '你还缺少足够的线索或审问铺垫，暂时无法进行这次对峙。',
      });
    }

    if (!evidenceChain.some((item) => item.clueId === confrontationClueId)) {
      evidenceChain.push({
        id: `evidence_${confrontationClueId}`,
        title: `${suspectName}的对峙破绽`,
        proves: asArray(evidence?.proves).length > 0
          ? asArray(evidence.proves)
          : [`${clueName}经对峙后指向${suspectName}`],
        clueId: confrontationClueId,
        suspectIds: [accusation.correctSuspectId],
        requiredForAccusation: true,
        obtainedByActionId: actionId,
      });
    }

    interrogationScene.actionIds = uniqueStrings([...asArray(interrogationScene.actionIds), actionId]);
  }

  blueprint.clues = clues;
  blueprint.actions = actions;
  blueprint.evidenceChain = evidenceChain;
  accusation.requiredClueIds = uniqueStrings([...requiredClueIds, ...confrontationClueIds]);
}

function repairCaseReview(blueprint: MysteryBlueprint) {
  const accusation = blueprint.accusation;
  if (!accusation) return;

  const interrogationScene = asArray(blueprint.scenes).find((scene) => scene.id === 'interrogation_room');
  if (!interrogationScene) return;

  const requiredClueIds = asArray(accusation.requiredClueIds);
  const actionId = 'review_case';
  const reviewFlag = 'case_reviewed';
  const actions = asArray(blueprint.actions);
  const conditions = [
    { type: 'inScene', sceneId: 'interrogation_room' },
    ...requiredClueIds.map((clueId) => ({ type: 'hasClue', clueId })),
    { type: 'flagNot', key: reviewFlag, value: true },
  ];

  const existingAction = actions.find((action) => action.id === actionId);
  if (existingAction) {
    existingAction.intent = 'reason';
    existingAction.conditions = conditions;
    existingAction.effects = asArray(existingAction.effects);
    if (!existingAction.effects.some((effect) => effect.type === 'flag.set' && effect.key === reviewFlag)) {
      existingAction.effects.push({ type: 'flag.set', key: reviewFlag, value: true });
    }
  } else {
    actions.push({
      id: actionId,
      label: '整理案情',
      intent: 'reason',
      targetId: accusation.correctSuspectId,
      conditions,
      effects: [
        { type: 'flag.set', key: reviewFlag, value: true },
        { type: 'objective.update', objective: '案情已经整理完毕。现在可以进行最终指认。' },
      ],
      successText: '你将现场物证、嫌疑人证词和对峙中暴露的矛盾逐一串联。作案手法、动机与关键证据已经形成完整闭环，现在可以进行最终指认。',
      blockedText: '关键证据或对峙结论还没有整理完整，暂时无法形成可靠指控。',
    });
  }

  interrogationScene.actionIds = uniqueStrings([...asArray(interrogationScene.actionIds), actionId]);
  blueprint.actions = actions;

  const accusationConditions = asArray(accusation.enabledWhen);
  if (!accusationConditions.some((condition) => condition.type === 'flag' && condition.key === reviewFlag)) {
    accusationConditions.push({ type: 'flag', key: reviewFlag, value: true });
  }
  accusation.enabledWhen = accusationConditions;
}

function dryRunStateKey(state: BlueprintRuntimeState) {
  return JSON.stringify({
    sceneId: state.sceneId,
    flags: state.flags,
    clues: [...state.discoveredClueIds].sort(),
    inventory: [...state.inventoryItemIds].sort(),
    endingId: state.endingId || '',
  });
}

export function createBlueprintDryRunReport(blueprint: MysteryBlueprint, maxStates = Math.max(80, asArray(blueprint.actions).length * 8)) {
  const initialState = createBlueprintRuntimeState(blueprint);
  const queue: Array<{ state: BlueprintRuntimeState; depth: number; path: string[] }> = [
    { state: initialState, depth: 0, path: [] },
  ];
  const visited = new Set<string>();
  const queued = new Set<string>([dryRunStateKey(initialState)]);
  const reachedSceneIds = new Set<string>([initialState.sceneId]);
  const reachedActionIds = new Set<string>();
  const reachedClueIds = new Set<string>(initialState.discoveredClueIds);
  const reachedCluePaths: Record<string, string[]> = {};
  const deadEnds: Array<{ sceneId: string; depth: number; discoveredClueIds: string[] }> = [];
  let truncated = false;

  for (const clueId of initialState.discoveredClueIds) {
    reachedCluePaths[clueId] = [];
  }

  while (queue.length > 0) {
    if (visited.size >= maxStates) {
      truncated = true;
      break;
    }

    const current = queue.shift();
    if (!current) continue;

    const key = dryRunStateKey(current.state);
    if (visited.has(key)) continue;
    visited.add(key);

    const availableActions = getAvailableBlueprintActions(blueprint, current.state);
    if (availableActions.length === 0 && !current.state.endedAt) {
      deadEnds.push({
        sceneId: current.state.sceneId,
        depth: current.depth,
        discoveredClueIds: current.state.discoveredClueIds,
      });
      continue;
    }

    for (const action of availableActions) {
      reachedActionIds.add(action.id);
      const result = executeBlueprintAction(blueprint, current.state, action.id);
      if (!result.allowed) continue;
      const nextPath = [...current.path, action.id];
      reachedSceneIds.add(result.state.sceneId);
      for (const clueId of result.state.discoveredClueIds) {
        reachedClueIds.add(clueId);
        if (!reachedCluePaths[clueId]) reachedCluePaths[clueId] = nextPath;
      }
      const nextKey = dryRunStateKey(result.state);
      if (!visited.has(nextKey) && !queued.has(nextKey)) {
        queued.add(nextKey);
        queue.push({ state: result.state, depth: current.depth + 1, path: nextPath });
      }
    }
  }

  const missingRequiredEvidence = asArray(blueprint.evidenceChain)
    .filter((evidence) => evidence.requiredForAccusation && evidence.clueId && !reachedClueIds.has(evidence.clueId))
    .map((evidence) => ({
      evidenceId: evidence.id,
      clueId: evidence.clueId,
      obtainedByActionId: evidence.obtainedByActionId,
    }));
  const missingRequiredEvidenceIds = missingRequiredEvidence.map((evidence) => evidence.evidenceId);

  const notes: string[] = [];
  if (missingRequiredEvidenceIds.length > 0) {
    notes.push(`dry-run cannot reach required evidence: ${missingRequiredEvidenceIds.join(', ')}`);
  }
  if (deadEnds.length > 0) {
    notes.push(`dry-run found dead ends before story ending: ${deadEnds.length}`);
  }
  if (truncated && missingRequiredEvidenceIds.length > 0) {
    notes.push(`dry-run stopped before all required evidence was reached; state limit: ${maxStates}`);
  }

  return {
    maxStates,
    exploredStateCount: visited.size,
    truncated,
    reachedSceneIds: Array.from(reachedSceneIds),
    reachedActionIds: Array.from(reachedActionIds),
    reachedClueIds: Array.from(reachedClueIds),
    reachedCluePaths,
    missingRequiredEvidenceIds,
    missingRequiredEvidence,
    deadEnds,
    notes,
  };
}

export function repairMysteryBlueprint(blueprint: MysteryBlueprint): MysteryBlueprint {
  const suspects = asArray(blueprint.suspects);
  if (suspects.length === 0) return blueprint;

  const scenes = asArray(blueprint.scenes);
  const actions = asArray(blueprint.actions);
  const objects = asArray(blueprint.objects);
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const objectSceneById = new Map(objects.map((object) => [object.id, object.sceneId]));
  const initialSceneId = blueprint.initialState?.sceneId;
  const mainScene = scenes.find((scene) => scene.id === initialSceneId) || scenes[0];
  if (!mainScene) return blueprint;

  let interrogationScene = scenes.find((scene) => scene.id === 'interrogation_room');
  if (!interrogationScene) {
    interrogationScene = {
      id: 'interrogation_room',
      name: '审问室',
      description: '你可以在这里逐一审问嫌疑人，核对他们的说法与证据。',
      objectIds: [],
      actionIds: [],
    };
    blueprint.scenes = [...scenes, interrogationScene];
  }

  const moveActionId = 'move_to_interrogation_room';
  const existingMoveAction = actions.find(
    (action) => action.intent === 'move' && action.targetId === 'interrogation_room'
  );
  let moveAction = existingMoveAction || actions.find((action) => action.id === moveActionId);
  if (!moveAction) {
    moveAction = {
      id: moveActionId,
      label: '进入审问室',
      intent: 'move',
      targetId: 'interrogation_room',
      conditions: [],
      effects: [
        { type: 'scene.change', sceneId: 'interrogation_room' },
        { type: 'objective.update', objective: '选择一名嫌疑人进行审问，核对证词与证据。' },
      ],
      successText: '你进入审问室。接下来需要选择一名嫌疑人进行正式审问。',
      blockedText: '暂时无法进入审问室。',
    };
    blueprint.actions = [...asArray(blueprint.actions), moveAction];
  }
  moveAction.effects = asArray(moveAction.effects);
  if (!moveAction.effects.some((effect) => effect.type === 'scene.change' && effect.sceneId === 'interrogation_room')) {
    moveAction.effects.push({ type: 'scene.change', sceneId: 'interrogation_room' });
  }
  if (!moveAction.effects.some((effect) => effect.type === 'objective.update')) {
    moveAction.effects.push({ type: 'objective.update', objective: '选择一名嫌疑人进行审问，核对证词与证据。' });
  }
  mainScene.actionIds = uniqueStrings([...asArray(mainScene.actionIds), moveAction.id]);

  for (const action of actions) {
    action.conditions = asArray(action.conditions);
    action.effects = asArray(action.effects);

    if (action.intent === 'move' && sceneIds.has(action.targetId)) {
      if (!action.effects.some((effect) => effect.type === 'scene.change' && effect.sceneId === action.targetId)) {
        action.effects.push({ type: 'scene.change', sceneId: action.targetId });
      }
      if (action.targetId === mainScene.id && !action.effects.some((effect) => effect.type === 'objective.update')) {
        action.effects.push({ type: 'objective.update', objective: blueprint.initialState?.objective || '继续调查案件现场。' });
      }
    }

    if (action.intent === 'inspect' || action.intent === 'use') {
      ensureOneShotAction(action);
    }

    if (
      (action.intent === 'inspect' || action.intent === 'use' || action.intent === 'reason') &&
      action.targetId &&
      objectSceneById.has(action.targetId)
    ) {
      const scene = scenes.find((item) => item.id === objectSceneById.get(action.targetId));
      if (scene) scene.actionIds = uniqueStrings([...asArray(scene.actionIds), action.id]);
    }
  }

  for (const scene of scenes) {
    scene.actionIds = uniqueStrings(asArray(scene.actionIds)).filter((actionId) => {
      const action = actions.find((item) => item.id === actionId);
      return action?.intent !== 'accuse';
    });
  }
  blueprint.actions = asArray(blueprint.actions).filter((action) => action.intent !== 'accuse');
  repairProgressiveInvestigationUnlocks(asArray(blueprint.actions));

  const nextActions = asArray(blueprint.actions);
  for (const suspect of suspects) {
    if (!suspect?.id || !suspect?.name) continue;

    const existingAskAction = nextActions.find((action) => action.intent === 'ask' && action.targetId === suspect.id);
    const askActionId = existingAskAction?.id || `ask_${suspect.id}`;
    if (existingAskAction) {
      existingAskAction.conditions = [
        ...asArray(existingAskAction.conditions).filter(
          (condition) =>
            (condition.type !== 'flagNot' || condition.key !== `asked_${suspect.id}`) &&
            (condition.type !== 'inScene' || condition.sceneId !== 'interrogation_room')
        ),
        { type: 'inScene', sceneId: 'interrogation_room' },
        { type: 'flagNot', key: `asked_${suspect.id}`, value: true },
      ];
      existingAskAction.effects = asArray(existingAskAction.effects);
      if (!existingAskAction.effects.some((effect) => effect.type === 'flag.set' && effect.key === `asked_${suspect.id}`)) {
        existingAskAction.effects.push({ type: 'flag.set', key: `asked_${suspect.id}`, value: true });
      }
    } else {
      nextActions.push({
        id: askActionId,
        label: `审问${suspect.name}`,
        intent: 'ask',
        targetId: suspect.id,
        conditions: [
          { type: 'inScene', sceneId: 'interrogation_room' },
          { type: 'flagNot', key: `asked_${suspect.id}`, value: true },
        ],
        effects: [{ type: 'flag.set', key: `asked_${suspect.id}`, value: true }],
        successText: `你开始审问${suspect.name}。对方的证词需要结合已有线索判断真假。`,
        blockedText: '需要先进入审问室。',
      });
    }
    interrogationScene.actionIds = uniqueStrings([...asArray(interrogationScene.actionIds), askActionId]);
  }
  blueprint.actions = nextActions;
  repairClueVisibility(blueprint);
  repairEvidenceChain(blueprint);
  repairFailState(blueprint);
  repairConfrontations(blueprint);
  repairCaseReview(blueprint);
  repairAccusationConditions(blueprint);

  return blueprint;
}

export function validateMysteryBlueprint(blueprint: MysteryBlueprint | null | undefined): string[] {
  const notes: string[] = [];
  if (!blueprint || typeof blueprint !== 'object') {
    return ['blueprint is missing or invalid'];
  }

  const suspects = asArray(blueprint.suspects);
  const clues = asArray(blueprint.clues);
  const scenes = asArray(blueprint.scenes);
  const objects = asArray(blueprint.objects);
  const actions = asArray(blueprint.actions);
  const endings = asArray(blueprint.endings);
  const evidenceChain = asArray(blueprint.evidenceChain);

  const suspectIds = collectIds(suspects, 'suspects', notes);
  const clueIds = collectIds(clues, 'clues', notes);
  const sceneIds = collectIds(scenes, 'scenes', notes);
  const objectIds = collectIds(objects, 'objects', notes);
  const actionIds = collectIds(actions, 'actions', notes);
  const endingIds = collectIds(endings, 'endings', notes);
  collectIds(evidenceChain, 'evidenceChain', notes);

  const initialSceneId = blueprint.initialState?.sceneId;
  if (!initialSceneId || !sceneIds.has(initialSceneId)) {
    notes.push('initialState.sceneId does not reference an existing scene');
  }

  for (const scene of scenes) {
    for (const objectId of asArray(scene.objectIds)) {
      if (!objectIds.has(objectId)) notes.push(`scene ${scene.id} references missing object: ${objectId}`);
    }
    for (const actionId of asArray(scene.actionIds)) {
      if (!actionIds.has(actionId)) notes.push(`scene ${scene.id} references missing action: ${actionId}`);
    }
  }

  for (const object of objects) {
    if (!sceneIds.has(object.sceneId)) {
      notes.push(`object ${object.id} references missing scene: ${object.sceneId}`);
    }
  }

  const discoveredByAction = new Set<string>();
  const reachableEndingIds = new Set<string>();
  const targetIds = new Set([...objectIds, ...suspectIds, ...sceneIds, ...clueIds]);
  for (const action of actions) {
    if (action.targetId && !targetIds.has(action.targetId)) {
      notes.push(`action ${action.id} references missing target: ${action.targetId}`);
    }
    if (action.intent === 'accuse') {
      notes.push(`action ${action.id} uses accuse intent; use blueprint.accusation instead`);
    }
    const effects = asArray(action.effects);
    if (effects.length === 0) {
      notes.push(`action ${action.id} has no effects`);
    }
    if (action.intent === 'move') {
      const hasSceneChange = effects.some((effect) => effect.type === 'scene.change' && effect.sceneId === action.targetId);
      if (!hasSceneChange) notes.push(`move action ${action.id} does not change to its target scene`);
    }
    if ((action.intent === 'inspect' || action.intent === 'ask' || action.intent === 'use' || action.intent === 'reason') && !effects.some((effect) => effect.type === 'flag.set')) {
      notes.push(`one-shot action ${action.id} does not mark itself done`);
    }
    for (const effect of effects) {
      if (effect.type === 'clue.discover') {
        if (!clueIds.has(effect.clueId)) {
          notes.push(`action ${action.id} discovers missing clue: ${effect.clueId}`);
        } else {
          discoveredByAction.add(effect.clueId);
        }
      }
      if (effect.type === 'scene.change' && !sceneIds.has(effect.sceneId)) {
        notes.push(`action ${action.id} changes to missing scene: ${effect.sceneId}`);
      }
      if (effect.type === 'ending.reach' && !endingIds.has(effect.endingId)) {
        notes.push(`action ${action.id} reaches missing ending: ${effect.endingId}`);
      } else if (effect.type === 'ending.reach') {
        reachableEndingIds.add(effect.endingId);
      }
    }
  }

  for (const suspect of suspects) {
    const hasAskAction = actions.some((action) => action.intent === 'ask' && action.targetId === suspect.id);
    if (!hasAskAction) {
      notes.push(`suspect ${suspect.id} has no ask action`);
    }
  }

  for (const clue of clues) {
    if (clue.visibility === 'hidden' && !discoveredByAction.has(clue.id)) {
      notes.push(`hidden clue is not discoverable by any action: ${clue.id}`);
    }
  }

  for (const evidence of evidenceChain) {
    if (evidence.clueId && !clueIds.has(evidence.clueId)) {
      notes.push(`evidence ${evidence.id} references missing clue: ${evidence.clueId}`);
    }
    if (evidence.obtainedByActionId && !actionIds.has(evidence.obtainedByActionId)) {
      notes.push(`evidence ${evidence.id} references missing action: ${evidence.obtainedByActionId}`);
    }
    for (const suspectId of asArray(evidence.suspectIds)) {
      if (!suspectIds.has(suspectId)) notes.push(`evidence ${evidence.id} references missing suspect: ${suspectId}`);
    }
    if (evidence.requiredForAccusation && evidence.clueId && !discoveredByAction.has(evidence.clueId)) {
      notes.push(`required evidence is not discoverable by any action: ${evidence.id}`);
    }
  }

  const accusation = blueprint.accusation;
  if (accusation) {
    if (!suspectIds.has(accusation.correctSuspectId)) {
      notes.push(`accusation.correctSuspectId is missing: ${accusation.correctSuspectId}`);
    }
    for (const clueId of asArray(accusation.requiredClueIds)) {
      if (!clueIds.has(clueId)) notes.push(`accusation requires missing clue: ${clueId}`);
      if (!evidenceChain.some((evidence) => evidence.clueId === clueId && evidence.requiredForAccusation)) {
        notes.push(`accusation required clue is not represented in evidenceChain: ${clueId}`);
      }
    }
    if (!endingIds.has(accusation.successEndingId)) {
      notes.push(`accusation.successEndingId is missing: ${accusation.successEndingId}`);
    } else {
      reachableEndingIds.add(accusation.successEndingId);
    }
    if (!endingIds.has(accusation.failureEndingId)) {
      notes.push(`accusation.failureEndingId is missing: ${accusation.failureEndingId}`);
    } else {
      reachableEndingIds.add(accusation.failureEndingId);
    }
  } else {
    notes.push('accusation is missing');
  }

  const failState = blueprint.failState;
  if (failState) {
    if (!endingIds.has(failState.endingId)) {
      notes.push(`failState.endingId is missing: ${failState.endingId}`);
    } else {
      reachableEndingIds.add(failState.endingId);
    }
    if (!Number.isFinite(failState.maxActionCount) || failState.maxActionCount <= 0) {
      notes.push('failState.maxActionCount must be a positive number');
    }
  }

  for (const ending of endings) {
    if (ending.id && !reachableEndingIds.has(ending.id)) {
      notes.push(`ending is not reachable by action effects or accusation: ${ending.id}`);
    }
  }

  return Array.from(new Set(notes));
}

export function maintainMysteryBlueprint(blueprint: MysteryBlueprint, repair = true): MysteryBlueprint {
  const nextBlueprint = repair ? repairMysteryBlueprint(blueprint) : blueprint;
  nextBlueprint.dryRunReport = createBlueprintDryRunReport(nextBlueprint);
  const serverNotes = [
    ...validateMysteryBlueprint(nextBlueprint),
    ...asArray(nextBlueprint.dryRunReport.notes).filter((note) => typeof note === 'string'),
  ];
  nextBlueprint.validationNotes = Array.from(new Set(serverNotes));
  return nextBlueprint;
}
