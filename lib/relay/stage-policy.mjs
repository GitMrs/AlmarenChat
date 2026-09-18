import { gomokuStage } from './gomoku.mjs';

const STAGES = { gomoku: gomokuStage };

export function relayStagePolicy(kind) {
  return STAGES[kind] || null;
}

export function relayStageDecision(kind, count) {
  const stage = relayStagePolicy(kind);
  if (!stage) return null;
  return {
    type: 'stage_limit',
    approved: false,
    increment: stage.size,
    summary: stage.waitingSummary(count),
  };
}
