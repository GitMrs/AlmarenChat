'use strict';

/**
 * Shared memory taxonomy.
 *
 * This is intentionally a policy module rather than a database enum: existing
 * records use several legacy source/category values and must remain readable
 * while the experience pipeline is migrated.
 */
export const MEMORY_LAYERS = Object.freeze({
  LONG_TERM: 'long_term',
  CURRENT_STATE: 'current_state',
  EXPERIENCE: 'experience',
  RULE: 'rule',
});

export const MEMORY_TYPES = Object.freeze({
  STABLE_FACT: 'stable_fact',
  PREFERENCE: 'preference',
  RELATIONSHIP: 'relationship',
  DECISION: 'decision',
  CURRENT_STATE: 'current_state',
  PLAN: 'plan',
  UNRESOLVED: 'unresolved',
  EVENT: 'event',
  EPISODE: 'episode',
  RULE: 'rule',
});

const TYPE_TO_LAYER = Object.freeze({
  stable_fact: MEMORY_LAYERS.LONG_TERM,
  preference: MEMORY_LAYERS.LONG_TERM,
  relationship: MEMORY_LAYERS.LONG_TERM,
  decision: MEMORY_LAYERS.LONG_TERM,
  current_state: MEMORY_LAYERS.CURRENT_STATE,
  plan: MEMORY_LAYERS.CURRENT_STATE,
  unresolved: MEMORY_LAYERS.CURRENT_STATE,
  event: MEMORY_LAYERS.EXPERIENCE,
  episode: MEMORY_LAYERS.EXPERIENCE,
  rule: MEMORY_LAYERS.RULE,
});

const LEGACY_TYPE_ALIASES = Object.freeze({
  fact: MEMORY_TYPES.STABLE_FACT,
  stable: MEMORY_TYPES.STABLE_FACT,
  tech: MEMORY_TYPES.STABLE_FACT,
  project: MEMORY_TYPES.DECISION,
  method: MEMORY_TYPES.RULE,
  correction: MEMORY_TYPES.RULE,
  capability: MEMORY_TYPES.RULE,
  task: MEMORY_TYPES.EPISODE,
  game: MEMORY_TYPES.EPISODE,
  study: MEMORY_TYPES.EPISODE,
  chat: MEMORY_TYPES.EPISODE,
  experience: MEMORY_TYPES.EPISODE,
});

export function normalizeMemoryType(value, fallback = MEMORY_TYPES.EPISODE) {
  const key = String(value || '').trim().toLowerCase();
  if (TYPE_TO_LAYER[key]) return key;
  if (LEGACY_TYPE_ALIASES[key]) return LEGACY_TYPE_ALIASES[key];
  return fallback;
}

export function memoryLayerForType(value) {
  return TYPE_TO_LAYER[normalizeMemoryType(value)] || MEMORY_LAYERS.EXPERIENCE;
}

export function isLongTermMemoryType(value) {
  return memoryLayerForType(value) === MEMORY_LAYERS.LONG_TERM;
}

// Personal memory stores also retain explicit interaction rules during migration.
export function personalMemoryType(value) {
  const type = normalizeMemoryType(value, null);
  return type && (isLongTermMemoryType(type) || type === MEMORY_TYPES.RULE) ? type : null;
}

export function isCurrentStateType(value) {
  return memoryLayerForType(value) === MEMORY_LAYERS.CURRENT_STATE;
}

export function isExperienceType(value) {
  const type = normalizeMemoryType(value);
  return type === MEMORY_TYPES.EVENT || type === MEMORY_TYPES.EPISODE;
}

export function isRuleType(value) {
  return normalizeMemoryType(value) === MEMORY_TYPES.RULE;
}

export function memoryTypeFromSourceType(value) {
  const source = String(value || '').trim().toUpperCase();
  if (source === 'TASK' || source === 'GAME' || source === 'STUDY' || source === 'CHAT') {
    return MEMORY_TYPES.EPISODE;
  }
  return normalizeMemoryType(value);
}

