import { createHash } from 'node:crypto';
import { discoverWorkspaceSkills } from './workspace-skills';

/** Only enabled workspace skills are exposed; global skill discovery stays disabled. */
export async function readWorkspaceSkills(workspaceDir: string) {
  return (await discoverWorkspaceSkills(workspaceDir))
    .filter((skill) => skill.enabled)
    .map((skill) => ({ path: skill.runtimePath, digest: createHash('sha256').update(skill.content).digest('hex') }));
}

export function runtimeSettingsDigest(settings: unknown): string {
  return createHash('sha256').update(JSON.stringify(settings)).digest('hex');
}

/** Last model call's context snapshot, including cached input and generated output. */
export function contextUsage(usage: Record<string, number>, contextLength: number) {
  const parts = ['input', 'output', 'cacheRead', 'cacheWrite'];
  const measured = parts.some((key) => Number.isFinite(usage[key]));
  const totalTokens = measured
    ? parts.reduce((sum, key) => sum + (Number.isFinite(usage[key]) ? Math.max(0, usage[key]) : 0), 0)
    : Number(usage.totalTokens);
  if (!Number.isFinite(totalTokens)) return null;
  return { totalTokens, contextLength, remainingTokens: Math.max(0, contextLength - totalTokens) };
}
