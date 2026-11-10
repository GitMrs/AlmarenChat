import path from 'node:path';
import { readdir, readFile, stat, mkdir, rename, rmdir, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { safeJoinReal } from './safe-path';

export const PI_CONFIG_SKILL_PREFIX = '__PI_CONFIG_DIR__/skills/';
const SAFE_SKILL_ID = /^[a-zA-Z0-9_-]+$/;

const preparing = new Map<string, Promise<string>>();

async function prepareDirectory(workspaceDir: string): Promise<string> {
  const configDir = await safeJoinReal(path.dirname(workspaceDir), '.pi_agent');
  if (!configDir) throw new Error('Pi 配置目录超出当前工作区范围');
  await mkdir(configDir, { recursive: true });
  const skillsDir = await safeJoinReal(configDir, 'skills');
  if (!skillsDir) throw new Error('技能目录超出 Pi 配置范围');
  await mkdir(skillsDir, { recursive: true });

  // The old workspace directory is a migration source, never a second active root.
  const legacyDir = await safeJoinReal(workspaceDir, '.pi/skills');
  if (!legacyDir) return skillsDir;
  const entries = await readdir(legacyDir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_SKILL_ID.test(entry.name)) continue;
    const source = await safeJoinReal(legacyDir, entry.name);
    const target = await safeJoinReal(skillsDir, entry.name);
    if (!source || !target) continue;
    const existing = await lstat(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) {
      // Preserve the complete old copy without overwriting an installed version.
      const backups = await safeJoinReal(configDir, 'skill-backups');
      if (!backups) throw new Error('技能备份目录超出 Pi 配置范围');
      await mkdir(backups, { recursive: true });
      await rename(source, path.join(backups, `${entry.name}-${randomUUID()}`));
    } else {
      await rename(source, target);
    }
  }
  await rmdir(legacyDir).catch((error) => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  });
  return skillsDir;
}

/** One persistent skill directory per Studio workspace, also mounted at /pi-config/skills. */
export function prepareWorkspaceSkills(workspaceDir: string): Promise<string> {
  const key = path.resolve(workspaceDir);
  const existing = preparing.get(key);
  if (existing) return existing;
  const operation = prepareDirectory(key).finally(() => preparing.delete(key));
  preparing.set(key, operation);
  return operation;
}

export async function resolveWorkspaceSkill(workspaceDir: string, id: string) {
  // Accept IDs returned by the previous two-root UI until that page is refreshed.
  const name = id.replace(/^config:/, '');
  if (!SAFE_SKILL_ID.test(name)) return null;
  const skillsDir = await prepareWorkspaceSkills(workspaceDir);
  const folder = await safeJoinReal(skillsDir, name);
  if (!folder) return null;
  return {
    folder,
    runtimePath: `${PI_CONFIG_SKILL_PREFIX}${name}/SKILL.md`,
  };
}

export async function discoverWorkspaceSkills(workspaceDir: string) {
  return readSkills(await prepareWorkspaceSkills(workspaceDir));
}

async function legacyUserSkillsDirectory(workspaceDir: string) {
  return safeJoinReal(path.dirname(path.dirname(path.resolve(workspaceDir))), '.pi_agent/skills');
}

export async function discoverLegacyUserSkills(workspaceDir: string) {
  const directory = await legacyUserSkillsDirectory(workspaceDir);
  return directory ? readSkills(directory) : [];
}

export async function importLegacyUserSkills(workspaceDir: string) {
  const legacyDir = await legacyUserSkillsDirectory(workspaceDir);
  const targetDir = await prepareWorkspaceSkills(workspaceDir);
  const imported: string[] = [];
  const skipped: string[] = [];
  if (!legacyDir) return { imported, skipped };
  for (const skill of await readSkills(legacyDir)) {
    const source = await safeJoinReal(legacyDir, skill.id);
    const target = await safeJoinReal(targetDir, skill.id);
    if (!source || !target) continue;
    const exists = await lstat(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (exists) {
      skipped.push(skill.id);
      continue;
    }
    try {
      await rename(source, target);
      imported.push(skill.id);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { imported, skipped };
}

async function readSkills(skillsDir: string) {
  const skills: Array<{ id: string; enabled: boolean; content: string; updatedAt: number; runtimePath: string }> = [];
  const entries = await readdir(skillsDir, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !SAFE_SKILL_ID.test(entry.name)) continue;
    const id = entry.name;
    const folder = await safeJoinReal(skillsDir, id);
    if (!folder) continue;
    for (const enabled of [true, false]) {
      const file = await safeJoinReal(folder, enabled ? 'SKILL.md' : 'SKILL.md.disabled');
      if (!file) continue;
      try {
        const [content, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
        skills.push({ id, enabled, content, updatedAt: info.mtimeMs, runtimePath: `${PI_CONFIG_SKILL_PREFIX}${id}/SKILL.md` });
        break;
      } catch (error: any) {
        if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
      }
    }
  }
  return skills;
}
