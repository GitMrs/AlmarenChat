import { createHash, randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';

const MAX_FILES = 50;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_PACKAGE_BYTES = 512 * 1024;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 60;
const WINDOWS_RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_SPACE_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.tsv', '.html', '.css',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.ps1',
]);
const FIXED_ALLOWED_TOOLS = Object.freeze([
  'list_files', 'read_file', 'check_files', 'write_file', 'patch_file', 'patch_files', 'run_check', 'read_skill_file',
]);

function isIgnoredRepositoryMetadata(relativePath) {
  const normalized = relativePath.toLowerCase();
  return path.posix.basename(normalized) === '.gitignore' || normalized === 'license';
}

function safeScopeId(value, label) {
  const id = String(value || '');
  if (!SAFE_SPACE_ID.test(id)) throw new Error(`${label}格式不安全`);
  return id;
}

function normalizePackagePath(value) {
  const raw = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = raw.split('/');
  if (!raw || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Skill 包含不安全的文件路径');
  }
  return parts.join('/');
}

function unquote(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

export function parseSkillMarkdown(source) {
  const text = String(source || '').replace(/^\uFEFF/, '');
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(text);
  const metadata = {};
  const body = match ? match[2].trim() : text.trim();
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const field = /^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line);
      if (field) metadata[field[1].toLowerCase()] = unquote(field[2]);
    }
  }
  if (!body) throw new Error('SKILL.md 正文不能为空');
  return { metadata, body };
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function sourceSlug(sourceUrl) {
  const url = new URL(sourceUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  const marker = parts.findIndex((part) => part === 'tree' || part === 'blob');
  const candidate = marker >= 0 ? parts.at(-1) : parts[1] || parts.at(-2) || 'skill';
  return slug(candidate?.replace(/\.git$/i, '').replace(/skill\.md$/i, '')) || 'skill';
}

function publicSkill(manifest) {
  const scripts = executableSkillScripts(manifest);
  const approvedScripts = approvedSkillScripts(manifest, scripts);
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    sourceUrl: manifest.sourceUrl,
    digest: manifest.digest,
    installedAt: manifest.installedAt,
    enabled: manifest.enabled !== false,
    fileCount: manifest.files.length,
    warnings: manifest.warnings || [],
    scripts,
    approvedScripts,
    executionEnabled: approvedScripts.length > 0,
  };
}

function executableSkillScripts(manifest) {
  return (manifest.files || []).filter((file) => path.posix.extname(file).toLowerCase() === '.py');
}

function approvedSkillScripts(manifest, scripts = executableSkillScripts(manifest)) {
  const available = new Set(scripts);
  return [...new Set(Array.isArray(manifest.approvedScripts) ? manifest.approvedScripts.map(String) : [])]
    .filter((file) => available.has(file));
}

export function validateSpaceSkillPackage({ sourceUrl, files }) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Skill 包为空');
  const packageFiles = files
    .map((file) => ({ ...file, path: normalizePackagePath(file.path) }))
    .filter((file) => !isIgnoredRepositoryMetadata(file.path));
  if (packageFiles.length === 0) throw new Error('Skill 包为空');
  if (packageFiles.length > MAX_FILES) throw new Error(`Skill 包最多允许 ${MAX_FILES} 个文件`);
  const normalized = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const file of packageFiles) {
    const relativePath = file.path;
    if (relativePath.toLowerCase() === '.space-skill.json') throw new Error('Skill 包包含平台保留文件');
    if (seen.has(relativePath.toLowerCase())) throw new Error(`Skill 包含重复文件：${relativePath}`);
    seen.add(relativePath.toLowerCase());
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content ?? ''), 'utf8');
    if (content.length > MAX_FILE_BYTES) throw new Error(`Skill 文件超过 128KB：${relativePath}`);
    if (content.includes(0)) throw new Error(`第一阶段不支持二进制 Skill 文件：${relativePath}`);
    if (!TEXT_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())) {
      throw new Error(`第一阶段不支持此 Skill 文件类型：${relativePath}`);
    }
    totalBytes += content.length;
    normalized.push({ path: relativePath, content });
  }
  if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('Skill 包总大小不能超过 512KB');
  const skillFile = normalized.find((file) => file.path.toLowerCase() === 'skill.md');
  if (!skillFile) throw new Error('Skill 包根目录缺少 SKILL.md');

  const { metadata, body } = parseSkillMarkdown(skillFile.content.toString('utf8'));
  if (body.length > 24_000) throw new Error('SKILL.md 正文不能超过 24000 字符');
  const idPart = slug(metadata.id || metadata.name) || sourceSlug(sourceUrl);
  if (!SAFE_ID.test(idPart)) throw new Error('无法生成安全的 Skill ID');
  const digest = createHash('sha256');
  for (const file of [...normalized].sort((left, right) => left.path.localeCompare(right.path))) {
    digest.update(file.path).update('\0').update(file.content).update('\0');
  }
  const hash = digest.digest('hex');
  const description = String(metadata.description || metadata.when_to_use || '').trim().slice(0, 500);
  const name = String(metadata.name || description || idPart).trim().slice(0, 100);
  const warnings = normalized.some((file) => ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.ps1'].includes(path.posix.extname(file.path).toLowerCase()))
    ? ['包内包含脚本文件；当前只作为参考资料保存，不会执行。']
    : [];
  const manifest = {
    id: `space:${idPart}`,
    name,
    version: String(metadata.version || hash.slice(0, 12)).trim().slice(0, 50),
    description: description || `${name} 的空间说明型 Skill`,
    sourceUrl,
    digest: hash,
    enabled: true,
    installedAt: new Date().toISOString(),
    files: normalized.map((file) => file.path),
    warnings,
    approvedScripts: [],
  };
  return { manifest, files: normalized, instructions: body };
}

