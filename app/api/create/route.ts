import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { isAdminEmail } from '@/app/api/_lib/admin';
import { maintainMysteryBlueprint } from '@/lib/blueprint-maintenance';
import {
  createBlueprintRuntimeState,
  executeBlueprintAction,
  getAvailableBlueprintActions,
} from '@/lib/story-engine';
import type { BlueprintRuntimeState, MysteryBlueprint } from '@/types/blueprint';

const DAILY_CREATE_LIMIT = 50;

type CreationType = 'mystery' | 'world' | 'character' | 'script';

interface CreateRequest {
  creationType: CreationType;
  step: number;
  concept?: string;
  confirmedData?: Record<string, any>;
}

function asArray(value: unknown): any[] {
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

function dryRunStateKey(state: BlueprintRuntimeState, depth: number) {
  return JSON.stringify({
    depth,
    sceneId: state.sceneId,
    flags: state.flags,
    clues: [...state.discoveredClueIds].sort(),
    inventory: [...state.inventoryItemIds].sort(),
    endingId: state.endingId || '',
  });
}

function createBlueprintDryRunReport(blueprint: MysteryBlueprint, maxDepth = 6) {
  const initialState = createBlueprintRuntimeState(blueprint);
  const queue: Array<{ state: BlueprintRuntimeState; depth: number }> = [{ state: initialState, depth: 0 }];
  const visited = new Set<string>();
  const reachedSceneIds = new Set<string>([initialState.sceneId]);
  const reachedActionIds = new Set<string>();
  const reachedClueIds = new Set<string>(initialState.discoveredClueIds);
  const deadEnds: Array<{ sceneId: string; depth: number; discoveredClueIds: string[] }> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const key = dryRunStateKey(current.state, current.depth);
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

    if (current.depth >= maxDepth) continue;

    for (const action of availableActions) {
      reachedActionIds.add(action.id);
      const result = executeBlueprintAction(blueprint, current.state, action.id);
      if (!result.allowed) continue;
      reachedSceneIds.add(result.state.sceneId);
      for (const clueId of result.state.discoveredClueIds) reachedClueIds.add(clueId);
      queue.push({ state: result.state, depth: current.depth + 1 });
    }
  }

  const missingRequiredEvidenceIds = asArray(blueprint.evidenceChain)
    .filter((evidence) => evidence.requiredForAccusation && evidence.clueId && !reachedClueIds.has(evidence.clueId))
    .map((evidence) => evidence.id);

  const notes: string[] = [];
  if (missingRequiredEvidenceIds.length > 0) {
    notes.push(`dry-run cannot reach required evidence: ${missingRequiredEvidenceIds.join(', ')}`);
  }
  if (deadEnds.length > 0) {
    notes.push(`dry-run found dead ends before story ending: ${deadEnds.length}`);
  }

  return {
    maxDepth,
    reachedSceneIds: Array.from(reachedSceneIds),
    reachedActionIds: Array.from(reachedActionIds),
    reachedClueIds: Array.from(reachedClueIds),
    missingRequiredEvidenceIds,
    deadEnds,
    notes,
  };
}

function repairMysteryBlueprint(blueprint: MysteryBlueprint): MysteryBlueprint {
  const suspects = asArray(blueprint.suspects);
  if (suspects.length === 0) return blueprint;

  const scenes = asArray(blueprint.scenes);
  const actions = asArray(blueprint.actions);
  const sceneIds = new Set(scenes.map((scene) => scene.id));
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
  }

  for (const scene of scenes) {
    scene.actionIds = uniqueStrings(asArray(scene.actionIds)).filter((actionId) => {
      const action = actions.find((item) => item.id === actionId);
      return action?.intent !== 'accuse';
    });
  }
  blueprint.actions = asArray(blueprint.actions).filter((action) => action.intent !== 'accuse');

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
  repairEvidenceChain(blueprint);

  return blueprint;
}

function validateMysteryBlueprint(blueprint: MysteryBlueprint | null | undefined): string[] {
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
    if ((action.intent === 'inspect' || action.intent === 'ask' || action.intent === 'use') && !effects.some((effect) => effect.type === 'flag.set')) {
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
    }
    if (!endingIds.has(accusation.failureEndingId)) {
      notes.push(`accusation.failureEndingId is missing: ${accusation.failureEndingId}`);
    }
  } else {
    notes.push('accusation is missing');
  }

  return Array.from(new Set(notes));
}

