import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SAFE_PACKAGE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;
const MAX_ENTRY_FILES = 120;
const MAX_ROOT_CHARS = 48_000;
const SCRIPT_EXTENSIONS = new Set(['.py', '.js', '.mjs', '.cjs', '.sh']);
const MAX_MANIFEST_BYTES = 64 * 1024;

function packageRoot(projectRoot, packagePath) {
  const value = String(packagePath || '').trim();
  if (!SAFE_PACKAGE.test(value)) throw new Error('Skill 包路径格式不安全');
  const root = path.resolve(projectRoot, 'skills', value);
  const skillsRoot = path.resolve(projectRoot, 'skills');
  if (!root.startsWith(`${skillsRoot}${path.sep}`)) throw new Error('Skill 包路径超出 skills 目录');
  return root;
}

function packageFile(root, relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Skill 文件路径不安全');
  }
  const target = path.resolve(root, normalized);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Skill 文件路径超出 Skill 包');
  return { target, normalized };
}

async function walkSkillFiles(root, current = root, output = []) {
  if (output.length >= MAX_ENTRY_FILES) return output;
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) await walkSkillFiles(root, target, output);
    else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
      output.push(path.relative(root, target).split(path.sep).join('/'));
    }
    if (output.length >= MAX_ENTRY_FILES) break;
  }
  return output;
}

async function walkScripts(root, current = root, output = []) {
  if (output.length >= MAX_ENTRY_FILES) return output;
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) await walkScripts(root, target, output);
    else if (entry.isFile() && SCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      output.push(path.relative(root, target).split(path.sep).join('/'));
    }
    if (output.length >= MAX_ENTRY_FILES) break;
  }
  return output;
}

/** Load the real root SKILL.md without executing anything from the package. */
export async function loadSkillPackage({ projectRoot, packagePath } = {}) {
  if (!packagePath) return null;
  const root = packageRoot(projectRoot, packagePath);
  const rootFile = path.join(root, 'SKILL.md');
  const info = await stat(rootFile).catch(() => null);
  if (!info?.isFile()) throw new Error(`Skill 包缺少根入口：${packagePath}/SKILL.md`);
  const source = await readFile(rootFile, 'utf8');
  if (!source.trim()) throw new Error(`Skill 根入口为空：${packagePath}/SKILL.md`);
  const childFiles = (await walkSkillFiles(root)).filter((file) => file !== 'SKILL.md');
  const discoveredScripts = await walkScripts(root);
  let manifest = null;
  const manifestFile = path.join(root, 'almaren.skill.json');
  const manifestInfo = await stat(manifestFile).catch(() => null);
  if (manifestInfo?.isFile() && manifestInfo.size <= MAX_MANIFEST_BYTES) {
    try {
      const parsed = JSON.parse(await readFile(manifestFile, 'utf8'));
      const entries = Array.isArray(parsed?.entrypoints) ? parsed.entrypoints : [];
      const validEntries = entries.filter((entry) => {
        const script = String(entry?.script || '');
        return discoveredScripts.includes(script)
          && ['python3', 'node'].includes(String(entry?.runtime || ''))
          && ['forbidden', 'controlled'].includes(String(entry?.network || 'forbidden'))
          && ['read', 'write'].includes(String(entry?.workspace || 'read'));
      }).map((entry) => ({
        script: String(entry.script), runtime: String(entry.runtime),
        network: String(entry.network), workspace: String(entry.workspace),
        description: String(entry.description || '').slice(0, 500),
      }));
      manifest = { version: String(parsed?.version || '1'), entrypoints: validEntries };
    } catch {
      manifest = null;
    }
  }
  const scripts = manifest ? manifest.entrypoints.map((entry) => entry.script) : discoveredScripts;
  return {
    packagePath,
    rootFile: 'SKILL.md',
    instructions: source.slice(0, MAX_ROOT_CHARS),
    entryFiles: childFiles,
    scripts,
    manifest,
  };
}

export async function readSkillPackageFile({ projectRoot, packagePath, relativePath, limit = 128_000 } = {}) {
  const root = packageRoot(projectRoot, packagePath);
  const { target, normalized } = packageFile(root, relativePath);
  const info = await lstat(target).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Skill 文件不存在或不安全：${normalized}`);
  const max = Math.min(128_000, Math.max(1, Number(limit) || 128_000));
  const content = await readFile(target, 'utf8');
  return { path: normalized, content: content.slice(0, max), hasMore: content.length > max, totalChars: content.length };
}
