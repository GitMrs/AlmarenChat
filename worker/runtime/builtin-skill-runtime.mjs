import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { builtinSkill } from '../../lib/agent-runtime/skill-registry.mjs';
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
