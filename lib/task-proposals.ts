import type { SpaceTaskCapability } from '@/types';
import { taskProposalWithServerCapabilities } from './task-proposal-policy.mjs';
export { normalizeTaskProposalSteps, taskProposalNeedsClarification } from './task-proposal-policy.mjs';

export function taskProposalCapabilities(
  goal: string,
  steps: string[] = [],
  deliverables: string[] = []
): SpaceTaskCapability[] {
  return taskProposalWithServerCapabilities({ goal, steps, deliverables }).capabilities as SpaceTaskCapability[];
}
