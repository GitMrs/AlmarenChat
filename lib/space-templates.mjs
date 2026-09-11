const VERSION = 2;

const DEFAULT_LIFECYCLE_STAGES = Object.freeze([
  Object.freeze({ id: 'brief', name: '需求确认' }),
  Object.freeze({ id: 'production', name: '制作中' }),
  Object.freeze({ id: 'review', name: '待定稿' }),
  Object.freeze({ id: 'ready', name: '已完成' }),
]);

const WORK_LABELS = Object.freeze({
  'wechat-article': '文章',
  'simple-webpage': '网页',
  'short-video-script': '脚本',
  'story-writing': '作品',
  'research-report': '报告',
  'project-proposal': '方案',
  'product-requirements': '需求文档',
  'course-training': '课程资料',
});

function template(config) {
  const lifecycleStages = config.lifecycleStages || DEFAULT_LIFECYCLE_STAGES;
  const defaultArtifacts = config.defaultArtifacts || config.deliverables.map((label, index) => ({
    id: `artifact-${index + 1}`,
    label,
    required: true,
  }));
  const completionCriteria = config.completionCriteria || config.qualityRules.map((label, index) => ({
    id: `criterion-${index + 1}`,
    label,
  }));
  return Object.freeze({
    version: VERSION,
    defaultExecutionMode: 'REVIEW_DISPATCH',
    workKind: config.id,
    workLabel: WORK_LABELS[config.id] || '成果',
    supportsMultipleWorks: true,
    ...config,
    recommendedAgentIds: Object.freeze([...config.recommendedAgentIds]),
    recommendedSkillIds: Object.freeze([...config.recommendedSkillIds]),
    workflow: Object.freeze([...config.workflow]),
    deliverables: Object.freeze([...config.deliverables]),
    starterPrompts: Object.freeze([...config.starterPrompts]),
    qualityRules: Object.freeze([...config.qualityRules]),
    lifecycleStages: Object.freeze(lifecycleStages.map((stage) => Object.freeze({ ...stage }))),
    defaultArtifacts: Object.freeze(defaultArtifacts.map((artifact) => Object.freeze({ ...artifact }))),
    completionCriteria: Object.freeze(completionCriteria.map((criterion) => Object.freeze({ ...criterion }))),
  });
}

