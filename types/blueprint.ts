export type BlueprintActionIntent = 'inspect' | 'ask' | 'move' | 'use' | 'reason' | 'accuse';

export type BlueprintEffect =
  | { type: 'clue.discover'; clueId: string }
  | { type: 'item.add'; itemId: string }
  | { type: 'item.remove'; itemId: string }
  | { type: 'flag.set'; key: string; value: boolean }
  | { type: 'scene.change'; sceneId: string }
  | { type: 'objective.update'; objective: string }
  | { type: 'ending.reach'; endingId: string };

export type BlueprintCondition =
  | { type: 'hasClue'; clueId: string }
  | { type: 'hasItem'; itemId: string }
  | { type: 'flag'; key: string; value: boolean }
  | { type: 'flagNot'; key: string; value: boolean }
  | { type: 'inScene'; sceneId: string };

export interface BlueprintInitialState {
  sceneId: string;
  objective: string;
  flags: Record<string, boolean>;
  discoveredClueIds: string[];
  inventoryItemIds: string[];
}

export interface BlueprintSuspect {
  id: string;
  name: string;
  role?: string;
}

export interface BlueprintClue {
  id: string;
  name: string;
  description?: string;
  visibility: 'public' | 'hidden';
}

export interface BlueprintEvidence {
  id: string;
  title: string;
  proves: string[];
  clueId?: string;
  suspectIds?: string[];
  requiredForAccusation: boolean;
  obtainedByActionId?: string;
}

export interface BlueprintItem {
  id: string;
  name: string;
  description?: string;
}

export interface BlueprintScene {
  id: string;
  name: string;
  description: string;
  objectIds: string[];
  actionIds: string[];
}

export interface BlueprintObject {
  id: string;
  name: string;
  sceneId: string;
  description: string;
}

export interface BlueprintAction {
  id: string;
  label: string;
  intent: BlueprintActionIntent;
  targetId?: string;
  conditions: BlueprintCondition[];
  effects: BlueprintEffect[];
  successText: string;
  blockedText?: string;
}

export interface BlueprintEnding {
  id: string;
  name: string;
  description?: string;
}

export interface BlueprintAccusation {
  enabledWhen: BlueprintCondition[];
  correctSuspectId: string;
  requiredClueIds: string[];
  successEndingId: string;
  failureEndingId: string;
}

export interface BlueprintFailState {
  maxActionCount: number;
  endingId: string;
}

export interface BlueprintDryRunReport {
  maxStates: number;
  exploredStateCount: number;
  truncated: boolean;
  reachedSceneIds: string[];
  reachedActionIds: string[];
  reachedClueIds: string[];
  reachedCluePaths: Record<string, string[]>;
  missingRequiredEvidenceIds: string[];
  missingRequiredEvidence: Array<{
    evidenceId: string;
    clueId?: string;
    obtainedByActionId?: string;
  }>;
  deadEnds: Array<{
    sceneId: string;
    depth: number;
    discoveredClueIds: string[];
  }>;
  notes: string[];
}

export interface MysteryBlueprint {
  blueprintVersion: 1;
  initialState: BlueprintInitialState;
  suspects: BlueprintSuspect[];
  clues: BlueprintClue[];
  evidenceChain?: BlueprintEvidence[];
  items?: BlueprintItem[];
  scenes: BlueprintScene[];
  objects: BlueprintObject[];
  actions: BlueprintAction[];
  accusation?: BlueprintAccusation;
  failState?: BlueprintFailState;
  endings: BlueprintEnding[];
  dryRunReport?: BlueprintDryRunReport;
  validationNotes?: string[];
}

export interface BlueprintRuntimeState extends BlueprintInitialState {
  actionCount?: number;
  endedAt?: string;
  endingId?: string;
}

export interface BlueprintActionResult {
  allowed: boolean;
  actionId: string;
  state: BlueprintRuntimeState;
  effects: BlueprintEffect[];
  visibleText: string;
  blockedReasons: string[];
  nextActionIds: string[];
}

export interface BlueprintAccusationResult {
  allowed: boolean;
  correct: boolean;
  suspectId: string;
  clueIds: string[];
  state: BlueprintRuntimeState;
  endingId?: string;
  blockedReasons: string[];
  missingRequiredClueIds: string[];
}
