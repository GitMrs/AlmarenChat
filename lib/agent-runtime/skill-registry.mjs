import { needsWorkspaceWrite } from '../workspace-write-intent.mjs';

const ALL_READ_TOOLS = ['list_files', 'read_file', 'check_files'];

export const GENERAL_TASK_SKILL_ID = 'general-task';

export const BUILTIN_SKILLS = Object.freeze([
  Object.freeze({
    id: 'image-generator',
    name: '图片生成',
    version: '1.1.0',
    description: '使用账号已配置的图片模型生成工作区图片产物。',
    requiredCapabilities: ['workspace_read', 'workspace_write', 'image_generate'],
    allowedTools: [...ALL_READ_TOOLS, 'generate_images'],
    artifactExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
    instructions: [
      '先读取与当前步骤直接相关的来源内容，一次形成完整配图清单，不要把提示词规划拆成独立任务。',
      '每个任务只能生成 1 张图片；调用一次 generate_images，并说明图片用途、提示词、尺寸和简短英文文件名。需要多张时必须拆成分别由用户确认的任务。',
      '图片会保存到 assets 目录。生成后立即提交文件路径、用途和实际尺寸，不得在回复中输出 Base64。',
    ].join('\n'),
  }),
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
    version: '1.0.1',
    description: '读取现有资料并创建或修改可交付的 Markdown 文档。',
    requiredCapabilities: ['workspace_read', 'workspace_write'],
    allowedTools: [...ALL_READ_TOOLS, 'write_file', 'patch_file', 'patch_files'],
    artifactExtensions: ['.md'],
    instructions: [
      '先读取相关现有文档，存在目标文件时优先精确修改，不重复新建同类文档。',
      '文档必须结构清晰、内容完整，并直接写入任务要求的 Markdown 文件。',
      '完成必要写入后直接提交，并说明文件路径和覆盖的验收要求；平台会自动检查实际产物。',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'csv-business-analysis',
    name: 'CSV 业务数据分析',
    version: '1.0.0',
    description: '在隔离环境中运行固定 Python 入口，分析销售 CSV 并生成 Markdown 与 HTML 报告。',
    requiredCapabilities: ['workspace_read', 'workspace_write', 'code_execute'],
    allowedTools: [...ALL_READ_TOOLS, 'run_skill'],
    artifactExtensions: ['.md', '.html'],
    requiredArtifactExtensions: ['.md', '.html'],
    packagePath: 'csv-business-analysis',
    execution: {
      entrypoint: 'analyze',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'markdownOutput', 'htmlOutput'],
        properties: {
          input: { type: 'string', description: '工作区内待分析的 CSV 相对路径。' },
          markdownOutput: { type: 'string', description: '工作区内 Markdown 报告输出路径，必须以 .md 结尾。' },
          htmlOutput: { type: 'string', description: '工作区内静态 HTML 报告输出路径，必须以 .html 结尾。' },
        },
      },
    },
    instructions: [
      '确认工作区中存在包含 date、product、amount 列的销售 CSV。',
      '调用 run_skill 的 analyze 入口完成统计，不要自行编写或修改执行脚本。',
      '本 Skill 禁止联网，必须同时生成 Markdown 和静态 HTML 报告。',
      '提交前核对总销售额、产品汇总、月度变化和异常记录均已生成。',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'responsive-page-builder',
    name: '响应式页面制作',
    version: '1.0.0',
    description: '创建或修改可直接预览的响应式 HTML 页面并完成静态检查。',
    requiredCapabilities: ['workspace_read', 'workspace_write'],
    allowedTools: [...ALL_READ_TOOLS, 'write_file', 'patch_file', 'patch_files', 'run_check', 'generate_images'],
    artifactExtensions: ['.html', '.htm', '.tsx', '.jsx', '.vue', '.svelte'],
    instructions: [
      '先核对现有页面和用户要求，存在目标页面时继续完善，不把工作区误判为空。',
      '页面应具备清晰的信息层级、完整交互状态和移动端适配，资源必须使用可访问的本地路径。',
      '提交前检查 HTML、脚本和本地资源引用，并说明页面入口、主要实现和验证结果。',
    ].join('\n'),
    agentPattern: /(?:professional-frontend|前端|front[ -]?end|网页|web|ui\s*实现)/i,
  }),
  Object.freeze({
    id: 'gzh-creator-suite',
    name: '公众号爆款创作套件',
    version: '1.1.0',
    description: '集成公众号定位诊断、深度长文 6 种写法、≤1000 字短文、10 万+ 爆款标题公式（16 种方法与 Top 5 角色化推荐）、10 类图表/6 类逻辑图及 2.35:1 安全区封面配图。',
    requiredCapabilities: ['workspace_read', 'workspace_write'],
    allowedTools: [...ALL_READ_TOOLS, 'write_file', 'patch_file', 'patch_files', 'generate_images', 'run_skill'],
    artifactExtensions: ['.md', '.png', '.jpg', '.jpeg', '.webp', '.html'],
    packagePath: 'creator-buddy-main',
    instructions: [
      '遵循公众号规范交付：正文必须写入 article.md（首行为 # 唯一正式标题），严禁混入备选标题、摘要或说明。',
      '文章首句必须包含具体时间或动作锚点，严禁“随着...发展”；单段严禁超 90 字（约 4 行）；核心论断独立成段；长文落实反面边界，短文 ≤1000 字且不用说教口吻；彻底扫除 AI 腔。',
      '备选爆款标题库必须覆盖多种方法，按综合首选、稳健版、破圈版、搜索版、实验版等 5 种角色推荐，连同 120 字内摘要落入 publish-info.md。',
      '定位策划与储备选题池统一沉淀到空间共享文件 shared/content-strategy.md；后续每个新成果都先读取它，不得在 Work 内另建同名副本。',
      '生成封面图使用 cover 作为主文件名；实际扩展名以图片模型返回格式为准（如 cover.png、cover.jpg），不得因格式差异重复生成。确保 2.35:1 比例（推荐 1175x500）且核心文字与主体严格收敛在正中央 42.6% 方形安全区内防朋友圈裁切。',
    ].join('\n'),
    agentPattern: /(?:gl-zmtyy|writing-assistant|top-copywriting-master|research-assistant|自媒体|文案|写作|公众号)/i,
  }),
]);