// Mystery Case prompt templates
const MYSTERY_PROMPTS: Record<number, (data: Record<string, any>) => { system: string; user: string }> = {
  1: (data) => ({
    system: `You are a creative assistant helping build interactive mystery case content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.

You are generating suspects for a mystery case. Each suspect should have a clear motive and a hidden secret.`,
    user: `创建类型：mystery_case
概念：${data.concept || '密室谋杀案'}

请生成这个谜案的嫌疑人。
输出格式：
{
  "suspects": [
    { "name": "角色名", "role": "身份", "motive": "动机", "secret": "秘密" }
  ],
  "coreTrick": "核心诡计描述"
}

要求：
- 生成 3-5 个嫌疑人
- 每个人都有合理的动机
- 每个人都有隐藏的秘密
- coreTrick 描述案件的核心手法`,
  }),
  2: (data) => ({
    system: `You are a creative assistant helping build interactive mystery case content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.

You are generating clues and red herrings for a mystery case. Clues should help solve the case, red herrings should mislead.`,
    user: `创建类型：mystery_case
已确认的嫌疑人：${JSON.stringify(data.confirmedData?.suspects || [])}
核心诡计：${data.confirmedData?.coreTrick || ''}

请生成线索和干扰项。
输出格式：
{
  "clues": [
    { "name": "线索名", "description": "描述", "visibility": "public" }
  ],
  "redHerrings": [
    { "name": "干扰项名", "description": "描述" }
  ]
}

要求：
- 生成 6-10 条线索
- 生成 2-3 个干扰项
- visibility 可以是 "public"（玩家一开始就能发现）或 "hidden"（需要特定条件才能发现）`,
  }),
  3: (data) => ({
    system: `You are a creative assistant helping build interactive mystery case content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.

You are generating the truth and endings for a mystery case. The truth should logically follow from the clues.`,
    user: `创建类型：mystery_case
已确认的嫌疑人：${JSON.stringify(data.confirmedData?.suspects || [])}
已确认的线索：${JSON.stringify(data.confirmedData?.clues || [])}

请生成真相和结局。
输出格式：
{
  "truth": {
    "killer": "凶手名",
    "method": "作案手法",
    "narrative": "真相叙述"
  },
  "solutionCondition": "破案条件描述",
  "endings": [
    { "id": "ending_id", "name": "结局名", "condition": "触发条件", "description": "结局描述" }
  ]
}

要求：
- 凶手必须是已确认嫌疑人之一
- 真相要能从线索中推理出来
- 生成 2-3 个结局（正确破案、错误指认、超时等）`,
  }),
  4: (data) => ({
    system: `You are a creative assistant helping build interactive mystery case content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.

You are generating the opening scene and system prompt for runtime.`,
    user: `创建类型：mystery_case
已确认的数据：
${JSON.stringify(data.confirmedData || {}, null, 2)}

请生成开场场景和运行时系统提示。
输出格式：
{
  "openingScene": "开场场景描述",
  "crimeScene": "案发现场描述",
  "greeting": "欢迎消息",
  "systemPrompt": "运行时系统提示词（包含完整的故事设定、角色、规则等）"
}

要求：
- openingScene 引导玩家进入故事
- crimeScene 描述案件发生地点
- greeting 是玩家看到的第一条消息
- systemPrompt 是运行时使用的完整提示词，包含所有已确认的内容`,
  }),
  5: (data) => ({
    system: `You are a game systems designer converting a confirmed mystery case into an executable text-game blueprint.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON field names must be English. Player-facing text may be Chinese.

The blueprint is the source of truth for a future engine. Do not rely on a system prompt to enforce gameplay.`,
    user: `Creation type: mystery_case
Confirmed data:
${JSON.stringify(data.confirmedData || {}, null, 2)}

Generate a playable blueprint for a text game engine.

Required output format:
{
  "blueprint": {
    "blueprintVersion": 1,
    "initialState": {
      "sceneId": "crime_scene",
      "objective": "string",
      "flags": {},
      "discoveredClueIds": [],
      "inventoryItemIds": []
    },
    "suspects": [
      { "id": "stable_ascii_id", "name": "string", "role": "string" }
    ],
    "clues": [
      { "id": "stable_ascii_id", "name": "string", "visibility": "public_or_hidden" }
    ],
    "evidenceChain": [
      {
        "id": "stable_ascii_id",
        "title": "string",
        "proves": ["what this evidence proves"],
        "clueId": "stable_ascii_id",
        "suspectIds": ["stable_ascii_id"],
        "requiredForAccusation": true,
        "obtainedByActionId": "stable_ascii_id"
      }
    ],
    "scenes": [
      {
        "id": "stable_ascii_id",
        "name": "string",
        "description": "player-visible text",
        "objectIds": ["stable_ascii_id"],
        "actionIds": ["stable_ascii_id"]
      }
    ],
    "objects": [
      {
        "id": "stable_ascii_id",
        "name": "string",
        "sceneId": "stable_ascii_id",
        "description": "player-visible text"
      }
    ],
    "actions": [
      {
        "id": "stable_ascii_id",
        "label": "player-facing action label",
        "intent": "inspect | ask | move | use | reason | accuse",
        "targetId": "stable_ascii_id",
        "conditions": [],
        "effects": [
          { "type": "clue.discover", "clueId": "stable_ascii_id" }
        ],
        "successText": "engine-approved result to narrate",
        "blockedText": "text shown when conditions are not met"
      }
    ],
    "accusation": {
      "enabledWhen": [],
      "correctSuspectId": "stable_ascii_id",
      "requiredClueIds": ["stable_ascii_id"],
      "successEndingId": "stable_ascii_id",
      "failureEndingId": "stable_ascii_id"
    },
    "failState": {
      "maxActionCount": 100,
      "endingId": "stable_ascii_id"
    },
    "endings": [
      { "id": "stable_ascii_id", "name": "string", "description": "string" }
    ],
    "validationNotes": []
  }
}

Rules:
- Every id must be stable, ASCII, lowercase, and unique.
- Only mark a clue public if the player should know it at the start; clues discovered by actions must be hidden.
- Every hidden clue must have at least one discovery action.
- Every accusation-required clue must appear in evidenceChain with requiredForAccusation true.
- Every evidenceChain item should point to the action that discovers its clue through obtainedByActionId.
- Every action must reference an existing object, suspect, scene, or clue target.
- Every effect must reference existing content.
- Branching choices must be represented as engine actions, not only described in successText.
- Include an interrogation_room scene when suspects exist.
- Include one ask action per suspect, with targetId set to that suspect id.
- Include a move action from the main investigation scene to interrogation_room.
- The interrogation_room scene actionIds must include those suspect ask actions.
- Include reason confrontation actions in interrogation_room that use key clues to confront the culprit.
- Each confrontation action should require inScene interrogation_room, hasClue for the key clue, and flag asked_<culpritId> true.
- Each confrontation action should discover a hidden deduction clue that is required for final accusation.
- Confrontation successText must be specific: name the evidence, the suspect's conflicting claim, and what contradiction is exposed.
- Include a final reason action like review_case / 整理案情 after confrontation clues are discovered.
- Final accusation should require this case-review flag, so accusation appears after investigation, interrogation, confrontation, and review.
- Avoid exposing all deep investigation actions at the start. Use conditions so deeper checks unlock after a simpler visible action on the same object or clue path.
- A good mystery rhythm is: broad scene scan -> focused object inspection -> hidden technical detail -> suspect ask -> evidence confrontation -> review -> accusation.
- If an action result asks the player to choose from options, those options must be next available blueprint actions.
- The correct accusation must require the culprit and key evidence.
- accusation.enabledWhen must include hasClue conditions for every requiredClueIds item, so accusation is not available too early.
- Include one wrong accusation ending.
- If you include a timeout, fog, unresolved, or too-slow ending, connect it through failState.endingId.
- failState.maxActionCount should usually be 80-120 for a mystery case.
- Do not expose hidden truth in scene or object descriptions.
- The blueprint must be playable from opening to at least one ending.`,
  }),
};

