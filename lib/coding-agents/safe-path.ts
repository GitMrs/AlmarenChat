import path from 'node:path';
import { realpath } from 'node:fs/promises';

/**
 * Joins `userPath` onto `baseDir` and verifies the result stays inside `baseDir`.
 * Rejects `..` traversal, absolute-path smuggling, and prefix-sibling escapes
 * (e.g. `workspace_x` passing a naive `startsWith('workspace')` check).
 */
export function safeJoin(baseDir: string, userPath: string): string | null {
  if (!userPath || typeof userPath !== 'string') return null;

  // Reject absolute paths — path.resolve would discard baseDir entirely
  if (path.isAbsolute(userPath)) return null;

  const base = path.resolve(baseDir);
  const target = path.resolve(base, userPath);

  const rel = path.relative(base, target);
  if (!rel || rel === '') {
    // Exactly the base directory itself
    return base;
  }
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return target;
}

/**
 * Same as safeJoin, but additionally resolves symlinks on both sides and
 * re-checks containment. Use for filesystem reads/writes where the workspace
 * content is produced by untrusted coding agents (they can plant symlinks
 * pointing outside the sandbox).
 */
export async function safeJoinReal(baseDir: string, userPath: string): Promise<string | null> {
  const target = safeJoin(baseDir, userPath);
  if (!target) return null;

  const [realBase, realTarget] = await Promise.all([
    realpath(path.resolve(baseDir)).catch(() => null),
    realpath(target).catch(() => null),
  ]);
  if (!realBase || !realTarget) {
    // Target (or base) does not exist yet — lexical check already passed
    return target;
  }

  const rel = path.relative(realBase, realTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return realTarget;
}