const GENERAL_TASK_SKILL = Object.freeze({
  id: GENERAL_TASK_SKILL_ID,
  name: '通用任务执行',
  version: '1.0.0',
  description: '兼容未匹配专用技能的现有任务。',
  requiredCapabilities: [],
  allowedTools: [...ALL_READ_TOOLS, 'write_file', 'patch_file', 'patch_files', 'run_check'],
  artifactExtensions: [],
  instructions: '遵循当前任务指令、验收标准和平台权限，完成后提交可核对的结果。',
});

const SKILLS_BY_ID = new Map([...BUILTIN_SKILLS, GENERAL_TASK_SKILL].map((skill) => [skill.id, skill]));
const ANALYSIS_PATTERN = /(?:分析|评估|审查|诊断|建议|方案|清单|规划|review|analy[sz]e|assess|audit|recommendation)/i;
const DOCUMENT_PATTERN = /(?:markdown|\.md\b|文档|报告|说明书|需求文档|设计文档|readme)/i;
const PAGE_PATTERN = /(?:html|网页|页面|网站|web\s?page|landing\s?page)/i;
const CSV_ANALYSIS_PATTERN = /(?:csv|逗号分隔).{0,40}(?:分析|统计|汇总|报告)|(?:分析|统计|汇总).{0,40}(?:csv|逗号分隔)/i;
const IMAGE_GENERATION_PATTERN = /(?:(?:生成|制作|创建|绘制|设计).{0,20}(?:图片|图像|插图|配图|海报|封面)|(?:图片|图像|插图|配图|海报|封面).{0,20}(?:生成|制作|创建|绘制|设计)|generate.{0,20}(?:image|illustration|poster|cover))/i;
const GZH_PATTERN = /(?:公众号|微信文章|微信公众号|推文|微信草稿|爆款文章|爆款标题|content-strategy|publish-info|专栏选题|头图封面|文章定位|定位三件套)/i;

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
  const canExecute = capabilities.includes('code_execute');
  const writeIntent = needsWorkspaceWrite(text);
  if (canWrite && capabilities.includes('image_generate') && IMAGE_GENERATION_PATTERN.test(text) && !PAGE_PATTERN.test(text)) {
    return 'image-generator';
  }
  if (canWrite && canExecute && CSV_ANALYSIS_PATTERN.test(text)) return 'csv-business-analysis';
  if (canWrite && writeIntent && PAGE_PATTERN.test(text)) {
    const pageSkill = builtinSkill('responsive-page-builder');
    if (skillSupportsAgent(pageSkill, agent)) return pageSkill.id;
  }
  if (canWrite && writeIntent && GZH_PATTERN.test(text)) {
    const gzhSkill = builtinSkill('gzh-creator-suite');
    if (skillSupportsAgent(gzhSkill, agent)) return gzhSkill.id;
  }
  if (canWrite && writeIntent && DOCUMENT_PATTERN.test(text)) return 'document-writer';
  if (!writeIntent && ANALYSIS_PATTERN.test(text)) return 'professional-analysis';
  return GENERAL_TASK_SKILL_ID;
}