// Story World prompt templates
const WORLD_PROMPTS: Record<number, (data: Record<string, any>) => { system: string; user: string }> = {
  1: (data) => ({
    system: `You are a creative assistant helping build interactive story world content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：story_world
概念：${data.concept || ''}

请生成这个世界的基本设定。
输出格式：
{
  "title": "世界标题",
  "genre": "类型",
  "tone": "氛围",
  "hook": "吸引玩家的一句话",
  "locations": [
    { "name": "地点名", "description": "描述" }
  ]
}

要求：
- 生成 2-3 个关键地点
- hook 要能吸引玩家
- title 要有吸引力`,
  }),
  2: (data) => ({
    system: `You are a creative assistant helping build interactive story world content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：story_world
已确认的世界设定：${JSON.stringify(data.confirmedData?.world || data.confirmedData || {})}

请生成角色和规则。
输出格式：
{
  "characters": [
    { "name": "角色名", "role": "身份", "description": "描述" }
  ],
  "rules": ["规则1", "规则2"],
  "playerRole": "玩家的角色描述"
}

要求：
- 生成 3-5 个关键角色
- 生成 3-5 条世界规则
- playerRole 描述玩家在这个世界中的身份`,
  }),
  3: (data) => ({
    system: `You are a creative assistant helping build interactive story world content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：story_world
已确认的数据：
${JSON.stringify(data.confirmedData || {}, null, 2)}

请生成故事目标、开场和系统提示。
输出格式：
{
  "mainObjective": "主要目标",
  "openingScene": "开场场景",
  "endings": [
    { "id": "ending_id", "name": "结局名", "description": "描述" }
  ],
  "greeting": "欢迎消息",
  "systemPrompt": "运行时系统提示词"
}

要求：
- mainObjective 是玩家的主要任务
- openingScene 引导玩家进入故事
- 生成 2-3 个可能的结局
- greeting 是玩家看到的第一条消息
- systemPrompt 是运行时使用的完整提示词`,
  }),
};

