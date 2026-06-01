import type {
  BlueprintAccusationResult,
  BlueprintAction,
  BlueprintActionResult,
  BlueprintCondition,
  BlueprintEffect,
  BlueprintRuntimeState,
  MysteryBlueprint,
} from '@/types/blueprint';

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export function createBlueprintRuntimeState(blueprint: MysteryBlueprint): BlueprintRuntimeState {
  const publicClueIds = blueprint.clues
    .filter((clue) => clue.visibility === 'public')
    .map((clue) => clue.id);

  return {
    ...blueprint.initialState,
    flags: { ...blueprint.initialState.flags },
    discoveredClueIds: unique([...blueprint.initialState.discoveredClueIds, ...publicClueIds]),
    inventoryItemIds: [...blueprint.initialState.inventoryItemIds],
    actionCount: 0,
  };
}

export function checkBlueprintCondition(condition: BlueprintCondition, state: BlueprintRuntimeState) {
  switch (condition.type) {
    case 'hasClue':
      return state.discoveredClueIds.includes(condition.clueId);
    case 'hasItem':
      return state.inventoryItemIds.includes(condition.itemId);
    case 'flag':
      return state.flags[condition.key] === condition.value;
    case 'flagNot':
      return state.flags[condition.key] !== condition.value;
    case 'inScene':
      return state.sceneId === condition.sceneId;
    default:
      return false;
  }
}

function getBlockedReasons(action: BlueprintAction, state: BlueprintRuntimeState) {
  return action.conditions
    .filter((condition) => !checkBlueprintCondition(condition, state))
    .map((condition) => {
      if (condition.type === 'hasClue') return `Missing clue: ${condition.clueId}`;
      if (condition.type === 'hasItem') return `Missing item: ${condition.itemId}`;
      if (condition.type === 'flag') return `Flag ${condition.key} must be ${condition.value}`;
      if (condition.type === 'flagNot') return `Flag ${condition.key} must not be ${condition.value}`;
      if (condition.type === 'inScene') return `Must be in scene: ${condition.sceneId}`;
      return 'Condition is not met';
    });
}

export function applyBlueprintEffect(state: BlueprintRuntimeState, effect: BlueprintEffect): BlueprintRuntimeState {
  switch (effect.type) {
    case 'clue.discover':
      return {
        ...state,
        discoveredClueIds: unique([...state.discoveredClueIds, effect.clueId]),
      };
    case 'item.add':
      return {
        ...state,
        inventoryItemIds: unique([...state.inventoryItemIds, effect.itemId]),
      };
    case 'item.remove':
      return {
        ...state,
        inventoryItemIds: state.inventoryItemIds.filter((itemId) => itemId !== effect.itemId),
      };
    case 'flag.set':
      return {
        ...state,
        flags: { ...state.flags, [effect.key]: effect.value },
      };
    case 'scene.change':
      return {
        ...state,
        sceneId: effect.sceneId,
      };
    case 'objective.update':
      return {
        ...state,
        objective: effect.objective,
      };
    case 'ending.reach':
      return {
        ...state,
        endingId: effect.endingId,
        endedAt: new Date().toISOString(),
      };
    default:
      return state;
  }
}

export function getAvailableBlueprintActions(blueprint: MysteryBlueprint, state: BlueprintRuntimeState) {
  if (state.endedAt) return [];

  const currentScene = blueprint.scenes.find((scene) => scene.id === state.sceneId);
  if (!currentScene) return [];

  const actionById = new Map(blueprint.actions.map((action) => [action.id, action]));
  return currentScene.actionIds
    .map((actionId) => actionById.get(actionId))
    .filter((action): action is BlueprintAction => Boolean(action))
    .filter((action) => getBlockedReasons(action, state).length === 0);
}