export const SPACE_TEMPLATES = Object.freeze([
  template({
    id: 'wechat-article',
    version: 2,
    name: '公众号文章',
    icon: 'newspaper',
    description: '从定位策划与选题推进到深度长文、爆款标题与终稿发布。',
    defaultName: '公众号创作室',
    recommendedAgentIds: ['gl-zmtyy', 'research-assistant', 'writing-assistant', 'top-copywriting-master'],
    recommendedSkillIds: ['professional-analysis', 'document-writer', 'image-generator', 'gzh-creator-suite'],
    workflow: [
      '明确受众与一句话定位，沉淀专栏选题池到空间共享文件 shared/content-strategy.md',
      '选择明确选题，按大纲与字数配额撰写深度长文并质检',
      '提炼 5-10 个爆款备选标题与摘要，落入 publish-info.md',
      '生成 2.35:1 且中央 42.6% 防裁切的封面图片，逻辑产物名为 cover，实际文件统一落入 assets/cover.<模型返回扩展名>',
      '核查事实与排版，成果定稿并推送微信草稿箱审批',
    ],
    deliverables: [
      'shared/content-strategy.md：账号一句话定位、专栏矩阵与储备选题池（空间共享）',
      'article.md：只包含一个最终标题和可直接复制发布的正文',
      'publish-info.md：单独保存备选标题、摘要、封面建议与核验说明',
      'cover：2.35:1 比例且核心视觉位于中央 42.6% 安全区的封面图片，实际路径为 assets/cover.<模型返回扩展名>',
      '使用外部资料时在 publish-info.md 附来源清单',
    ],
    starterPrompts: [
      '帮我做一下公众号定位与栏目规划，生成空间共享的 shared/content-strategy.md',
      '按照 shared/content-strategy.md 的方向，写本周的新一期深度文章并生成封面',
      '围绕这个主题写一篇公众号深度长文，生成备选标题并准备封面',
    ],
    qualityRules: [
      '开头第一句必须包含具体时间或动作，严禁用“随着AI发展”等空泛铺垫',
      '正文默认一到两句一段，关键判断句独立成段，禁止连续 4 行以上的拥挤段落',
      '正文结构适合移动端连续阅读，article.md 不得混入备选标题、摘要、创作说明或任务总结',
      '未经核实的信息不得写成确定事实，避免“100%”“提升 10 倍”等绝对化表达',
      '封面图片必须确保正方形中央 42.6% 安全区内文字与主体完整不被微信裁切',
    ],
  }),
  template({
    id: 'simple-webpage',
    name: '网页制作',
    icon: 'webpage',
    description: '完成单页网站、活动页或轻量交互原型。',
    defaultName: '网页制作室',
    recommendedAgentIds: ['professional-product', 'professional-ux', 'metaphor-ux-writer', 'professional-frontend'],
    recommendedSkillIds: ['professional-analysis', 'responsive-page-builder', 'image-generator'],
    workflow: ['确认页面目标、受众和内容结构', '梳理文案、视觉方向与交互状态', '创建或修改可直接预览的页面文件', '检查移动端、交互和本地资源引用'],
    deliverables: ['可直接预览的 HTML 页面', '页面使用的本地图片资源', '实现与检查结果说明'],
    starterPrompts: ['为这个需求制作一个单页网站', '根据我上传的内容制作活动页面', '检查并优化空间里现有的 HTML 页面'],
    qualityRules: ['定位为单页或轻量原型，不扩展成大型软件项目', '页面必须兼顾桌面端和移动端', '交付必须是工作区中的真实文件而不是代码片段'],
  }),
  template({
    id: 'short-video-script',
    name: '短视频脚本',
    icon: 'video',
    description: '完成选题、开场钩子、口播或分镜与发布文案。',
    defaultName: '短视频脚本室',
    recommendedAgentIds: ['gl-zmtyy', 'tik-tok-director', 'top-copywriting-master'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: ['明确平台、受众和时长', '确定选题角度与前三秒钩子', '编写口播或分镜脚本', '检查节奏、可拍性和表达风险'],
    deliverables: ['完整口播或分镜脚本', '标题与发布文案', '必要时提供镜头和素材清单'],
    starterPrompts: ['为这个主题写一条 60 秒短视频脚本', '把这篇文章改编成短视频口播稿', '为我的账号策划一组系列选题'],
    qualityRules: ['脚本必须符合用户指定时长', '镜头、台词和动作应当可以实际执行', '避免只给创意方向而不交付完整脚本'],
  }),
  template({
    id: 'story-writing',
    name: '剧本与小说',
    icon: 'book',
    description: '共同维护设定、人物、情节结构和连续正文。',
    defaultName: '故事创作室',
    recommendedAgentIds: ['creator-simulator', 'human-writer-simulator', 'writing-assistant'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: ['确认题材、篇幅和叙事目标', '建立世界观、人物与核心冲突', '形成大纲或分场结构', '创作正文并检查人物和情节连续性'],
    deliverables: ['故事设定与人物小传', '章节或分场大纲', '剧本或小说正文'],
    starterPrompts: ['根据这个想法设计完整故事大纲', '继续创作下一章并保持人物一致', '审查这段剧情的节奏和逻辑问题'],
    qualityRules: ['新增设定不得无故违背已经确认的内容', '人物行为必须有可理解的动机', '正文应以可直接使用的内容为主，不用分析代替创作'],
  }),
  template({
    id: 'research-report',
    name: '调研报告',
    icon: 'search',
    description: '围绕明确问题整理证据、比较观点并形成结论。',
    defaultName: '调研报告室',
    recommendedAgentIds: ['research-assistant', 'web-search', 'professional-data-analysis', 'professional-technical-writing'],
    recommendedSkillIds: ['professional-analysis', 'document-writer', 'csv-business-analysis'],
    workflow: ['定义调研问题、范围和判断标准', '整理用户资料与已授权的外部资料', '比较证据、识别冲突和信息缺口', '形成结论、建议和来源清单'],
    deliverables: ['结构化调研报告', '关键结论与行动建议', '使用外部资料时附可核对来源'],
    starterPrompts: ['围绕这个问题做一份调研报告', '比较这几个方案并给出选择建议', '分析我上传的资料并提炼主要结论'],
    qualityRules: ['事实、推断和建议必须清楚区分', '时效性结论必须标注时间范围', '未授权联网时只能使用用户资料和已有空间内容'],
  }),
  template({
    id: 'project-proposal',
    name: '方案策划',
    icon: 'lightbulb',
    description: '从目标和约束出发，形成可执行方案与风险预案。',
    defaultName: '方案策划室',
    recommendedAgentIds: ['professional-product', 'professional-marketing', 'professional-data-analysis', 'professional-legal'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: ['明确目标、对象、约束和成功标准', '提出并比较候选方案', '细化执行步骤、资源和时间安排', '检查风险、边界并完成定稿'],
    deliverables: ['完整方案正文', '执行步骤与责任边界', '风险清单和验收指标'],
    starterPrompts: ['为这个目标制定一份完整执行方案', '评审我现有的方案并提出修改稿', '比较两种路线并给出推荐方案'],
    qualityRules: ['建议必须能够落实到具体行动', '明确写出关键假设和不确定性', '不使用口号代替资源、步骤与验收标准'],
  }),
  template({
    id: 'product-requirements',
    name: '产品需求文档',
    icon: 'clipboard',
    description: '梳理用户场景、功能边界、交互流程和验收标准。',
    defaultName: '产品需求室',
    recommendedAgentIds: ['professional-product', 'jtbd', 'professional-ux', 'professional-technical-writing'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: ['确认目标用户、问题与产品目标', '梳理范围、用户故事和关键流程', '定义功能需求、异常状态和约束', '补齐优先级、指标与验收标准'],
    deliverables: ['结构化 PRD', '用户流程和状态说明', '可验证的验收标准'],
    starterPrompts: ['根据这个产品想法编写一份 PRD', '审查我上传的需求文档是否完整', '把这些用户反馈整理成产品需求'],
    qualityRules: ['明确区分本期范围与非本期范围', '功能需求必须覆盖关键状态和失败路径', '验收标准应当具体且可验证'],
  }),
  template({
    id: 'course-training',
    name: '课程与培训资料',
    icon: 'graduation',
    description: '设计学习目标、课程结构、教案、练习与评估。',
    defaultName: '课程与培训资料室',
    recommendedAgentIds: ['professional-education', 'course-prep-teaching-guide-ai', 'ljrwwjl-development', 'writing-assistant'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: ['明确学习对象、基础和学习目标', '设计课程结构与时间分配', '编写教案、案例和练习', '检查难度梯度并补充评估标准'],
    deliverables: ['课程大纲', '可授课的教案或讲义', '练习题与评估标准'],
    starterPrompts: ['为这个主题设计一套培训课程', '把这些资料整理成一份可授课教案', '为现有课程补充练习和考核标准'],
    qualityRules: ['每个章节都应服务于明确学习目标', '案例和练习应与受众水平匹配', '资料需要能够被讲师或学习者直接使用'],
  }),
]);

const TEMPLATE_BY_ID = new Map(SPACE_TEMPLATES.map((item) => [item.id, item]));

export function getSpaceTemplate(templateId) {
  return TEMPLATE_BY_ID.get(String(templateId || '').trim()) || null;
}

export function spaceTemplateInstructions(item) {
  if (!item) return '';
  const lines = [
    `本空间采用“${item.name}”工作模板。`,
    'Coordinator 应根据当前目标选择必要步骤；简单任务直接交给一名合适成员，不得为了套用模板机械地启动完整流程。',
    '',
    '推荐工作流程：',
    ...item.workflow.map((step, index) => `${index + 1}. ${step}`),
    '',
    '默认交付物：',
    ...item.deliverables.map((value) => `- ${value}`),
    '',
    '质量要求：',
    ...item.qualityRules.map((value) => `- ${value}`),
  ];
  if (item.id === 'wechat-article') {
    lines.push(
      '',
      '专业创作套件指南（已集成 gzh-creator-suite 全量能力）：',
      '- 定位诊断：按“对象、供给、凭据”两轮访谈收敛一句话定位，严格校验微信后台硬限制（简介 4-120 汉字，关注后回复纯文字 ≤600 汉字，自定义菜单 3 主×5 子及字节折算），沉淀为空间共享文件 shared/content-strategy.md。',
      '- 深度长文（1500-4000 字）：根据创作者手牌诊断，采用 6 大长文模板（访谈式、大纲配额式、续写式、素材整合式、反常识破题式、定点重写式）展开；必须设置反面边界；首句必须带时间或动作锚点，严禁假大空；单段严禁超 90 字（约 4 行）；核心论断独立成段。',
      '- 短文快讯（≤1000 字）：纯文字无图排版，单段 ≤70 字；第一人称叙事且全篇“你”字 ≤1 次；坚决清除 AI 腔。',
      '- 爆款标题：基于 16 种爆款标题法与 1000 篇 10w+ 样本规律打分，交付 Top 5 角色化推荐（综合首选、稳健版、破圈版、搜索版、实验版）并落入 publish-info.md。',
      '- 视觉配图：支持 10 类商业图表提示词与 6 类逻辑关系图（自包含 SVG/HTML 矢量渲染）。',
      '- 封面设计：2.35:1 超宽画幅（1175x500），主标题与核心视觉必须 100% 收敛在正中央 42.6%（x 337-837）正方形安全区内，防止微信聊天与朋友圈分享时两翼被裁切。',
      '- 交付与发布：严格遵守 article.md（纯净正文，首行 # 唯一正式标题）、publish-info.md、assets/cover.<模型返回扩展名>。定稿后可直接生成 WECHAT_CREATE_DRAFT 动作推送微信公众号草稿箱！'
    );
  }
  lines.push('', '用户当次明确要求始终优先于模板默认项；不得自行扩大交付范围。');
  return lines.join('\n');
}

export function spaceTemplateSnapshot(item, configuredAgentIds = item?.recommendedAgentIds || []) {
  if (!item) return null;
  return {
    id: item.id,
    version: item.version,
    name: item.name,
    icon: item.icon,
    workKind: item.workKind,
    workLabel: item.workLabel,
    supportsMultipleWorks: item.supportsMultipleWorks,
    lifecycleStages: item.lifecycleStages.map((stage) => ({ ...stage })),
    defaultArtifacts: item.defaultArtifacts.map((artifact) => ({ ...artifact })),
    completionCriteria: item.completionCriteria.map((criterion) => ({ ...criterion })),
    workflow: [...item.workflow],
    deliverables: [...item.deliverables],
    qualityRules: [...item.qualityRules],
    recommendedSkillIds: [...item.recommendedSkillIds],
    configuredAgentIds: [...configuredAgentIds],
    starterPrompts: [...item.starterPrompts],
  };
}

export function templateLifecycleStage(snapshot, stageId) {
  const stages = Array.isArray(snapshot?.lifecycleStages) ? snapshot.lifecycleStages : DEFAULT_LIFECYCLE_STAGES;
  return stages.find((stage) => stage?.id === stageId) || null;
}

export function initialWorkStage(snapshot) {
  return templateLifecycleStage(snapshot, 'brief')?.id || null;
}

export function runningWorkStage(snapshot) {
  return templateLifecycleStage(snapshot, 'production')?.id || initialWorkStage(snapshot);
}

export function reviewedWorkStage(snapshot) {
  return templateLifecycleStage(snapshot, 'review')?.id || runningWorkStage(snapshot);
}
