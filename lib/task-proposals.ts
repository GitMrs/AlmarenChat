import type { SpaceTaskCapability } from '@/types';
export {
  normalizeTaskProposalSteps,
  taskProposalNeedsClarification,
  taskProposalWithServerCapabilities,
  taskProposalWithTurnNetworkAuthorization,
} from './task-proposal-policy.mjs';

export function taskProposalCapabilities(
  capabilities: unknown
): SpaceTaskCapability[] {
  if (!Array.isArray(capabilities)) return [];
  return [...new Set(capabilities.filter((capability): capability is SpaceTaskCapability =>
    capability === 'workspace_read' || capability === 'workspace_write' || capability === 'web_research' || capability === 'code_execute'
  ))];
}