export function parseSpaceSkillArchive({ archive, sourceName = 'skill.zip' }) {
  const bytes = Buffer.isBuffer(archive) ? archive : Buffer.from(archive || []);
  if (bytes.length === 0) throw new Error('上传的 Skill ZIP 为空');
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Skill ZIP 不能超过 2MB');

  let entries;
  try {
    entries = new AdmZip(bytes).getEntries().filter((entry) => !entry.isDirectory);
  } catch {
    throw new Error('无法解析 Skill ZIP');
  }
  if (entries.length === 0) throw new Error('Skill ZIP 中没有文件');
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Skill ZIP 最多允许 ${MAX_ARCHIVE_ENTRIES} 个条目`);

  const descriptors = entries.map((entry) => ({
    entry,
    path: normalizePackagePath(entry.entryName),
  }));
  let prefix = '';
  if (!descriptors.some((item) => item.path.toLowerCase() === 'skill.md')) {
    const roots = new Set(descriptors.map((item) => item.path.split('/')[0]));
    if (roots.size === 1) {
      const root = [...roots][0];
      if (descriptors.some((item) => item.path.toLowerCase() === `${root.toLowerCase()}/skill.md`)) {
        prefix = `${root}/`;
      }
    }
  }

  const included = descriptors
    .map((item) => ({ ...item, path: prefix ? item.path.slice(prefix.length) : item.path }))
    .filter((item) => !isIgnoredRepositoryMetadata(item.path));
  if (included.length > MAX_FILES) throw new Error(`Skill 包最多允许 ${MAX_FILES} 个文件`);

  let totalBytes = 0;
  const files = included.map(({ entry, path: relativePath }) => {
    const declaredSize = Number(entry.header?.size || 0);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) throw new Error(`Skill ZIP 文件大小无效：${relativePath}`);
    if (declaredSize > MAX_FILE_BYTES) throw new Error(`Skill 文件超过 128KB：${relativePath}`);
    totalBytes += declaredSize;
    if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('Skill 包总大小不能超过 512KB');
    let content;
    try {
      content = entry.getData();
    } catch {
      throw new Error(`无法读取 Skill ZIP 文件：${relativePath}`);
    }
    if (content.length !== declaredSize) throw new Error(`Skill ZIP 文件大小不一致：${relativePath}`);
    return { path: relativePath, content };
  });

  const safeName = path.basename(String(sourceName || 'skill.zip')).slice(0, 120) || 'skill.zip';
  return validateSpaceSkillPackage({
    sourceUrl: `upload://local/${encodeURIComponent(safeName)}`,
    files,
  });
}

function skillRoot(projectRoot, userId, spaceId) {
  const safeUserId = safeScopeId(userId, '用户 ID');
  const safeSpaceId = safeScopeId(spaceId, '空间 ID');
  return path.resolve(projectRoot, 'data', 'spaces', safeUserId, safeSpaceId, '.space', 'skills');
}