/** @param {any} options */
export function resolveTaskSkill({ requestedSkillId, agent, text, authorization, additionalSkills = [] } = {}) {
  const capabilities = Array.isArray(authorization?.capabilities) ? authorization.capabilities : [];
  const enforceAuthorization = Array.isArray(authorization?.capabilities);
  const inferredId = inferredSkillId(String(text || ''), agent, capabilities);
  const normalizedRequestedId = String(requestedSkillId || '').trim();
  const selectedId = !normalizedRequestedId || normalizedRequestedId === GENERAL_TASK_SKILL_ID
    ? inferredId
    : normalizedRequestedId;
  const skill = builtinSkill(selectedId)
    || additionalSkills.find((candidate) => candidate?.id === selectedId)
    || null;
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
  if (skill.id === 'csv-business-analysis' && (!CSV_ANALYSIS_PATTERN.test(text) || !needsWorkspaceWrite(text))) {
    throw new Error('CSV 业务数据分析 Skill 只能用于明确要求生成报告的 CSV 分析任务');
  }
  if (skill.id === 'image-generator' && !IMAGE_GENERATION_PATTERN.test(text)) {
    throw new Error('图片生成 Skill 只能用于明确要求生成图片的任务');
  }
  if (skill.id === 'gzh-creator-suite' && !needsWorkspaceWrite(text)) {
    throw new Error('公众号爆款创作套件只能用于明确要求产出文章、策略或配图产物的任务');
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
    requiredArtifactExtensions: [...(skill.requiredArtifactExtensions || [])],
    packagePath: skill.packagePath || null,
    execution: skill.execution ? JSON.parse(JSON.stringify(skill.execution)) : null,
    instructions: skill.instructions,
    sourceUrl: skill.sourceUrl || null,
    digest: skill.digest || null,
    referenceFiles: [...(skill.referenceFiles || [])],
  };
}

export function spaceSkillReferenceToolSchema(skill) {
  const files = Array.isArray(skill?.referenceFiles) ? skill.referenceFiles : [];
  if (!String(skill?.id || '').startsWith('space:') || files.length === 0) return null;
  return {
    type: 'function',
    function: {
      name: 'read_skill_file',
      description: '读取当前明确选中的 Space Skill 包内参考文件。不能读取其他 Skill 或工作区文件。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string', enum: files },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 24000 },
        },
      },
    },
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

export function skillExecutionToolSchema(skill) {
  if (!skill?.execution?.entrypoint || !skill.execution.parameters) return null;
  return {
    type: 'function',
    function: {
      name: 'run_skill',
      description: `运行当前 Skill 已注册的 ${skill.execution.entrypoint} 入口。只能执行该固定入口，不能运行自定义命令。`,
      parameters: skill.execution.parameters,
    },
  };
}

export function validateSkillArtifacts(skill, entries = []) {
  const extensions = Array.isArray(skill?.artifactExtensions) ? skill.artifactExtensions : [];
  const requiredExtensions = Array.isArray(skill?.requiredArtifactExtensions) ? skill.requiredArtifactExtensions : [];
  if (extensions.length === 0) return { valid: true, issues: [] };
  const changedPaths = entries
    .filter((entry) => ['CREATED', 'MODIFIED'].includes(entry?.change))
    .map((entry) => String(entry.path || '').toLowerCase());
  const valid = requiredExtensions.length > 0
    ? requiredExtensions.every((extension) => changedPaths.some((filePath) => filePath.endsWith(extension)))
    : changedPaths.some((filePath) => extensions.some((extension) => filePath.endsWith(extension)));
  return {
    valid,
    issues: valid ? [] : [`Skill“${skill.name}”要求生成或修改 ${(requiredExtensions.length > 0 ? requiredExtensions : extensions).join(' / ')} 产物`],
  };
}
