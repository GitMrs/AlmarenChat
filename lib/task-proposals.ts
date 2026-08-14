import type { SpaceTaskCapability } from '@/types';

const WEB_RESEARCH_PATTERN = /(联网|搜索|检索|调研|研究|收集资料|查找资料|最新|来源|引用|市场|竞品|research)/i;

export function taskProposalCapabilities(
  goal: string,
  steps: string[] = [],
  deliverables: string[] = []
): SpaceTaskCapability[] {
  const text = `${goal}\n${steps.join('\n')}\n${deliverables.join('\n')}`;
  return [
    'workspace_read',
    'workspace_write',
    ...(WEB_RESEARCH_PATTERN.test(text) ? ['web_research' as const] : []),
  ];
}
