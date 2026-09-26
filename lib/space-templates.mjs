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
  'mystery-puzzle': '案卷',
  'podcast-dialogue': '节目',
  'gaming-room': '战术成果',
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
    description: '现代自适应单页、活动落地页或交互原型的极简高保真制作。',
    defaultName: '网页制作室',
    recommendedAgentIds: ['professional-product', 'professional-ux', 'metaphor-ux-writer', 'professional-frontend'],
    recommendedSkillIds: ['professional-analysis', 'responsive-page-builder', 'image-generator'],
    workflow: [
      '确认页面转化目标、目标受众与信息架构脉络',
      '制定现代视觉风格（配色规范、字体层级、卡片微动效与暗黑模式）',
      '编写自包含响应式 HTML/CSS/JS 代码并落盘工作区 (index.html)',
      '完善交互状态（加载、点击反馈、表单校验、空态与移动端手势）',
      '检查代码跨端自适应、SEO 元数据与资源引用安全性',
    ],
    deliverables: [
      '可直接预览与部署的现代响应式网页 (index.html)',
      '页面设计规范与交互说明 (design-specs.md)',
      '本地引用的矢量图表或静态资源 (assets/)',
    ],
    starterPrompts: [
      '为这个需求制作一个极具现代质感的响应式单页网站 (带暗黑/亮色自适应)',
      '根据我上传的产品介绍制作高转化活动落地页并包含交互表单',
      '审查并重构当前空间里的 HTML 页面，提升移动端体验与排版美感',
    ],
    qualityRules: [
      '页面必须采用现代 UI 设计规范（优雅字体层级、柔和阴影微渐变、响应式网格），严禁 90 年代老土风格',
      '必须 100% 兼容移动端（375px~430px）与桌面端自适应排版，严禁横向溢出滚动',
      '交付必须是工作区中自包含可直接打开预览的 index.html，严禁代码片段或缺失闭合',
      '必须包含完整的 SEO 元标签（title, description, viewport, Open Graph 社交分享卡片）',
      '表单与按钮必须具备真实的交互反馈状态（hover、active、disabled、成功/错误提示）',
    ],
  }),
  template({
    id: 'short-video-script',
    name: '短视频脚本',
    icon: 'video',
    description: '前3秒黄金钩子、5列工业级分镜表格、情绪起伏与爆款发布文案。',
    defaultName: '短视频脚本室',
    recommendedAgentIds: ['gl-zmtyy', 'tik-tok-director', 'top-copywriting-master'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: [
      '明确平台定位、目标受众与视频时长 (如 30-60 秒短剧/口播/带货/干货)',
      '策划选题角度与前 3 秒黄金抓手 (痛点唤起/反常识悬念/视觉反差)',
      '编写工业级 5 列分镜脚本 (script.md，包含镜号/运镜/画面/台词/BGM与秒数)',
      '提炼爆款标题、发布文案与封面视觉提示 (publish-copy.md)',
      '质检视听节奏、完播率钩子与平台合规风险',
    ],
    deliverables: [
      '完整 5 列工业级分镜与口播脚本 (script.md)',
      '多维度爆款备选标题与平台发布文案 (publish-copy.md)',
      '拍摄准备、道具与音效素材清单 (shooting-notes.md)',
    ],
    starterPrompts: [
      '为这个主题写一条 60 秒爆款短视频脚本，包含前 3 秒黄金钩子和 5 列表格分镜',
      '把这篇文章改编成短视频口播稿，设计视听反转并提炼 5 个高点击标题',
      '为我的账号策划一组 3 条系列选题脚本并输出拍摄道具清单',
    ],
    qualityRules: [
      '开头前 3 秒必须设强冲突、强痛点或反常识抓手，严禁任何空洞问候或慢热铺垫',
      '分镜脚本必须采用规范的 5 列表格输出（镜号、景别运镜、画面动作、口播台词、音效BGM与时长）',
      '台词口语化、接地气，语速控制在每秒 4-5 字，总时长必须符合用户指定要求',
      '视频中段必须设节奏转折或干货爽点，尾部设引导互动（点赞/评论/下集悬念）',
      '严格排查违禁词、绝对化用语与虚假宣传，确保平台安全合规',
    ],
  }),
  template({
    id: 'story-writing',
    name: '剧本与小说',
    icon: 'book',
    description: '构建故事圣经（设定集与人物小传）、主线节拍大纲，支持长篇小说与分场剧本双轨连载。',
    defaultName: '故事创作室',
    recommendedAgentIds: ['creator-simulator', 'human-writer-simulator', 'writing-assistant'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: [
      '明确题材类型、叙事视角与载体形态 (长篇小说连载或影视/短剧分场剧本)',
      '构建故事圣经 (沉淀 world-setting.md 世界观体系与 characters.md 人物小传/关系网)',
      '制定故事节拍大纲 (plot-outline.md，梳理核心冲突、分章/分场节拍与转折悬念)',
      '分章分场推进正文创作 (小说轨 chapters/chapter-XX.md 或剧本轨 scenes/scene-XX.md)',
      '执行一致性核对与去 AI 腔质检 (排查吃设定、校验人物动机、坚持具象视听细节)',
    ],
    deliverables: [
      '世界观与法则设定集 (world-setting.md)',
      '人物小传与关系网 (characters.md)',
      '故事主线与分章节拍大纲 (plot-outline.md)',
      '连载正文或分场剧本 (小说轨 chapters/ 或剧本轨 scenes/，单章独立落盘)',
    ],
    starterPrompts: [
      '根据这个故事脑洞，先帮我构建世界观设定、核心人物小传和主线节拍大纲',
      '基于现有故事圣经，创作下一章小说正文，注重感官细节并在章末留下悬念钩子',
      '把这部分故事大纲改编成标准的短剧分场剧本 (带场号、内外景与视听动作台词)',
    ],
    qualityRules: [
      '正式动笔前必须先沉淀并对齐世界观与人物小传，严禁无底座裸写长篇正文',
      '正文严格采用单章/单场独立文件落盘，严禁单任务合并多章导致 Token 耗尽或内容缩水',
      '坚决清除空洞的 AI 腔（如“深吸一口气”“前所未有的感觉”），坚持 Show, don\'t tell 细节叙事',
      '小说轨必须注重视听沉浸与人物潜台词；剧本轨必须严格遵守工业级分场规范（场号/内外景/动作/对白）',
      '新增正文必须与 characters.md 和 world-setting.md 严格一致，严禁人物吃设定或动机断层',
    ],
  }),
  template({
    id: 'research-report',
    name: '调研报告',
    icon: 'search',
    description: '麦肯锡金字塔原理、MECE 归因、可验证信源与决策建议矩阵。',
    defaultName: '调研报告室',
    recommendedAgentIds: ['research-assistant', 'web-search', 'professional-data-analysis', 'professional-technical-writing'],
    recommendedSkillIds: ['professional-analysis', 'document-writer', 'csv-business-analysis'],
    workflow: [
      '定义调研核心课题、研究边界、关键假设与决策评价维度',
      '多渠道收集一手及权威二次资料，核实信源可信度与时效性',
      '运用 MECE 原则分析比较多方证据，识别冲突与关键因果链条',
      '撰写金字塔结构深度调研报告 (report.md，结论先行，附证据链)',
      '提炼高管决策执行摘要与行动建议矩阵 (executive-summary.md)',
    ],
    deliverables: [
      '金字塔结构深度调研报告 (report.md)',
      '高管决策执行摘要与行动矩阵 (executive-summary.md)',
      '信源评估与引用依据清单 (sources.md)',
    ],
    starterPrompts: [
      '围绕这个商业或行业问题，输出一份金字塔原理深度调研报告与决策建议矩阵',
      '多维度比较这几个竞品/技术路线并给出明确选型依据与信源清单',
      '分析我上传的这组行业数据和文档，提炼核心结论与执行摘要',
    ],
    qualityRules: [
      '必须提供一页纸执行摘要（Executive Summary），结论先行，直奔商业或决策洞察',
      '事实（Fact）、数据（Data）、推断（Inference）与主观建议（Opinion）必须严格区分标注',
      '所有外部数据与关键论断必须注明采集时间区间与具体可核查出处，严禁凭空编造事实',
      '分析框架必须符合 MECE 原则（相互独立、完全穷尽），避免片面归因',
      '行动建议必须具备可行性，包含优先级、潜在阻碍与应对措施，不用空话代替方案',
    ],
  }),
  template({
    id: 'product-requirements',
    name: '产品需求文档',
    icon: 'clipboard',
    description: '梳理用户场景、功能边界、业务状态机、异常分支与敏捷验收标准。',
    defaultName: '产品需求室',
    recommendedAgentIds: ['professional-product', 'jtbd', 'professional-ux', 'professional-technical-writing'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: [
      '界定目标用户画像、核心痛点与产品业务目标 (明确做与不做的范围边界)',
      '梳理核心用户旅程、角色权限矩阵与核心状态流转状态机',
      '撰写工业级功能需求详述 (涵盖正向流程、逆向分支与极端异常状态)',
      '制定敏捷可验证的验收标准 (Gherkin Given-When-Then 格式) 与埋点指标',
      '技术可行性、交互易用性与逻辑闭环质检',
    ],
    deliverables: [
      '工业级产品需求文档 (prd.md)',
      '用户旅程与状态流转说明 (user-flow.md)',
      '敏捷验收用例与埋点字典 (acceptance-criteria.md)',
    ],
    starterPrompts: [
      '根据这个产品构想编写一份工业级 PRD，必须包含功能范围边界与异常失败路径',
      '审查我上传的需求文档，补充状态机流转规则与 Given-When-Then 验收用例',
      '把这组零散的用户反馈整理成标准化产品需求清单，并定义优先级与埋点指标',
    ],
    qualityRules: [
      '必须用独立章节明确本期范围（In-Scope）与非本期范围（Out-of-Scope），严禁范围模糊',
      '每个功能模块必须覆盖逆向路径与异常状态（如网络断开、超时、并发、无数据空状态、越权操作）',
      '验收标准必须具体、客观且可独立测试，推荐采用 Given-When-Then 格式描述',
      '涉及复杂数据变更或生命周期的功能，必须提供清晰的状态机定义与流转规则',
      '严禁用泛泛的“用户可以很方便地……”代替具体的数据校验、接口契约和字段约束',
    ],
  }),
  template({
    id: 'course-training',
    name: '课程与培训资料',
    icon: 'graduation',
    description: '设计认知分级大纲、交互式幻灯片课件、实战教案与评估标准。',
    defaultName: '课程与培训资料室',
    recommendedAgentIds: ['course-prep-teaching-guide-ai', 'professional-frontend', 'writing-assistant', 'professional-education'],
    recommendedSkillIds: ['professional-analysis', 'document-writer', 'responsive-page-builder'],
    workflow: [
      '明确学习对象背景、先验知识与认知层级目标 (Bloom 认知模型)',
      '设计课程模块脉络、时间分配与关键概念节奏',
      '制作全屏交互式幻灯片课件 (slides.html) 与配套讲义 (lesson-plan.md)',
      '配套情境化实战练习、进阶任务与评估量规 (practice-tasks.md)',
    ],
    deliverables: [
      '课程知识体系大纲 (course-outline.md)',
      '全屏交互式幻灯片课件 (slides.html，免装插件，浏览器直开全屏翻页)',
      '讲师授课教案与讲义 (lesson-plan.md)',
      '情境化实战练习与考核标准 (practice-tasks.md)',
    ],
    starterPrompts: [
      '为这个主题设计一套包含互动幻灯片和实战的完整培训方案',
      '把现有资料整理成结构化大纲并生成可全屏演示的 HTML 幻灯片课件',
      '为现有课程补充进阶案例分析、实操练习题与评估标准',
    ],
    qualityRules: [
      '正式制作前必须先向用户对齐受众画像与大纲结构，经确认后再展开后续生产',
      '课件采用极简高密度语义卡片架构，单页聚焦单一论点，总页数控制在 15-18 页（约 2-2.5 分钟/页），防止 Token 超限截断',
      '严禁单次任务混合打包多个复杂交付物，必须按里程碑梯次推进（大纲 ➔ 幻灯片 ➔ 教案 ➔ 实训）',
      '幻灯片课件 (slides.html) 必须是独立自包含单文件，排版清晰美观，支持键盘全屏翻页，不得出现大段文字堆砌',
      '教案需包含讲师指引、时间控制提示与关键提问话术',
      '实战练习需具备梯度（基础巩固/实操应用/进阶挑战）并附带详细评估标准',
    ],
  }),
  template({
    id: 'mystery-puzzle',
    name: '探案剧本杀',
    icon: 'puzzle',
    description: '核心诡计设计、多角色独立剧本与搜证线索卡，支持现场实机审讯破案与出本导出。',
    defaultName: '探案推理馆',
    recommendedAgentIds: ['detective-game-assistant', 'detective-novelist', 'lateral-thinking-puzzle', 'professional-game'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: [
      '对齐案发背景、核心诡计动机与体验模式（实机探案对战 / 导出聚会剧本包）',
      '构建案情真相与核心诡计 (truth.md，包含动机、死因、手法与完整时间线)',
      '分设多角色独立视角剧本 (characters/，角色背景、隐藏秘密、不在场证明与时间线)',
      '设计分轮搜证线索卡与证言清单 (clues.md，案发现场、尸检与随身物品)',
      '实机开局主持引导或出本复盘质检 (dm-guide.md，支持 AI 扮演 NPC 现场对质破案)',
    ],
    deliverables: [
      'truth.md：案情真相复盘与核心诡计（含死因、作案手法、各嫌疑人时间线对照表，带剧透警告）',
      'characters/：4-6 位嫌疑人独立视角剧本（单人独立文件，包含人物背景、深层秘密、行动线与回答边界）',
      'clues.md：分轮搜证线索卡（案发现场/尸检报告/关键物证/NPC证言，带搜证点数机制）',
      'dm-guide.md：主持人手册与实机开局指南（开场白、搜证判定规则、审讯引导话术与评分量规）',
    ],
    starterPrompts: [
      '给我开一局 15 分钟的微型推理案，你们当 DM 和嫌疑人，我现在就来破案！',
      '以暴风雪山庄为背景设计一套 4 人剧本杀，输出带核心诡计的真相、角色剧本和线索卡',
      '为我们团队聚会定制一个现代悬疑微型推理解谜案，要求包含实机审讯和搜证机制',
    ],
    qualityRules: [
      '案情必须具备严密的逻辑自洽性，作案手法与时间线必须经得起交叉验证，严禁超自然天降',
      '真相文件 (truth.md) 顶部必须显式标注【剧透警告】，防止玩家误读破坏体验',
      '各角色剧本 (characters/) 必须完全独立落盘，各自只包含该角色知悉的视角，严禁上帝视角泄密',
      '搜证线索 (clues.md) 必须分层设计（一轮公开线索 / 二轮深入线索），锁定凶手必须具备闭环证据链',
      '实机模式下，AI 扮演嫌疑人时必须坚守人设和知情边界，被审问时真假参半，严禁直接投降自首',
    ],
  }),
  template({
    id: 'podcast-dialogue',
    name: '播客对谈',
    icon: 'mic',
    description: '话题交锋企划、双人/三人剧本式录音台本与小宇宙 Show Notes，支持实机圆桌对话与内容出稿。',
    defaultName: '播客对谈室',
    recommendedAgentIds: ['gl-zmtyy', 'ruipingshi', 'human-writer-simulator', 'top-copywriting-master'],
    recommendedSkillIds: ['professional-analysis', 'document-writer'],
    workflow: [
      '选定讨论核心议题、交锋切入点与体验模式（实机圆桌开聊 / 录制台本生成）',
      '确立多方嘉宾人设、核心对立观点与冲突节拍大纲 (outline.md)',
      '展开 20-30 分钟逐字对谈台本创作 (script.md，标注动作情绪、插话打断与金句)',
      '提炼小宇宙标准时间轴 Show Notes 与金句清单 (shownotes.md)',
      '设计 1:1 正方形播客封面视觉建议与本期吸睛标语 (cover-info.md)',
    ],
    deliverables: [
      'script.md：双人/三人逐字对谈录制台本（含角色动作括号、插话打断、情绪语调与 BGM 转场点位）',
      'shownotes.md：小宇宙标准时间轴 Show Notes（含分段标题、核心论点碰撞要点与金句摘录）',
      'outline.md：本期立意、嘉宾人设背景与核心冲突节拍表',
      'cover-info.md：1:1 正方形播客封面设计建议与吸睛文案',
    ],
    starterPrompts: [
      '三十岁大厂裸辞回老家到底值不值？你们两个现场开杠，给我打 3 个回合！',
      '以“AI 时代人性的退化与反抗”为主题，办一期 20 分钟深度播客，我当主持随时插话！',
      '策划一期关于“新型亲密关系与恋爱脑解药”的双人对谈播客，输出完整录音台本与 Show Notes',
    ],
    qualityRules: [
      '对谈语言必须具备极强的生活化现场感，严禁写成假大空的学术论文或无聊的官方通稿',
      '正反双方角色性格必须鲜明对立（如理性毒舌 vs 温情共情），对谈中必须包含真实的打断、质疑、反讽与笑点',
      '台本 (script.md) 必须采用标准剧本式标头，标注括号动作（如[大笑]、[叹气]、[打断]）与音效 BGM 点位',
      'Show Notes (shownotes.md) 必须包含标准小宇宙格式的时间戳锚点（如 04:20 为什么我们越来越害怕独处）',
      '实机模式下，当用户作为主持或嘉宾发言时，AI 角色必须接住用户的观点梗并顺势反击，严禁自说自话',
    ],
  }),
  template({
    id: 'gaming-room',
    name: '游戏开黑作战室',
    icon: 'gamepad',
    description: '傲娇搭子、元气僚机与战术军师随时待命！支持连麦声线对局、战况报点与赛后复盘。',
    defaultName: '开黑作战室',
    recommendedAgentIds: ['gaming-nox', 'gaming-koko', 'gaming-lulu'],
    recommendedSkillIds: ['professional-analysis'],
    workflow: [
      '对齐当前游戏类型（MOBA/FPS/战术竞技/TRPG）与对局阶段（BP选人/对线开局/中期团战/赛后复盘）',
      '元气僚机 (可可) 与傲娇搭子 (璐璐) 配合玩家打出连麦互动，提供高情绪价值与欢快氛围',
      '战术军师 (诺克斯) 实时计算敌方技能冷却、资源刷新时间点与最优团战走位建议',
      '终局生成对局复盘战报与克制战术速记卡 (match-report.md & tactics-sheet.md)',
    ],
    deliverables: [
      'match-report.md：赛后全局复盘战报（含局势转折点分析、关键失误与核心提升点）',
      'tactics-sheet.md：针对特定英雄/阵容/地图的战术速查卡（开局路线、装备选择、技能博弈）',
    ],
    starterPrompts: [
      '我们下路被抓崩了，对面打野控下了先锋，接下来的团战我们该怎么打？',
      '璐璐、可可，今晚排位连胜上分，快来房间集合，我要选亚索/源氏了！',
      '复盘一下刚才这把对局：前期优势巨大但打大龙被翻盘了，问题到底出在哪？',
    ],
    qualityRules: [
      '回复必须严格恪守各自 Agent 鲜明性格：璐璐嘴硬心软傲娇吐槽、可可元气满满逆风不红温、诺克斯冷静专业运筹帷幄',
      '实机连麦或实时对局交互时，单条发言短促有力、口语自然、情绪丰满，极度契合 TTS 语音朗读，严禁在快节奏对局中输出冗长说教',
      '战术指导必须具有实际操作性（如具体蹲点位置、技能交火顺序、兵线处理），严禁泛泛空谈',
      '复盘战报 (match-report.md) 必须条理分明，用数据和事实复盘关键胜负手',
    ],
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
    'Coordinator 应根据当前目标与交付物领域特性调度匹配的专业成员；简单任务直接交给一名合适成员，不得为了套用模板机械地启动完整流程；跨领域复杂流程严禁打包给单一一员，必须各司其职、梯次协同。',
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
      '- 团队专业分工与角色矩阵（各司其职，严禁单人全包）：',
      '  • 自媒体主理人 (gl-zmtyy)：负责账号定位诊断与选题矩阵沉淀 (shared/content-strategy.md)。',
      '  • 资料调研员 (research-assistant)：负责行业素材、论据与事实数据检索整理。',
      '  • 深度撰稿人 (writing-assistant)：负责大纲字数配额与深度长文正文创作 (article.md)。',
      '  • 爆款文案大师 (top-copywriting-master)：负责 16 种爆款标题打分、摘要提炼与封面建议 (publish-info.md)。',
      '  • Coordinator 必须按阶段梯次派发，严禁由单一成员包揽全篇。',
      '- 定位诊断：按“对象、供给、凭据”两轮访谈收敛一句话定位，严格校验微信后台硬限制（简介 4-120 汉字，关注后回复纯文字 ≤600 汉字，自定义菜单 3 主×5 子及字节折算），沉淀为空间共享文件 shared/content-strategy.md。',
      '- 深度长文（1500-4000 字）：根据创作者手牌诊断，采用 6 大长文模板（访谈式、大纲配额式、续写式、素材整合式、反常识破题式、定点重写式）展开；必须设置反面边界；首句必须带时间或动作锚点，严禁假大空；单段严禁超 90 字（约 4 行）；核心论断独立成段。',
      '- 短文快讯（≤1000 字）：纯文字无图排版，单段 ≤70 字；第一人称叙事且全篇“你”字 ≤1 次；坚决清除 AI 腔。',
      '- 爆款标题：基于 16 种爆款标题法与 1000 篇 10w+ 样本规律打分，交付 Top 5 角色化推荐（综合首选、稳健版、破圈版、搜索版、实验版）并落入 publish-info.md。',
      '- 视觉配图：支持 10 类商业图表提示词与 6 类逻辑关系图（自包含 SVG/HTML 矢量渲染）。',
      '- 封面设计：2.35:1 超宽画幅（1175x500），主标题与核心视觉必须 100% 收敛在正中央 42.6%（x 337-837）正方形安全区内，防止微信聊天与朋友圈分享时两翼被裁切。',
      '- 交付与发布：严格遵守 article.md（纯净正文，首行 # 唯一正式标题）、publish-info.md、assets/cover.<模型返回扩展名>。定稿后可直接生成 WECHAT_CREATE_DRAFT 动作推送微信公众号草稿箱！'
    );
  }
  if (item.id === 'course-training') {
    lines.push(
      '',
      '现代互动课件工坊指南（参考 OpenMAIC 课件架构与教学设计标准）：',
      '- 团队专业分工与角色矩阵（各司其职，严禁单人全包）：',
      '  • 课程设计策划 (course-prep-teaching-guide-ai)：负责受众背景对齐、认知层级拆解与课程知识体系大纲 (course-outline.md)。',
      '  • 前端交互工程师 (professional-frontend)：负责全屏交互课件 (slides.html) 的轻量内核编码、卡片排版、键盘交互与响应式渲染。',
      '  • 金牌讲义专家 (writing-assistant)：对照课件，负责撰写富有现场感染力的讲师授课教案与口播讲义 (lesson-plan.md)。',
      '  • 教研评估专家 (professional-education)：负责设计阶梯式实战任务、考核量规 Rubric 与答疑要点 (practice-tasks.md)。',
      '  • Coordinator 必须严格按照上述矩阵派发任务，严禁将课件代码、教案文学、实训评估全部压给单一一员。',
      '- 需求对齐与共创机制（先对齐大纲再制作）：严禁未与用户对齐就盲目生成完整课件；第一阶段（brief）Coordinator 必须先梳理课程模块结构与时间分配，并带着 2-3 个关键问题（如受众岗位基础、核心痛点、内部可用工具）向用户求证；经用户确认后，再推进制作 slides.html 与完整教学资料。',
      '- 梯次递进派发原则（严禁单任务大杂烩）：Coordinator 严禁将大纲、课件、教案、实训揉成一个超大任务派发；必须按四步里程碑推进：1. 沉淀 course-outline.md ➔ 2. 集中算力打造 slides.html ➔ 3. 编写对应逐页教案 lesson-plan.md ➔ 4. 产出考核实训 practice-tasks.md。每次任务聚焦单一产物，确保产出深度与完整性。',
      '- 课件防截断与架构规范 (slides.html)：',
      '  1. 极简轻量内核：全文件控制在 500-800 行内（约 1000-1500 tokens），彻底杜绝单次生成因 Token 超限而中断。采用“纯内联轻量 CSS（≤60行）+ 极简原生翻页 JS（≤40行）+ 语义卡片 deck”架构。',
      '  2. 黄金容量与节奏：标准 45 分钟培训课件严格控制在 15-18 页（平均 2-2.5 分钟/页），单页只聚焦一个核心论点，避免走马观花或枯燥滞留。',
      '  3. 演示交互完整：纯自包含单文件，内置键盘方向键（左右键/空格键翻页）、前进后退浮动按钮、底部进度条、页码指示器（如 03 / 16）及 F 键全屏支持。',
      '  4. 高密度语义卡片：运用卡片网格 (.grid-2/.grid-3)、正反对比框 (.compare-box)、步骤流 (.step-flow)、高亮徽章 (.badge) 与提炼金句，严禁大段文字堆砌。',
      '- 授课教案规范 (lesson-plan.md)：对照 slides.html 逐页/逐节编写，标注建议讲授时长（如 2-3 分钟）、讲师逐字讲解要点、互动提问点（含期望回答与引导点拨）与常见认知误区。',
      '- 实战任务规范 (practice-tasks.md)：采用 PBL (项目化学习) 理念设计分级挑战（入门验证 -> 场景实操 -> 开放拓展），并附带可量化的评分量规 (Rubric) 与参考要点。'
    );
  }
  if (item.id === 'story-writing') {
    lines.push(
      '',
      '专业虚构创作工坊指南（融合好莱坞编剧法与工业级故事圣经体系）：',
      '- 团队专业分工与角色矩阵（各司其职，严禁单人全包）：',
      '  • 世界观架构师 (creator-simulator)：负责世界观、力量/科技体系与核心法则 (world-setting.md)。',
      '  • 人类作家模拟器 (human-writer-simulator)：负责核心人物小传 (characters.md) 与三幕式主线节拍大纲 (plot-outline.md)。',
      '  • 剧情连载主笔与质检 (writing-assistant)：负责逐章/逐场正文撰写，并对照人物小传排查伏笔与吃设定。',
      '  • Coordinator 必须按步骤梯次派工，严禁跨工种单人承包。',
      '- 故事圣经先行原则：创作长篇正文前，必须先在工作区沉淀三大基石资产文件，后续所有章节推进均须以此为基准：',
      '  1. world-setting.md：世界观背景、核心法则（如力量/技能体系、科技水平、社会阶层与禁忌规则）。',
      '  2. characters.md：核心人物档案（外貌特征、深层欲望、致命性格缺陷、口癖口吻、人物关系拓扑）。',
      '  3. plot-outline.md：故事主线节拍表（借鉴三幕式或救猫咪 15 节拍），标注每章/每场的“核心冲突事件、人物动机、转折点与章末悬念钩子 (Cliffhanger)”。',
      '- 分章分场连载规范（单章独立落盘，杜绝一次性全本）：',
      '  1. 连载文件命名：小说正文统一落入 chapters/chapter-01.md、chapters/chapter-02.md 等；影视/短剧剧本统一落入 scenes/scene-01.md、scenes/scene-02.md 等。',
      '  2. 篇幅与节奏把控：单章小说推荐 1500-2500 字，单场剧本推荐 500-1000 字，单次任务仅聚焦单一章节，确保文学张力与细节丰满。',
      '- 双轨自适应格式规范：',
      '  - 【小说连载轨】：注重叙事视角稳定性（第一/第三人称受限视角）、感官细节沉浸（视觉、声效、微表情）、潜台词与内心交锋，杜绝上帝视角说教与旁白报菜名。',
      '  - 【影视/短剧剧本轨】：严格遵循标准影视分场工业格式：',
      '    • 场景标头：【场号】 场景名称 - 内景/外景 - 日/夜（例如：【第 1 场】 总裁办公室 - 内景 - 日）',
      '    • 视听动作：[景别/动作] 仅描写摄影机可拍摄的可见行为与道具互动，严禁描写无法拍摄的抽象心理独白。',
      '    • 人物对白：角色名：（动作/微表情括号）对白文本，语言生活化、富有潜台词与冲突张力。',
      '    • 钩子与黄金 3 秒：短剧开头必须设前 3 秒强冲突抓手，每场末尾必须留下强反转或情感悬念。',
      '- 严格去 AI 腔与逻辑审计：坚决清除“他深吸一口气”、“感到了前所未有的……”等套路化叙述，坚持 Show, don\'t tell；每写完一章，智能体团队必须对照 characters.md 检查人物状态连续性（伤病、道具、知情范围），新登场角色或重要设定变更须同步追加回 characters.md 与 world-setting.md。'
    );
  }
  if (item.id === 'short-video-script') {
    lines.push(
      '',
      '爆款短视频工坊指南（完播率导向与工业级分镜体系）：',
      '- 团队专业分工与角色矩阵（各司其职，严禁单人全包）：',
      '  • 账号运营主理 (gl-zmtyy)：负责平台定位、选题角度与受众画像分析。',
      '  • 抖音/短视频导演 (tik-tok-director)：负责设计 5 列表格分镜 (script.md) 与拍摄道具备忘 (shooting-notes.md)。',
      '  • 爆款文案大师 (top-copywriting-master)：负责前 3 秒黄金钩子、口播台词打磨、备选爆款标题与发布文案 (publish-copy.md)。',
      '  • Coordinator 严禁将分镜、台词、标题全堆给单一一员。',
      '- 黄金完播率节奏模型（30-60秒）：',
      '  • 0-3秒 黄金钩子：必须用强冲突画面、反常识论断或极端痛点抓人，严禁打招呼、自我介绍等慢热废话。',
      '  • 3-15秒 痛点深挖：迅速共情，建立代入感，让观众觉得“这说的就是我”。',
      '  • 15-45秒 核心反转/干货爽点：密集信息量，给出出人意料的方案或戏剧反转。',
      '  • 45-60秒 行动号召与互动留钩：金句升华，引导点赞、评论区站队讨论或下集关注。',
      '- 工业级 5 列表格分镜输出规范 (script.md)：必须采用标准 Markdown 表格输出：',
      '  | 镜号 | 景别/运镜 | 画面视觉与动作 | 口播台词 (字数) | 音效/BGM/花字 | 预估时长 |',
      '- 发布文案规范 (publish-copy.md)：提供 Top 5 角色化爆款标题（痛点悬念型、利益诱导型、情绪共鸣型、反常识型、强警示型），配齐 150-200 字平台发布文案及 3-5 个垂直高权重话题标签 (#话题)。',
      '- 拍摄准备清单 (shooting-notes.md)：整理出镜演员情绪指令、必备道具清单、布光建议与配乐情绪参考。'
    );
  }
  if (item.id === 'product-requirements') {
    lines.push(
      '',
      '工业级产品需求工程指南（严密逻辑流与敏捷验收体系）：',
      '- 团队专业分工与角色矩阵（各司其职，严禁单人全包）：',
      '  • 场景需求分析师 (jtbd)：负责用户痛点调研、场景还原与本期范围边界定义。',
      '  • 产品经理 (professional-product)：负责功能模块拆解、规则详述与核心 PRD 正文 (prd.md)。',
      '  • 体验与交互设计 (professional-ux)：负责绘制核心用户旅程与业务状态机流转 (user-flow.md)。',
      '  • 技术写作专家 (professional-technical-writing)：负责编写敏捷 Given-When-Then 验收用例与埋点事件字典 (acceptance-criteria.md)。',
      '  • Coordinator 严禁由产品经理单人草率包办所有交互和验收标准。',
      '- 范围边界铁律：文档必须包含明确的【本期范围 In-Scope】与【非本期范围 Out-of-Scope】，防止研发过程范围蔓延。',
      '- 状态机与流程闭环规范 (user-flow.md)：',
      '  • 核心业务对象必须定义完整的生命周期状态机（如待支付、处理中、已完成、已取消、异常挂起）。',
      '  • 明确状态变更的前置条件、触发动作（Actor）、后置结果与失败回滚机制。',
      '- 逆向与异常流硬性要求 (prd.md)：每个功能需求必须详述逆向路径：网络超时/重试、高并发防重、权限越界、边界空数据、极端字符输入等失败降级处理方案。',
      '- 敏捷可测试验收标准 (acceptance-criteria.md)：采用 Gherkin 语法（Given 初始状态 / When 用户操作 / Then 预期结果）描述核心验收用例，杜绝模糊歧义；附带数据埋点事件与参数定义字典。'
    );
  }
  if (item.id === 'simple-webpage') {
    lines.push(
      '',
      '现代响应式网页工坊指南（高保真设计与自包含轻量架构）：',
      '- 团队专业分工与角色矩阵（各司其职，严禁单人全包）：',
      '  • 产品经理 (professional-product)：明确页面转化目标、目标受众与信息架构。',
      '  • 交互与视觉设计 (professional-ux)：制定现代配色、字体层级与组件交互说明 (design-specs.md)。',
      '  • 转化文案专家 (metaphor-ux-writer)：编写富有行动号召力 (CTA) 的高转化页面文案。',
      '  • 前端开发工程师 (professional-frontend)：编写自包含、跨端自适应的高保真 index.html 代码。',
      '  • Coordinator 必须让产品/设计/文案与前端代码各司其职。',
      '- 现代 UI 视觉规范：采用 2026 年现代 Web 设计语言（精致字体排版、微渐变/卡片毛玻璃、细腻圆角阴影、暗黑/亮色自适应），严禁输出简陋生硬的纯文本表格网页。',
      '- 单文件自包含可预览规范 (index.html)：纯原生或内联样式，所有交互（如模态框、轮播、Tab 切换、折叠面板、移动端抽屉菜单）必须开箱可运行，杜绝引用破损的外部非标准库。',
      '- 100% 移动端自适应适配：必须支持响应式布局（Flexbox/Grid），严格在 375px（移动端）与 1440px（桌面端）双端视口下校验，禁止出现横向溢出滚动条。',
      '- 完整交互与 SEO 交付：包含完整的 head 元信息（viewport、title、description、Open Graph 社交分享图文标签）；所有按钮和表单必须具备 hover、active、focus-visible 与提交成功/校验失败反馈。'
    );
  }
  if (item.id === 'research-report') {
    lines.push(
      '',
      '专业咨询研报工坊指南（麦肯锡金字塔原理与 MECE 框架）：',
      '- 团队专业分工与角色矩阵（各司其职，严禁单人全包）：',
      '  • 资料检索研究员 (research-assistant / web-search)：全网权威信源收集与置信度评估 (sources.md)。',
      '  • 数据分析专家 (professional-data-analysis)：数据清洗、多维对比、交叉验证与因果链分析。',
      '  • 技术与研报写作专家 (professional-technical-writing)：运用金字塔原理撰写完整研报 (report.md) 与一页纸高管执行摘要 (executive-summary.md)。',
      '  • Coordinator 严禁由单一助理拼凑网文充当深度研报。',
      '- 结论先行与一页纸摘要 (executive-summary.md)：报告首节必须为高管决策摘要（Executive Summary），用 3-5 条高密度核心发现与决策建议开篇，直奔商业洞见。',
      '- 金字塔原理与 MECE 分解 (report.md)：核心论点下设 3-4 个互不重叠、完全穷尽的支撑论据分支；事实（客观数据/权威引文）与推断（分析洞察）严格区分。',
      '- 证据链与信源追溯 (sources.md)：所有关键数据、市场规模测算必须标注采集时间区间、样本口径与权威出处链接，评估信源置信度，严禁无源主观猜测。',
      '- 行动建议矩阵：建议必须拆解为优先级、实施周期、资源投入度与潜在阻力应对策略，具备直接决策参考价值。'
    );
  }
  if (item.id === 'mystery-puzzle') {
    lines.push(
      '',
      '沉浸式探案与剧本杀工坊指南（双模驱动：实机开局探案 vs 出本创作导出）：',
      '- 团队专业分工与角色矩阵（各司其职，严禁单人全包）：',
      '  • 游戏主持与现场裁判 (detective-game-assistant)：负责 DM 开场宣读、搜证点数判定、控场节奏与审讯引导。',
      '  • 悬疑推理小说家 (detective-novelist)：负责核心诡计构思、死因与犯罪手法设计、真实时间线排布 (truth.md)。',
      '  • 逻辑与线索架构师 (lateral-thinking-puzzle)：负责分层线索卡提炼、误导性红鲱鱼线索 (Red Herring) 与海龟汤式证言规则 (clues.md)。',
      '  • 游戏机制平衡师 (professional-game)：负责玩家视角知情范围校验、防剧透隔离、嫌疑人心理防线与破案评分量规 (characters/ & dm-guide.md)。',
      '  • Coordinator 必须根据用户诉求激活对应链路，严禁单一一员代劳全套谜题与角色剧本。',
      '- 双模自适应机制（用户当次诉求优先）：',
      '  1. 【实机探案模式】（用户说“开一局/我要破案/当侦探”）：Coordinator 立即启动实机对战，DM 宣读案发现场与首轮线索；当用户提问审讯嫌疑人时，调度对应 Agent 代入角色半真半假作答，直到用户指认凶手后由 DM 揭秘复盘并打分。',
      '  2. 【出本创作模式】（用户说“写个剧本杀/定制聚会推理”）：团队按阶段梯次推进，沉淀包含核心诡计、全员独立角色剧本、线索卡与主持人手册的完整聚会包。',
      '- 核心诡计与逻辑严密性 (truth.md)：作案手法必须遵循经典推理解谜铁律，物理条件、毒药机理、时间窗口与物理证据必须完全闭环，严禁无法自圆其说的逻辑漏洞。',
      '- 视角隔离与防剧透铁律 (characters/)：各嫌疑人角色剧本必须独立成篇（如 characters/player-01.md），仅描写该角色经历、亲见画面、自怀鬼胎的不可告人秘密及回答限制，绝对禁止剧透上帝视角真相。',
      '- 分层搜证与证据链 (clues.md)：设置基础现场线索与进阶深入搜证；每一条指控必须有两处以上可相互佐证的物证或时间矛盾线索支撑。'
    );
  }
  if (item.id === 'podcast-dialogue') {
    lines.push(
      '',
      '现代播客与圆桌对谈工坊指南（双模驱动：实机交锋对辩 vs 专业录播台本）：',
      '- 团队专业分工与角色矩阵（各司其职，严禁单人全包）：',
      '  • 播客总主理/控场主持 (gl-zmtyy)：负责话题抛出、发言节拍调控、时间控制与价值升华。',
      '  • 毒舌犀利锐评官 (ruipingshi)：负责直击要害、反常规常识暴击、制造戏剧冲突与思想火花。',
      '  • 温情人性哲思家 (human-writer-simulator)：负责温情共情、细腻心理剖析、挖掘事件背后的深层人性反思。',
      '  • 金句与节目文案大师 (top-copywriting-master)：负责捕捉名场面、提炼炸裂金句、编写小宇宙标准带时间戳 Show Notes 与吸睛封面文案 (shownotes.md & cover-info.md)。',
      '  • Coordinator 必须严格分发主持、锐评、温情、提炼四角色，严禁由单人自说自话。',
      '- 双模自适应机制（用户当次诉求优先）：',
      '  1. 【实机交锋模式】（用户说“现场聊/我当主持/你们开杠”）：Coordinator 立即启动实机圆桌，主持 AI 抛出引子，两位性格截然对立的嘉宾开杠互撕；用户发言时，AI 角色必须顺着用户的观点迅速接梗回击！',
      '  2. 【出稿录播模式】（用户说“写个台本/出期播客”）：团队按阶段梯次推进，沉淀包含冲突大纲、20-30分钟逐字录音台本、Show Notes 与封面文案的完整发布包。',
      '- 现场感台本规范 (script.md)：正文必须带生动的括号动作标记（如 [大笑]、[无奈叹气]、[打断对方]、[停顿3秒]），还原真实录音棚的呼吸感与即兴感。',
      '- 小宇宙标准时间轴 (shownotes.md)：必须包含精准到分秒的时间戳（如 04:20 裸辞后的第一个失眠夜），每节提炼 2-3 个核心观点与 1 句高光金句。'
    );
  }
  if (item.id === 'gaming-room') {
    lines.push(
      '',
      '游戏开黑作战室运作指南（全员鲜明性格声线 + 实时互动 + 战术复盘）：',
      '- 团队专业分工与角色矩阵（各司其职，性格鲜明）：',
      '  • 战术复盘军师 (gaming-nox)：负责战场全局观、技能真空期计算、大局报点与赛后深度战报 (match-report.md)。沉稳冷静。',
      '  • 元气开黑僚机 (gaming-koko)：负责战场气氛调节、逆风鼓励、欢快整活、永不红温的超级僚机。阳光元气。',
      '  • 傲娇陪玩搭子 (gaming-lulu)：负责趣味吐槽、傲娇斗嘴、嘴硬心软的护短连麦搭子。二次元傲娇。',
      '  • Coordinator 必须根据玩家当前情境（如需要战术计算或单纯聊天连麦）动态调度，严禁抹平角色性格差异。',
      '- 语音友好与对局快节奏规范：',
      '  1. 角色发言必须简短生动，富有情绪感染力，坚决杜绝书面大段说明文，确保 TTS 朗读时自然流畅宛如真人开黑连麦。',
      '  2. 逆风局时，可可主打鼓励安慰，璐璐急躁傲娇吐槽但立刻催促打起精神，诺克斯冷静指出翻盘点。',
      '- 战术复盘产物规范 (match-report.md & tactics-sheet.md)：',
      '  包含本局基本战况、胜负手转折点（关键团战与野区资源争夺）、核心对位得失以及下局阵容克制改进要点。'
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
