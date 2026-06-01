// Story Runtime Types

export interface RuntimeClue {
  id: string;
  name: string;
  description?: string;
  discovered: boolean;
  discoveredAt?: string;
}

export interface RuntimeItem {
  id: string;
  name: string;
  description?: string;
  acquiredAt?: string;
}

export interface RuntimeEnding {
  id: string;
  name: string;
  condition: string;
  description?: string;
  reached?: boolean;
}

export interface RuntimeState {
  sceneId: string;
  sceneName: string;
  objective: string;
  summary: string;
  flags: Record<string, boolean>;
  clues: RuntimeClue[];
  inventory: RuntimeItem[];
  endings: RuntimeEnding[];
  suggestedActions: string[];
  endedAt?: string;
  endingType?: string;
}

export type RuntimeEventType =
  | 'scene.change'
  | 'clue.discover'
  | 'clue.update'
  | 'item.add'
  | 'item.remove'
  | 'objective.update'
  | 'summary.update'
  | 'flag.set'
  | 'ending.reach'
  | 'suggested_actions.update';

export interface RuntimeEvent {
  type: RuntimeEventType;
  payload: Record<string, any>;
}

export interface AIResponseContract {
  narrative: string;
  events: RuntimeEvent[];
  suggestedActions: string[];
}

export function createInitialRuntimeState(config: Record<string, any>): RuntimeState {
  const clues: RuntimeClue[] = [];
  const inventory: RuntimeItem[] = [];
  const endings: RuntimeEnding[] = [];

  // Extract clues from builderConfig
  if (Array.isArray(config.clues)) {
    for (const clue of config.clues) {
      clues.push({
        id: clue.id || clue.name?.toLowerCase().replace(/\s+/g, '_') || `clue_${clues.length}`,
        name: clue.name || '未命名线索',
        description: clue.description,
        discovered: clue.visibility === 'public',
        discoveredAt: clue.visibility === 'public' ? new Date().toISOString() : undefined,
      });
    }
  }

  // Extract endings from builderConfig
  if (Array.isArray(config.endings)) {
    for (const ending of config.endings) {
      endings.push({
        id: ending.id || `ending_${endings.length}`,
        name: ending.name || '未命名结局',
        condition: ending.condition || '',
        description: ending.description,
      });
    }
  }

  return {
    sceneId: 'opening',
    sceneName: config.crimeScene || config.openingScene || '开场',
    objective: config.solutionCondition || '探索故事，揭开真相',
    summary: '',
    flags: {},
    clues,
    inventory,
    endings,
    suggestedActions: [],
  };
}
