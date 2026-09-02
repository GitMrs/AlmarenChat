import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { builtinSkill } from '../../lib/agent-runtime/skill-registry.mjs';
import { resolveSpaceSkillExecution } from '../../lib/space-skills.mjs';
import { workspaceAttemptFile, workspaceAttemptRoot } from '../../lib/workspace-staging.mjs';
import { runSandboxedSkillProcess } from './sandbox-runner.mjs';

function manifestPath(projectRoot, packagePath) {
  const skillsRoot = path.resolve(projectRoot, 'skills', 'builtin');
  const packageRoot = path.resolve(skillsRoot, String(packagePath || ''));
  if (!packageRoot.startsWith(`${skillsRoot}${path.sep}`)) throw new Error('Skill 包路径超出内置 Skill 目录');
  return { packageRoot, manifestFile: path.join(packageRoot, 'manifest.json') };
}

function workspaceArgument(workspaceOptions, value, contract, label) {
  const normalized = String(value || '').trim().replaceAll('\\', '/');
  const file = workspaceAttemptFile(workspaceOptions, normalized);
  const extension = path.extname(file.target).toLowerCase();
  const extensions = Array.isArray(contract?.extensions) ? contract.extensions.map((item) => String(item).toLowerCase()) : [];
  if (extensions.length > 0 && !extensions.includes(extension)) {
    throw new Error(`${label}只允许 ${extensions.join(' / ')} 文件`);
  }
  return { logical: normalized, target: file.target };
}

function renderArguments(template, values) {
  return template.map((value) => String(value).replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Skill 入口缺少参数：${key}`);
    return values[key];
  }));
}

export async function executeBuiltinSkill({ projectRoot, skillId, entrypoint, args, workspaceOptions, isCancelled }) {
  const registered = builtinSkill(skillId);
  if (!registered?.packagePath || !registered?.execution) throw new Error('当前 Skill 没有可执行入口');
  const { packageRoot, manifestFile } = manifestPath(projectRoot, registered.packagePath);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.id !== registered.id || manifest.version !== registered.version) {
    throw new Error('Skill 清单与注册版本不一致');
  }
  const entrypointName = String(entrypoint || '');
  if (entrypointName !== registered.execution.entrypoint) throw new Error('Skill 入口未注册');
  const selected = manifest.entrypoints?.[entrypointName];
  if (!selected?.script || !Array.isArray(selected.arguments)) throw new Error('Skill 入口清单无效');

  const rawArgs = args && typeof args === 'object' ? args : {};
  const allowedKeys = new Set([
    ...Object.keys(manifest.inputs || {}),
    ...Object.keys(manifest.outputs || {}),
  ]);
  const unknownKeys = Object.keys(rawArgs).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) throw new Error(`Skill 参数未声明：${unknownKeys.join('、')}`);

  const values = {};
  const outputPaths = [];
  for (const [key, contract] of Object.entries(manifest.inputs || {})) {
    if (contract?.required && !rawArgs[key]) throw new Error(`Skill 缺少输入：${key}`);
    if (!rawArgs[key]) continue;
    const input = workspaceArgument(workspaceOptions, rawArgs[key], contract, `输入 ${key}`);
    const info = await stat(input.target).catch(() => null);
    if (!info?.isFile()) throw new Error(`Skill 输入文件不存在：${input.logical}`);
    values[key] = input.logical;
  }
  for (const [key, contract] of Object.entries(manifest.outputs || {})) {
    if (contract?.required && !rawArgs[key]) throw new Error(`Skill 缺少输出：${key}`);
    if (!rawArgs[key]) continue;
    const output = workspaceArgument(workspaceOptions, rawArgs[key], contract, `输出 ${key}`);
    values[key] = output.logical;
    outputPaths.push(output.logical);
  }

  const result = await runSandboxedSkillProcess({
    workspaceRoot: workspaceAttemptRoot(workspaceOptions),
    skillRoot: packageRoot,
    command: manifest.runtime?.command,
    script: selected.script,
    args: renderArguments(selected.arguments, values),
    network: manifest.runtime?.network !== 'forbidden',
    timeoutMs: manifest.runtime?.timeoutMs,
    maxOutputBytes: manifest.runtime?.maxOutputBytes,
    isCancelled,
  });
  if (!result.ok) return { ...result, entrypoint: entrypointName, paths: [] };

  for (const relativePath of outputPaths) {
    const output = workspaceAttemptFile(workspaceOptions, relativePath);
    const info = await stat(output.target).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      return { ...result, ok: false, entrypoint: entrypointName, paths: [], error: `Skill 没有生成有效产物：${relativePath}` };
    }
  }
  return { ...result, entrypoint: entrypointName, paths: outputPaths };
}

async function executeSpaceSkill({ projectRoot, skill, args, workspaceOptions, isCancelled }) {
  const rawArgs = args && typeof args === 'object' ? args : {};
  const unknownKeys = Object.keys(rawArgs).filter((key) => !['script', 'paths'].includes(key));
  if (unknownKeys.length > 0) throw new Error(`Skill 参数未声明：${unknownKeys.join('、')}`);
  const script = String(rawArgs.script || '');
  const paths = [...new Set(Array.isArray(rawArgs.paths) ? rawArgs.paths.map(String) : [])];
  if (!script || paths.length === 0) throw new Error('Space Skill 缺少脚本或输入文件');
  if (paths.length > 10) throw new Error('Space Skill 单次最多读取 10 个输入文件');
  const inputs = [];
  for (const value of paths) {
    const input = workspaceArgument(workspaceOptions, value, { extensions: ['.md', '.txt', '.json'] }, '输入');
    const info = await stat(input.target).catch(() => null);
    if (!info?.isFile()) throw new Error(`Skill 输入文件不存在：${input.logical}`);
    inputs.push(input.logical);
  }
  const resolved = await resolveSpaceSkillExecution({
    projectRoot,
    userId: workspaceOptions.userId,
    spaceId: workspaceOptions.spaceId,
    skillId: skill.id,
    digest: skill.digest,
    script,
  });
  const result = await runSandboxedSkillProcess({
    workspaceRoot: workspaceAttemptRoot(workspaceOptions),
    skillRoot: resolved.skillRoot,
    command: 'python3',
    script: resolved.script,
    args: inputs,
    network: false,
    workspaceAccess: 'read',
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    isCancelled,
  });
  return { ...result, entrypoint: 'analyze', script: resolved.script, paths: [] };
}

export async function executeSkill(options) {
  if (String(options.skill?.id || '').startsWith('space:')) return executeSpaceSkill(options);
  return executeBuiltinSkill({
    ...options,
    skillId: options.skill?.id,
    entrypoint: options.skill?.execution?.entrypoint,
  });
}