export function executeBlueprintAction(
  blueprint: MysteryBlueprint,
  state: BlueprintRuntimeState,
  actionId: string
): BlueprintActionResult {
  const action = blueprint.actions.find((item) => item.id === actionId);
  if (!action) {
    return {
      allowed: false,
      actionId,
      state,
      effects: [],
      visibleText: 'Action does not exist.',
      blockedReasons: ['Action does not exist'],
      nextActionIds: getAvailableBlueprintActions(blueprint, state).map((item) => item.id),
    };
  }

  if (state.endedAt) {
    return {
      allowed: false,
      actionId,
      state,
      effects: [],
      visibleText: 'The story has already ended.',
      blockedReasons: ['Story has ended'],
      nextActionIds: [],
    };
  }

  const blockedReasons = getBlockedReasons(action, state);
  if (blockedReasons.length > 0) {
    return {
      allowed: false,
      actionId,
      state,
      effects: [],
      visibleText: action.blockedText || blockedReasons.join('; '),
      blockedReasons,
      nextActionIds: getAvailableBlueprintActions(blueprint, state).map((item) => item.id),
    };
  }

  const effectedState = action.effects.reduce(
    (currentState, effect) => applyBlueprintEffect(currentState, effect),
    state
  );
  const countedState = {
    ...effectedState,
    actionCount: (state.actionCount || 0) + 1,
  };
  const failState = blueprint.failState;
  const nextState =
    failState &&
    !countedState.endedAt &&
    countedState.actionCount >= failState.maxActionCount
      ? applyBlueprintEffect(countedState, { type: 'ending.reach', endingId: failState.endingId })
      : countedState;

  return {
    allowed: true,
    actionId,
    state: nextState,
    effects: action.effects,
    visibleText: action.successText,
    blockedReasons: [],
    nextActionIds: getAvailableBlueprintActions(blueprint, nextState).map((item) => item.id),
  };
}

export function resolveBlueprintAccusation(
  blueprint: MysteryBlueprint,
  state: BlueprintRuntimeState,
  suspectId: string,
  clueIds: string[]
): BlueprintAccusationResult {
  const accusation = blueprint.accusation;
  if (!accusation) {
    return {
      allowed: false,
      correct: false,
      suspectId,
      clueIds,
      state,
      blockedReasons: ['Accusation is not configured'],
      missingRequiredClueIds: [],
    };
  }

  if (state.endedAt) {
    return {
      allowed: false,
      correct: false,
      suspectId,
      clueIds,
      state,
      endingId: state.endingId,
      blockedReasons: ['Story has ended'],
      missingRequiredClueIds: [],
    };
  }

  const enabledBlockedReasons = accusation.enabledWhen
    .filter((condition) => !checkBlueprintCondition(condition, state))
    .map((condition) => {
      if (condition.type === 'hasClue') return `Missing clue: ${condition.clueId}`;
      if (condition.type === 'hasItem') return `Missing item: ${condition.itemId}`;
      if (condition.type === 'flag') return `Flag ${condition.key} must be ${condition.value}`;
      if (condition.type === 'flagNot') return `Flag ${condition.key} must not be ${condition.value}`;
      if (condition.type === 'inScene') return `Must be in scene: ${condition.sceneId}`;
      return 'Accusation condition is not met';
    });
  const missingDiscoveredRequiredClueIds = accusation.requiredClueIds.filter(
    (clueId) => !state.discoveredClueIds.includes(clueId)
  );

  if (enabledBlockedReasons.length > 0 || missingDiscoveredRequiredClueIds.length > 0) {
    return {
      allowed: false,
      correct: false,
      suspectId,
      clueIds,
      state,
      blockedReasons: [
        ...enabledBlockedReasons,
        ...missingDiscoveredRequiredClueIds.map((clueId) => `Required clue is not discovered: ${clueId}`),
      ],
      missingRequiredClueIds: missingDiscoveredRequiredClueIds,
    };
  }

  const discoveredEvidenceIds = clueIds.filter((clueId) => state.discoveredClueIds.includes(clueId));
  const missingSubmittedClueIds = clueIds.filter((clueId) => !state.discoveredClueIds.includes(clueId));
  if (missingSubmittedClueIds.length > 0) {
    return {
      allowed: false,
      correct: false,
      suspectId,
      clueIds,
      state,
      blockedReasons: missingSubmittedClueIds.map((clueId) => `Submitted clue is not discovered: ${clueId}`),
      missingRequiredClueIds: [],
    };
  }

  const missingRequiredClueIds = accusation.requiredClueIds.filter(
    (clueId) => !discoveredEvidenceIds.includes(clueId)
  );
  if (suspectId === accusation.correctSuspectId && missingRequiredClueIds.length > 0) {
    return {
      allowed: false,
      correct: false,
      suspectId,
      clueIds,
      state,
      blockedReasons: ['Required evidence is missing'],
      missingRequiredClueIds,
    };
  }

  const correct = suspectId === accusation.correctSuspectId;
  const endingId = correct ? accusation.successEndingId : accusation.failureEndingId;
  const nextState = applyBlueprintEffect(state, { type: 'ending.reach', endingId });

  return {
    allowed: true,
    correct,
    suspectId,
    clueIds,
    state: nextState,
    endingId,
    blockedReasons: [],
    missingRequiredClueIds,
  };
}
