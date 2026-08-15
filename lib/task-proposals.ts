import type { SpaceTaskCapability } from '@/types';
import { taskProposalNeedsWebResearch } from './task-proposal-policy.mjs';
export { normalizeTaskProposalSteps, taskProposalNeedsClarification } from './task-proposal-policy.mjs';

const WORKSPACE_WRITE_PATTERN = /(?:制作|创建|生成|编写|修改|编辑|写入|开发|搭建|产出).{0,20}(?:文件|文档|报告|网页|网站|代码|\.md\b|html)|(?:文件|文档|报告|网页|网站|代码|\.md\b|html).{0,20}(?:制作|创建|生成|编写|修改|编辑|写入|开发|搭建|产出)|\.(?:md|html|css|js|jsx|ts|tsx|json|csv)\b/i;

export function taskProposalCapabilities(
  goal: string,
  steps: string[] = [],
  deliverables: string[] = []
): SpaceTaskCapability[] {
  const text = `${goal}\n${steps.join('\n')}\n${deliverables.join('\n')}`;
  return [
    'workspace_read',
    ...(WORKSPACE_WRITE_PATTERN.test(text) ? ['workspace_write' as const] : []),
    ...(taskProposalNeedsWebResearch(goal, steps, deliverables) ? ['web_research' as const] : []),
  ];
}
