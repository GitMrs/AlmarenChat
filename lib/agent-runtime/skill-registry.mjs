import { needsWorkspaceWrite } from '../workspace-write-intent.mjs';

const ALL_READ_TOOLS = ['list_files', 'read_file', 'check_files'];

export const GENERAL_TASK_SKILL_ID = 'general-task';

export const BUILTIN_SKILLS = Object.freeze([
  Object.freeze({
    id: 'professional-analysis',
    name: '专业分析与结构化建议',
    version: '1.0.0',
    description: '针对明确对象完成有格式、数量或验收标准的专业分析，不创建文件。',
    requiredCapabilities: ['workspace_read'],
    allowedTools: ALL_READ_TOOLS,
    artifactExtensions: [],
    instructions: [
      '只负责当前分析步骤，不创建或修改文件。',
      '先提炼分析对象、约束和判断标准，再按用户要求的数量与格式输出。',
      '每项结论都要给出可核对的依据；信息不足时明确说明限制，不用空泛建议填充数量。',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'document-writer',
    name: 'Markdown 文档编写',
    version: '1.0.0',
    description: '读取现有资料并创建或修改可交付的 Markdown 文档。',
    requiredCapabilities: ['workspace_read', 'workspace_write'],
    allowedTools: [...ALL_READ_TOOLS, 'write_file', 'patch_file'],
    artifactExtensions: ['.md'],
    instructions: [
      '先读取相关现有文档，存在目标文件时优先精确修改，不重复新建同类文档。',
      '文档必须结构清晰、内容完整，并直接写入任务要求的 Markdown 文件。',
      '提交前使用 check_files 检查实际产物，并说明文件路径和覆盖的验收要求。',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'responsive-page-builder',
    name: '响应式页面制作',
    version: '1.0.0',
    description: '创建或修改可直接预览的响应式 HTML 页面并完成静态检查。',
    requiredCapabilities: ['workspace_read', 'workspace_write'],
    allowedTools: [...ALL_READ_TOOLS, 'write_file', 'patch_file', 'run_check'],
    artifactExtensions: ['.html', '.htm', '.tsx', '.jsx', '.vue', '.svelte'],
    instructions: [
      '先核对现有页面和用户要求，存在目标页面时继续完善，不把工作区误判为空。',
      '页面应具备清晰的信息层级、完整交互状态和移动端适配，资源必须使用可访问的本地路径。',
      '提交前检查 HTML、脚本和本地资源引用，并说明页面入口、主要实现和验证结果。',
    ].join('\n'),
    agentPattern: /(?:professional-frontend|前端|front[ -]?end|网页|web|ui\s*实现)/i,
  }),
]);

const GENERAL_TASK_SKILL = Object.freeze({
  id: GENERAL_TASK_SKILL_ID,
  name: '通用任务执行',
  version: '1.0.0',
  description: '兼容未匹配专用技能的现有任务。',
  requiredCapabilities: [],
  allowedTools: [...ALL_READ_TOOLS, 'write_file', 'patch_file', 'run_check'],
  artifactExtensions: [],
  instructions: '遵循当前任务指令、验收标准和平台权限，完成后提交可核对的结果。',
});

const SKILLS_BY_ID = new Map([...BUILTIN_SKILLS, GENERAL_TASK_SKILL].map((skill) => [skill.id, skill]));
const ANALYSIS_PATTERN = /(?:分析|评估|审查|诊断|建议|方案|清单|规划|review|analy[sz]e|assess|audit|recommendation)/i;
const DOCUMENT_PATTERN = /(?:markdown|\.md\b|文档|报告|说明书|需求文档|设计文档|readme)/i;
const PAGE_PATTERN = /(?:html|网页|页面|网站|web\s?page|landing\s?page)/i;

function agentText(agent = {}) {
  return `${agent.id || ''}\n${agent.name || ''}\n${agent.category || ''}\n${agent.description || ''}`;
}

export function builtinSkill(skillId) {
  return SKILLS_BY_ID.get(String(skillId || '')) || null;
}

export function skillSupportsAgent(skill, agent) {
  return !skill?.agentPattern || skill.agentPattern.test(agentText(agent));
}

export function skillsForAgent(agent) {
  return BUILTIN_SKILLS
    .filter((skill) => skillSupportsAgent(skill, agent))
    .map((skill) => ({ id: skill.id, name: skill.name, description: skill.description }));
}

function inferredSkillId(text, agent, capabilities) {
  const canWrite = capabilities.includes('workspace_write');
  const writeIntent = needsWorkspaceWrite(text);
  if (canWrite && writeIntent && PAGE_PATTERN.test(text)) {
    const pageSkill = builtinSkill('responsive-page-builder');
    if (skillSupportsAgent(pageSkill, agent)) return pageSkill.id;
  }
  if (canWrite && writeIntent && DOCUMENT_PATTERN.test(text)) return 'document-writer';
  if (!writeIntent && ANALYSIS_PATTERN.test(text)) return 'professional-analysis';
  return GENERAL_TASK_SKILL_ID;
}

export function resolveTaskSkill({ requestedSkillId, agent, text, authorization } = {}) {
  const capabilities = Array.isArray(authorization?.capabilities) ? authorization.capabilities : [];
  const enforceAuthorization = Array.isArray(authorization?.capabilities);
  const inferredId = inferredSkillId(String(text || ''), agent, capabilities);
  const normalizedRequestedId = String(requestedSkillId || '').trim();
  const selectedId = !normalizedRequestedId || normalizedRequestedId === GENERAL_TASK_SKILL_ID
    ? inferredId
    : normalizedRequestedId;
  const skill = builtinSkill(selectedId);
  if (!skill) throw new Error(`任务使用了未知 Skill：${selectedId}`);
  if (!skillSupportsAgent(skill, agent)) throw new Error(`${agent?.name || '所选成员'}不适用 Skill：${skill.name}`);
  const missing = enforceAuthorization
    ? skill.requiredCapabilities.filter((capability) => !capabilities.includes(capability))
    : [];
  if (missing.length > 0) throw new Error(`Skill“${skill.name}”需要未授权能力：${missing.join('、')}`);
  if (skill.id === 'professional-analysis' && needsWorkspaceWrite(text)) {
    throw new Error('专业分析 Skill 不能承担创建或修改文件的任务');
  }
  if (skill.id === 'document-writer' && (!DOCUMENT_PATTERN.test(text) || !needsWorkspaceWrite(text))) {
    throw new Error('Markdown 文档编写 Skill 只能用于明确的文档产物');
  }
  if (skill.id === 'responsive-page-builder' && (!PAGE_PATTERN.test(text) || !needsWorkspaceWrite(text))) {
    throw new Error('响应式页面制作 Skill 只能用于明确的 HTML 或网页产物');
  }
  return skillSnapshot(skill);
}

export function skillSnapshot(skill) {
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    requiredCapabilities: [...skill.requiredCapabilities],
    allowedTools: [...skill.allowedTools],
    artifactExtensions: [...skill.artifactExtensions],
    instructions: skill.instructions,
  };
}

export function taskSkill(task = {}) {
  const raw = task.skillSnapshot;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Legacy malformed snapshots fall back to the registered version.
    }
  }
  return skillSnapshot(builtinSkill(task.skillId) || GENERAL_TASK_SKILL);
}

export function skillAllowsTool(skill, toolName) {
  return Array.isArray(skill?.allowedTools) && skill.allowedTools.includes(toolName);
}

export function validateSkillArtifacts(skill, entries = []) {
  const extensions = Array.isArray(skill?.artifactExtensions) ? skill.artifactExtensions : [];
  if (extensions.length === 0) return { valid: true, issues: [] };
  const changedPaths = entries
    .filter((entry) => ['CREATED', 'MODIFIED'].includes(entry?.change))
    .map((entry) => String(entry.path || '').toLowerCase());
  const valid = changedPaths.some((filePath) => extensions.some((extension) => filePath.endsWith(extension)));
  return {
    valid,
    issues: valid ? [] : [`Skill“${skill.name}”要求生成或修改 ${extensions.join(' / ')} 产物`],
  };
}