function skillDirectory(root, skillId) {
  const idPart = String(skillId || '').replace(/^space:/, '');
  if (!SAFE_ID.test(idPart)) throw new Error('Skill ID 格式不安全');
  const target = path.resolve(root, idPart);
  if (!target.startsWith(root + path.sep)) throw new Error('Skill 路径超出当前空间');
  return target;
}

async function fetchWithLimit(url, asJson = false) {
  const response = await fetch(url, {
    headers: { Accept: asJson ? 'application/vnd.github+json' : '*/*', 'User-Agent': 'AlmarenChat-Space-Skills' },
    signal: AbortSignal.timeout(12_000),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`读取 Skill 来源失败：HTTP ${response.status}`);
  if (asJson) return response.json();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Skill 来源文件超过 128KB');
  return bytes;
}

function githubSource(sourceUrl) {
  const url = new URL(sourceUrl);
  if (url.protocol !== 'https:') throw new Error('Skill 来源必须使用 HTTPS');
  if (url.hostname === 'raw.githubusercontent.com') {
    if (!url.pathname.toLowerCase().endsWith('/skill.md')) throw new Error('直链必须指向 SKILL.md');
    return { kind: 'raw', url: url.toString() };
  }
  if (url.hostname !== 'github.com') throw new Error('第一阶段只允许 GitHub Skill 来源');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('GitHub Skill 地址无效');
  const [owner, repoRaw] = parts;
  const repo = repoRaw.replace(/\.git$/i, '');
  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) throw new Error('GitHub 仓库地址无效');
  if (parts[2] === 'blob' && parts.length >= 6) {
    const ref = parts[3];
    const filePath = parts.slice(4).join('/');
    if (!filePath.toLowerCase().endsWith('skill.md')) throw new Error('GitHub 文件地址必须指向 SKILL.md');
    return { kind: 'raw', url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}` };
  }
  if (parts[2] === 'tree' && parts.length >= 4) {
    return { kind: 'directory', owner, repo, ref: parts[3], directory: parts.slice(4).join('/') };
  }
  return { kind: 'directory', owner, repo, ref: null, directory: '' };
}

async function githubDirectoryFiles(source) {
  let ref = source.ref;
  if (!ref) {
    const repository = await fetchWithLimit(`https://api.github.com/repos/${source.owner}/${source.repo}`, true);
    ref = repository.default_branch;
  }
  if (!ref) throw new Error('无法确定 GitHub 仓库默认分支');
  const files = [];
  const visit = async (directory, depth) => {
    if (depth > 4) throw new Error('Skill 目录层级不能超过 4 层');
    const encodedPath = directory.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const endpoint = `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
    const entries = await fetchWithLimit(endpoint, true);
    if (!Array.isArray(entries)) throw new Error('Skill 地址必须指向一个目录');
    for (const entry of entries) {
      if (entry.type === 'dir') {
        await visit(entry.path, depth + 1);
      } else if (entry.type === 'file' && entry.download_url) {
        const prefix = source.directory ? `${source.directory.replace(/\/$/, '')}/` : '';
        const relativePath = entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.name;
        if (isIgnoredRepositoryMetadata(relativePath)) continue;
        if (files.length >= MAX_FILES) throw new Error(`Skill 包最多允许 ${MAX_FILES} 个文件`);
        files.push({ path: relativePath, content: await fetchWithLimit(entry.download_url) });
      }
    }
  };
  await visit(source.directory, 0);
  return files;
}

export async function fetchSpaceSkillPackage(sourceUrl) {
  const normalizedUrl = new URL(String(sourceUrl || '').trim()).toString();
  const source = githubSource(normalizedUrl);
  const files = source.kind === 'raw'
    ? [{ path: 'SKILL.md', content: await fetchWithLimit(source.url) }]
    : await githubDirectoryFiles(source);
  return validateSpaceSkillPackage({ sourceUrl: normalizedUrl, files });
}

async function appendAudit(root, entry) {
  await appendFile(path.join(root, '.audit.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function renameSpaceSkillDirectory(source, target, {
  renamePath = rename,
  wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await renamePath(source, target);
      return;
    } catch (error) {
      if (!WINDOWS_RENAME_RETRY_CODES.has(error?.code) || attempt === 5) throw error;
      try {
        await lstat(target);
        throw new Error('该 Skill 已安装，请先删除后再安装新版本');
      } catch (targetError) {
        if (targetError?.code !== 'ENOENT') throw targetError;
      }
      await wait(attempt * 50);
    }
  }
}

async function writeSpaceSkillDirectory(directory, packageData) {
  for (const file of packageData.files) {
    const targetFile = path.join(directory, normalizePackagePath(file.path));
    await mkdir(path.dirname(targetFile), { recursive: true });
    await writeFile(targetFile, file.content, { flag: 'wx' });
  }
  await writeFile(path.join(directory, '.space-skill.json'), JSON.stringify(packageData.manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
}

async function installSpaceSkillDirectoryDirectly(target, packageData) {
  try {
    await mkdir(target);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('该 Skill 已安装或正在安装');
    throw error;
  }
  try {
    await writeSpaceSkillDirectory(target, packageData);
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

export async function installSpaceSkillPackage({
  projectRoot, userId, spaceId, packageData, renameDirectory = renameSpaceSkillDirectory,
}) {
  const root = skillRoot(projectRoot, userId, spaceId);
  await mkdir(root, { recursive: true });
  const target = skillDirectory(root, packageData.manifest.id);
  try {
    await lstat(target);
    throw new Error('该 Skill 已安装，请先删除后再安装新版本');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporary = path.join(root, `.install-${randomUUID()}`);
  await mkdir(temporary);
  try {
    await writeSpaceSkillDirectory(temporary, packageData);
    try {
      await renameDirectory(temporary, target);
    } catch (error) {
      if (!WINDOWS_RENAME_RETRY_CODES.has(error?.code)) throw error;
      await installSpaceSkillDirectoryDirectly(target, packageData);
      await rm(temporary, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  await appendAudit(root, {
    action: 'install', skillId: packageData.manifest.id, digest: packageData.manifest.digest,
    sourceUrl: packageData.manifest.sourceUrl, actor: userId, at: packageData.manifest.installedAt,
  });
  return publicSkill(packageData.manifest);
}

async function readInstalled(root, entryName) {
  if (!SAFE_ID.test(entryName)) return null;
  const directory = skillDirectory(root, entryName);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Skill 目录无效');
  let manifestSource;
  try {
    manifestSource = await readFile(path.join(directory, '.space-skill.json'), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const manifest = JSON.parse(manifestSource);
  const skillMarkdown = await readFile(path.join(directory, 'SKILL.md'), 'utf8');
  const { body } = parseSkillMarkdown(skillMarkdown);
  return { manifest, instructions: body, directory };
}

export async function listSpaceSkills({ projectRoot, userId, spaceId }) {
  const root = skillRoot(projectRoot, userId, spaceId);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const installed = await readInstalled(root, entry.name);
    if (installed) skills.push(publicSkill(installed.manifest));
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export async function getSpaceSkill({ projectRoot, userId, spaceId, skillId }) {
  const root = skillRoot(projectRoot, userId, spaceId);
  const installed = await readInstalled(root, String(skillId || '').replace(/^space:/, ''));
  if (!installed || installed.manifest.enabled === false) return null;
  const approvedScripts = approvedSkillScripts(installed.manifest);
  const execution = approvedScripts.length > 0 ? {
    kind: 'space-python-readonly',
    entrypoint: 'analyze',
    scripts: approvedScripts,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['script', 'paths'],
      properties: {
        script: { type: 'string', enum: approvedScripts, description: '管理员已批准的 Python 分析脚本。' },
        paths: {
          type: 'array',
          items: { type: 'string', description: '当前任务工作区内的文本文件相对路径。' },
          minItems: 1,
          maxItems: 10,
        },
      },
    },
  } : null;
  return {
    id: installed.manifest.id,
    name: installed.manifest.name,
    version: installed.manifest.version,
    description: installed.manifest.description,
    requiredCapabilities: execution ? ['workspace_read', 'code_execute'] : [],
    allowedTools: execution ? [...FIXED_ALLOWED_TOOLS, 'run_skill'] : [...FIXED_ALLOWED_TOOLS],
    artifactExtensions: [],
    requiredArtifactExtensions: [],
    packagePath: null,
    execution,
    instructions: installed.instructions,
    sourceUrl: installed.manifest.sourceUrl,
    digest: installed.manifest.digest,
    referenceFiles: installed.manifest.files.filter((file) => file.toLowerCase() !== 'skill.md'),
  };
}

export async function updateSpaceSkillExecution({ projectRoot, userId, spaceId, skillId, approvedScripts }) {
  const root = skillRoot(projectRoot, userId, spaceId);
  const installed = await readInstalled(root, String(skillId || '').replace(/^space:/, ''));
  if (!installed) throw new Error('Space Skill 不存在');
  const scripts = executableSkillScripts(installed.manifest);
  const requested = [...new Set(Array.isArray(approvedScripts) ? approvedScripts.map(String) : [])];
  if (requested.length > 20) throw new Error('单个 Skill 最多批准 20 个脚本入口');
  const unavailable = requested.filter((file) => !scripts.includes(file));
  if (unavailable.length > 0) throw new Error(`只能批准当前 Skill 包内的 Python 脚本：${unavailable.join('、')}`);
  installed.manifest.approvedScripts = requested;
  await writeFile(
    path.join(installed.directory, '.space-skill.json'),
    JSON.stringify(installed.manifest, null, 2),
    'utf8'
  );
  await appendAudit(root, {
    action: 'execution_update',
    skillId: installed.manifest.id,
    approvedScripts: requested,
    actor: userId,
    at: new Date().toISOString(),
  });
  return publicSkill(installed.manifest);
}

export async function resolveSpaceSkillExecution({ projectRoot, userId, spaceId, skillId, digest, script }) {
  const root = skillRoot(projectRoot, userId, spaceId);
  const installed = await readInstalled(root, String(skillId || '').replace(/^space:/, ''));
  if (!installed || installed.manifest.enabled === false) throw new Error('Space Skill 不存在或已停用');
  if (!digest || installed.manifest.digest !== digest) throw new Error('Space Skill 版本已经变化');
  const requested = normalizePackagePath(script);
  if (!approvedSkillScripts(installed.manifest).includes(requested)) throw new Error('Space Skill 脚本尚未获得管理员批准');
  const actualRoot = await realpath(installed.directory);
  const actualScript = await realpath(path.join(installed.directory, requested));
  if (!actualScript.startsWith(actualRoot + path.sep)) throw new Error('Space Skill 脚本路径不安全');
  const info = await lstat(actualScript);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Space Skill 脚本无效');
  return { skillRoot: actualRoot, script: requested };
}

export async function readSpaceSkillFile({ projectRoot, userId, spaceId, skillId, digest, relativePath, offset = 0, limit = 12_000 }) {
  const root = skillRoot(projectRoot, userId, spaceId);
  const installed = await readInstalled(root, String(skillId || '').replace(/^space:/, ''));
  if (!installed || installed.manifest.enabled === false) throw new Error('空间 Skill 不存在或已停用');
  if (!digest || installed.manifest.digest !== digest) throw new Error('空间 Skill 版本已经变化');
  const requested = normalizePackagePath(relativePath);
  if (requested.toLowerCase() === 'skill.md' || !installed.manifest.files.includes(requested)) {
    throw new Error('只能读取当前 Skill 声明的参考文件');
  }
  const target = path.resolve(installed.directory, requested);
  const actualRoot = await realpath(installed.directory);
  const actualTarget = await realpath(target);
  if (!actualTarget.startsWith(actualRoot + path.sep)) throw new Error('Skill 参考文件路径不安全');
  const info = await lstat(actualTarget);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Skill 参考文件无效');
  const content = await readFile(actualTarget, 'utf8');
  const start = Math.min(Math.max(0, Number.parseInt(offset, 10) || 0), content.length);
  const pageSize = Math.min(Math.max(1, Number.parseInt(limit, 10) || 12_000), 24_000);
  const page = content.slice(start, start + pageSize);
  return {
    path: requested,
    content: page,
    offset: start,
    nextOffset: start + page.length,
    totalChars: content.length,
    hasMore: start + page.length < content.length,
  };
}

export async function removeSpaceSkill({ projectRoot, userId, spaceId, skillId }) {
  const root = skillRoot(projectRoot, userId, spaceId);
  const target = skillDirectory(root, skillId);
  const installed = await readInstalled(root, String(skillId || '').replace(/^space:/, ''));
  if (!installed) return false;
  await rm(target, { recursive: true, force: false });
  await appendAudit(root, { action: 'remove', skillId: installed.manifest.id, actor: userId, at: new Date().toISOString() });
  return true;
}