// Character prompt templates
const CHARACTER_PROMPTS: Record<number, (data: Record<string, any>) => { system: string; user: string }> = {
  1: (data) => ({
    system: `You are a creative assistant helping build interactive character content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：character
概念：${data.concept || ''}

请生成这个角色的基本设定。
输出格式：
{
  "name": "角色名",
  "identity": "身份背景",
  "personality": "性格特征",
  "speakingStyle": "说话风格",
  "scenario": "当前情境",
  "relationshipToPlayer": "与玩家的关系",
  "boundaries": ["边界1", "边界2"]
}

要求：
- name 要有特色
- identity 包含角色的背景故事
- personality 描述性格特点
- speakingStyle 描述说话方式、口头禅、称呼用户的方式
- scenario 描述用户第一次进入对话时，角色所处的具体场景
- relationshipToPlayer 描述角色默认如何看待用户
- boundaries 是角色不会做的事情，必须包含“不替用户做决定”和“不跳出角色解释设定”`,
  }),
  2: (data) => ({
    system: `You are a creative assistant helping build interactive character content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：character
已确认的角色设定：${JSON.stringify(data.confirmedData || {})}

请生成角色的详细信息。
输出格式：
{
  "relationshipToPlayer": "与玩家的关系",
  "boundaries": ["边界1", "边界2"],
  "greeting": "欢迎消息",
  "exampleDialogues": [
    { "player": "玩家可能说的话", "character": "角色的回复" }
  ],
  "systemPrompt": "运行时系统提示词"
}

要求：
- relationshipToPlayer 描述角色与玩家的关系
- boundaries 是角色不会做的事情，必须包含“不替用户做决定”和“不跳出角色解释设定”
- greeting 是角色的第一句话
- 生成 2-3 组示例对话
- systemPrompt 是运行时使用的完整提示词，必须包含身份、性格、说话方式、当前情境、关系和边界
- systemPrompt 必须要求角色保持一致、自然回应、不要替用户行动、不要主动暴露系统设定`,
  }),
  3: (data) => ({
    system: `You are a roleplay content designer creating no-code assets for a character agent.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：character_assets
已确认的角色卡：${JSON.stringify(data.confirmedData || {})}

请为这个角色生成可编辑的世界资料和无代码技能卡。
输出格式：
{
  "worldNotes": [
    "稳定世界资料1",
    "稳定世界资料2"
  ],
  "skillCards": [
    {
      "name": "技能名",
      "trigger": "什么时候触发",
      "instruction": "角色应该如何执行",
      "boundaries": "这个技能不能做什么",
      "example": "一段角色口吻的示例回复"
    }
  ]
}

要求：
- worldNotes 生成 5-8 条，必须是角色稳定知道的事实、地点、关系、秘密、规则或常被提及的话题
- skillCards 生成 2-4 张，必须是无代码技能，不要写 JavaScript，不要要求调用外部工具
- 每张技能卡要能带来具体互动玩法，例如占卜、案件分析、掷骰判定、记忆回溯、情绪安抚、课程训练等
- trigger 要清楚说明用户怎样触发
- instruction 要让角色先询问必要信息，再给出回应，不能替用户做选择
- boundaries 要限制过度承诺、越权行动和跳出角色
- example 必须符合角色的说话风格`,
  }),
};

