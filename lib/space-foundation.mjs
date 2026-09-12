import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_FILES = 12;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_CHARS = 48_000;
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv']);

export function loadSpaceFoundationContext({ projectRoot, userId, spaceId } = {}) {
  const root = path.resolve(projectRoot, 'data', 'spaces', String(userId), String(spaceId), 'workspace', 'foundation');
  if (!existsSync(root)) return '';
  const files = [];
  const visit = (directory) => {
    if (files.length >= MAX_FILES) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_FILES || entry.name.startsWith('.')) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const size = statSync(target).size;
        if (size <= MAX_FILE_BYTES) files.push({ target, relativePath: path.relative(root, target).replaceAll(path.sep, '/') });
      }
    }
  };
  visit(root);
  let remaining = MAX_TOTAL_CHARS;
  return files.map(({ target, relativePath }) => {
    if (remaining <= 0) return '';
    const content = readFileSync(target, 'utf8').slice(0, remaining);
    remaining -= content.length;
    return `【${relativePath}】\n${content}`;
  }).filter(Boolean).join('\n\n');
}