// Interactive Script prompt templates
const SCRIPT_PROMPTS: Record<number, (data: Record<string, any>) => { system: string; user: string }> = {
  1: (data) => ({
    system: `You are a creative assistant helping build interactive script content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：interactive_script
概念：${data.concept || ''}

请生成这个互动剧本的基本设定。
输出格式：
{
  "title": "标题",
  "genre": "类型",
  "tone": "氛围",
  "firstScene": "第一个场景描述",
  "estimatedDuration": "预计时长"
}

要求：
- title 要有吸引力
- firstScene 引导玩家进入故事
- estimatedDuration 如 "15-30 分钟"`,
  }),
  2: (data) => ({
    system: `You are a creative assistant helping build interactive script content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：interactive_script
已确认的设定：${JSON.stringify(data.confirmedData || {})}

请生成分支和结局。
输出格式：
{
  "choices": [
    { "id": "choice_id", "text": "选项文本", "consequence": "后果描述" }
  ],
  "triggerEvents": [
    { "id": "event_id", "name": "事件名", "description": "描述" }
  ],
  "endings": [
    { "id": "ending_id", "name": "结局名", "description": "描述" }
  ]
}

要求：
- 生成 3-5 个关键选择
- 生成 2-3 个触发事件
- 生成 2-3 个结局`,
  }),
  3: (data) => ({
    system: `You are a creative assistant helping build interactive script content.
Output valid JSON only. No markdown, no explanation, no code blocks.
The JSON must be in Chinese.`,
    user: `创建类型：interactive_script
已确认的数据：
${JSON.stringify(data.confirmedData || {}, null, 2)}

请生成开场和系统提示。
输出格式：
{
  "greeting": "欢迎消息",
  "systemPrompt": "运行时系统提示词"
}

要求：
- greeting 是玩家看到的第一条消息
- systemPrompt 是运行时使用的完整提示词，包含所有已确认的内容`,
  }),
};

const PROMPT_MAP: Record<CreationType, Record<number, (data: Record<string, any>) => { system: string; user: string }>> = {
  mystery: MYSTERY_PROMPTS,
  world: WORLD_PROMPTS,
  character: CHARACTER_PROMPTS,
  script: SCRIPT_PROMPTS,
};

function getQuotaDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        customModelEnabled: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
      },
    });

    if (!userSettings) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { creationType, step, concept, confirmedData }: CreateRequest = await request.json();

    // Validate inputs
    if (!creationType || !PROMPT_MAP[creationType]) {
      return NextResponse.json({ error: 'Invalid creation type' }, { status: 400 });
    }

    const stepPrompts = PROMPT_MAP[creationType];
    if (!step || !stepPrompts[step]) {
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
    }

    // Check quota for non-custom model users
    const usesCustomModel = Boolean(
      userSettings.customModelEnabled &&
        userSettings.apiBaseUrl &&
        userSettings.apiKey &&
        userSettings.modelName
    );
    const shouldCountQuota = !usesCustomModel && !isAdminEmail(userSettings.email);

    if (shouldCountQuota) {
      const day = getQuotaDay();
      const usage = await prisma.dailyChatUsage.upsert({
        where: { userId_day: { userId, day } },
        update: {},
        create: { userId, day },
      });

      if (usage.usedCount + 1 > DAILY_CREATE_LIMIT) {
        return NextResponse.json(
          { error: '今日创作次数已用完。请明天再来，或在设置里开启自己的模型配置。' },
          { status: 429 }
        );
      }

      await prisma.dailyChatUsage.update({
        where: { userId_day: { userId, day } },
        data: { usedCount: { increment: 1 } },
      });
    }

    // Get prompt template
    const promptTemplate = stepPrompts[step]({ concept, confirmedData });

    // Create OpenAI client
    const client = new OpenAI({
      baseURL: userSettings.apiBaseUrl || 'https://api-inference.modelscope.cn/v1',
      apiKey: userSettings.apiKey || process.env.apiKey,
    });

    const model = userSettings.modelName || 'deepseek-ai/DeepSeek-V4-Flash';

    // Call AI
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: promptTemplate.system },
        { role: 'user', content: promptTemplate.user },
      ],
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    const choices = Array.isArray(completion.choices) ? completion.choices : [];
    const content = choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        {
          error: 'AI 没有返回可用内容，请稍后重试或检查模型配置。',
          reason: choices.length === 0 ? 'empty_choices' : 'empty_message_content',
        },
        { status: 502 }
      );
    }

    // Parse JSON response
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return NextResponse.json(
          { error: 'AI 返回的内容不是有效 JSON，请重新生成。', reason: 'invalid_json' },
          { status: 502 }
        );
      }

      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return NextResponse.json(
          { error: 'AI 返回的 JSON 无法解析，请重新生成。', reason: 'invalid_extracted_json' },
          { status: 502 }
        );
      }
    }

    if (creationType === 'mystery' && step === 5 && parsed.blueprint) {
      parsed.blueprint = maintainMysteryBlueprint(parsed.blueprint);
    }

    return NextResponse.json({
      success: true,
      data: parsed,
      step,
      creationType,
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Create API error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
