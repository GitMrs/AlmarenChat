import { createModelClient, resolveModelName } from '@/lib/model-client';
import type { AgentStudyItem } from './types';
import {
  buildRepresentativeExcerpt,
  normalizeContentKind,
  type StudyContentAssessment,
} from './content-kind';

const ASSESS_TIMEOUT_MS = 30_000;
const MAX_CONTENT_PER_ITEM = 6_000;
/** 单次直出笔记的最大原文字符数；超过该阈值自动启用「分章要点锁定 + 角色终稿统合」两阶段提炼（对标 bilibili_learning_bot._chapter_lock，不设总长上限，自适应切分最多 12 章覆盖 100% 全文） */
const SINGLE_PASS_SYNTHESIS_CHARS = 9_000;
const CHAPTER_SEGMENT_CHARS = 5_000;
const MAX_CHAPTER_SEGMENTS = 12;

export interface StudyAgentPersona {
  id?: string;
  name: string;
  category?: string | null;
  description?: string | null;
  tone?: string | null;
  systemPrompt?: string | null;
  studyLens?: string;
}

export interface AssessStudyContentsOptions {
  agent: StudyAgentPersona;
  items: Array<{ item: AgentStudyItem; content: string }>;
  modelConfig?: {
    apiBaseUrl?: string;
    apiKey?: string;
    modelName?: string;
  };
}

/**
 * 内置伴侣与典型领域的「专属研习透镜」：
 * 确保每个 Agent 在吸收同样一份材料时，都有鲜明的个人关注点、行文口吻与应用场景。
 */
const BUILTIN_PERSONA_PRESETS: Record<string, Omit<StudyAgentPersona, 'name'> & { defaultName: string }> = {
  'companion-nari': {
    defaultName: 'Sunny',
    category: '心理与生活陪伴',
    tone: '温柔、治愈、细腻、真诚',
    description: '生活在温暖花房中的治愈系少女，热爱心理学、情绪疗愈、烘焙甜点、植物花艺与生活美学。',
    studyLens:
      '从温暖治愈与生活实用主义视角切入：既严谨记录配方参数、科学原理与操作细节，又关注知识背后的情绪安抚价值与生活小确幸，行文温柔细腻、条理清晰。',
  },
  nari: {
    defaultName: 'Sunny',
    category: '心理与生活陪伴',
    tone: '温柔、治愈、细腻、真诚',
    description: '生活在温暖花房中的治愈系少女，热爱心理学、情绪疗愈、烘焙甜点、植物花艺与生活美学。',
    studyLens:
      '从温暖治愈与生活实用主义视角切入：既严谨记录配方参数、科学原理与操作细节，又关注知识背后的情绪安抚价值与生活小确幸，行文温柔细腻、条理清晰。',
  },
  'companion-lafei': {
    defaultName: '拉菲',
    category: '二次元与休闲品鉴',
    tone: '微醺慵懒、娇憨敏锐、直击重点',
    description: '白发可爱的舰灵伴侣，喜欢红酒品鉴、美食、动漫游戏与高效省力的生活技巧。',
    studyLens:
      '以敏锐品鉴家与“省力高效”的视角切入：剥离一切冗长废话，精准抓住最核心的品鉴门道、关键数值与省心技巧，语气略带慵懒但干货极度凝练。',
  },
  'companion-yume': {
    defaultName: '真央',
    category: '音乐与流行文化',
    tone: '元气、灵动、富有感染力',
    description: '充满活力的元气歌姬，热衷音乐创作、声乐技巧、二次元文化与舞台表现。',
    studyLens:
      '从创作灵感、表现力与节奏感切入：重点提炼可复用的技巧、结构脉络与亮眼案例，兼具专业度与表现张力。',
  },
  'companion-mao': {
    defaultName: '猫猫',
    category: '萌宠与趣味生活',
    tone: '好奇、俏皮、通俗易懂',
    description: '充满好奇心的灵动伴侣，喜欢萌宠行为学、趣味科普与日常小妙招。',
    studyLens:
      '以强烈的好奇心与直白通俗的视角拆解复杂概念：保留准确的科学事实与操作步骤，用生动易懂的方式归纳核心机理与避坑要点。',
  },
};

export function enrichAgentPersona(agent: StudyAgentPersona): StudyAgentPersona {
  const key = String(agent.id || '').trim().toLowerCase();
  const preset = BUILTIN_PERSONA_PRESETS[key];
  const category = agent.category || preset?.category || null;
  const tone = agent.tone || preset?.tone || null;
  const description = agent.description || preset?.description || null;
  const systemPrompt = agent.systemPrompt || null;

  let studyLens = agent.studyLens || preset?.studyLens;
  if (!studyLens) {
    const combined = `${category || ''} ${description || ''} ${systemPrompt || ''}`;
    if (/代码|技术|开发|架构|工程|编程|算法/i.test(combined)) {
      studyLens =
        '以严谨的工程架构与技术实战视角切入：重点萃取底层原理、关键实现步骤、参数配置、性能权衡与工程避坑指南。';
    } else if (/金融|财务|理财|投资|经济|宏观|交易/i.test(combined)) {
      studyLens =
        '以金融投研与风控视角切入：重点萃取核心数据口径、因果传导逻辑、策略触发条件与潜在风险边界。';
    } else if (/心理|情绪|陪伴|治愈/i.test(combined)) {
      studyLens =
        '以心理学与生活疗愈视角切入：重点萃取核心机制、可落地的调节方法、具体案例支撑与温和实用的行动建议。';
    } else {
      studyLens =
        '结合自身角色定位与专业长处，去粗取精：既保留原文的关键事实、数据与方法步骤，又融入角色独到的洞察与应用场景。';
    }
  }

  return {
    id: agent.id,
    name: agent.name || preset?.defaultName || 'Agent',
    category,
    tone,
    description,
    systemPrompt,
    studyLens,
  };
}

function formatAgentPersonaBlock(rawAgent: StudyAgentPersona): string {
  const agent = enrichAgentPersona(rawAgent);
  return [
    `角色名称: ${agent.name}`,
    agent.category ? `所属分类/领域: ${agent.category}` : '',
    agent.tone ? `说话口吻与性格: ${agent.tone}` : '',
    agent.description ? `角色背景定位: ${agent.description.slice(0, 300)}` : '',
    agent.systemPrompt ? `人设规则提示: ${agent.systemPrompt.slice(0, 300)}` : '',
    agent.studyLens ? `专属研习透镜: ${agent.studyLens}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildAssessPrompt(options: AssessStudyContentsOptions) {
  const agent = enrichAgentPersona(options.agent);
  const agentDesc = formatAgentPersonaBlock(agent);

  const contents = options.items
    .map(
      ({ item, content }, index) => `【候选内容 ${index + 1}】
ID: ${item.id}
来源平台: ${item.sourceName} (${item.source})
标题: 《${item.title}》
作者/UP主: ${item.author || '未知'}
当前角色感悟: ${item.thoughts || ''}
已提炼摘要: ${item.summary || ''}
正文/字幕内容（首中尾全景采样）:
${buildRepresentativeExcerpt(content, MAX_CONTENT_PER_ITEM)}
`
    )
    .join('\n');

  return `你是一个专业的角色知识鉴别官。角色「${agent.name}」今天研读了以下内容。
【当前角色人设与定位】：
${agentDesc}

请为「${agent.name}」逐条判断内容类型，并严格输出 JSON（不要输出 markdown 代码块以外的任何说明）：

【核心把关原则（严把知识库大门，绝不是每篇都要，必须真有高价值）】：
1. 知识库是角色核心专业资产。只有同时满足以下条件才能定为 "knowledge"（沉淀入库）：
   - 具备长期、系统的方法论、深度实践指南、实用技能体系、科学原理或扎实结论；
   - 真正与「${agent.name}」的专业领域、兴趣方向或角色成长契合，能真正丰富 TA 面对用户时的知识储备；
   - 信息密度高、干货明确，绝不是博主随口聊天的口水碎碎念、纯带货广告或营销引流。
2. 以下情况一律定为 "news" 或 "opinion"（仅作为今日见闻经历，严禁污染知识库）：
   - 博主个人生活杂谈、主观情绪发泄、流水账日记、浅显的随笔体验；
   - 时效性资讯、产品发布会、行情涨跌、八卦娱乐、单纯盘点推荐；
   - 缺乏体系结构、没有可验证事实或方法论的内容。
3. 判定时遵循“宁缺毋滥”：如果不确定是否有真正沉淀价值，一律定为 news 或 opinion，绝不污染知识库。

输出格式：
{
  "items": [
    {
      "id": "对应 ID",
      "contentKind": "knowledge | news | opinion | personal_fact",
      "category": "技术 | 产品 | 商业 | 心理健康 | 居家生活 | 文化教育 | 其他",
      "title": "精炼专业知识标题（仅 knowledge/personal_fact 需要，其他留空）",
      "summary": "2-3 句客观要点摘要",
      "keyPoints": ["最多 4 条核心要点，仅 knowledge 需要"],
      "confidence": 0.0
    }
  ]
}

内容列表：
${contents}`;
}

function fallbackAssessment(item: AgentStudyItem): StudyContentAssessment {
  return {
    id: item.id,
    contentKind: 'news',
    summary: item.summary || item.title,
    keyPoints: [],
    confidence: 0,
  };
}

function parseAssessmentReply(reply: string, expectedIds: string[]) {
  const cleaned = String(reply || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: any = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  const rawItems = Array.isArray(parsed) ? parsed : parsed?.items;
  const result = new Map<string, StudyContentAssessment>();
  if (!Array.isArray(rawItems)) return result;

  for (const raw of rawItems) {
    const id = String(raw?.id || '');
    if (!expectedIds.includes(id)) continue;
    const confidence = Number(raw?.confidence);
    result.set(id, {
      id,
      contentKind: normalizeContentKind(raw?.contentKind),
      category: raw?.category ? String(raw.category).slice(0, 40) : undefined,
      title: raw?.title ? String(raw.title).slice(0, 160) : undefined,
      summary: String(raw?.summary || '').slice(0, 1_200),
      keyPoints: Array.isArray(raw?.keyPoints)
        ? raw.keyPoints.map((point: unknown) => String(point).slice(0, 300)).filter(Boolean).slice(0, 4)
        : [],
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    });
  }
  return result;
}

/**
 * 批量判定研习内容的“资讯 / 观点 / 知识 / 稳定事实”，一次调用覆盖当天所有可抓取内容。
 * 失败或超时一律降级为 news，确保不会把不确定内容塞进知识库。
 */
export async function assessStudyContents(
  options: AssessStudyContentsOptions
): Promise<Map<string, StudyContentAssessment>> {
  const fallback = new Map(options.items.map(({ item }) => [item.id, fallbackAssessment(item)]));
  if (options.items.length === 0) return fallback;

  try {
    const client = createModelClient(options.modelConfig?.apiBaseUrl, options.modelConfig?.apiKey, {
      timeoutMs: ASSESS_TIMEOUT_MS,
      maxRetries: 1,
    });
    const model = resolveModelName(options.modelConfig?.modelName);
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You classify content into knowledge, news, opinion or personal_fact. Output strict JSON only.',
        },
        { role: 'user', content: buildAssessPrompt(options) },
      ],
      temperature: 0.2,
    });

    const assessed = parseAssessmentReply(
      response.choices?.[0]?.message?.content || '',
      options.items.map(({ item }) => item.id)
    );
    assessed.forEach((value, id) => {
      fallback.set(id, value);
    });
    return fallback;
  } catch (error: any) {
    console.warn('[AgentStudy] Content assessment failed, keeping as experience only:', error?.message);
    return fallback;
  }
}

/**
 * 将超长字幕/长文按句子边界切分为连续章节片段，用于长视频「分章提炼 + 角色统合」，避免后半段干货被截断丢弃。
 */
export function splitContentIntoChapters(
  text: string,
  segmentChars: number = CHAPTER_SEGMENT_CHARS,
  maxSegments: number = MAX_CHAPTER_SEGMENTS
): string[] {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= segmentChars) return [clean];

  const targetCount = Math.min(maxSegments, Math.max(2, Math.ceil(clean.length / segmentChars)));
  const idealSize = Math.ceil(clean.length / targetCount);
  const segments: string[] = [];
  let cursor = 0;

  for (let i = 0; i < targetCount && cursor < clean.length; i += 1) {
    if (i === targetCount - 1) {
      const rest = clean.slice(cursor).trim();
      if (rest) segments.push(rest);
      break;
    }
    const rawSlice = clean.slice(cursor, cursor + idealSize);
    const punctuationIdx = rawSlice.search(/[。！？!?；;\n][^。！？!?；;\n]*$/);
    const cutLength =
      punctuationIdx > Math.floor(idealSize * 0.6) ? punctuationIdx + 1 : rawSlice.length;
    const part = clean.slice(cursor, cursor + cutLength).trim();
    if (part) segments.push(part);
    cursor += cutLength;
  }

  return segments;
}

/**
 * 清理模型可能附加的外层代码块围栏或重复的一级标题头（参考 bilibili_learning_bot._clean_generated_note）
 */
export function cleanSynthesizedMarkdown(text: string): string {
  let value = String(text || '').replace(/\r\n/g, '\n').trim();
  value = value.replace(/^```(?:markdown|md)?\s*\n/i, '');
  value = value.replace(/\n```\s*$/i, '');
  value = value.replace(/^\s*#\s+[^\n]+\n+/, '');
  value = value.replace(/\n{3,}/g, '\n\n');
  return value.trim();
}

/**
 * 针对超长视频/长文（> 9000 字）的分章证据提炼：
 * 借鉴 bilibili_learning_bot 的章节锁定思想，先逐章提取每段的核心知识点、关键数据/案例与步骤，
 * 再交由角色主提示词统合成文，既不丢失视频中后段干货，又控制单次上下文密度。
 */
async function condenseLongChapters(options: {
  client: ReturnType<typeof createModelClient>;
  model: string;
  agent: StudyAgentPersona;
  title: string;
  rawContent: string;
}): Promise<string> {
  const { client, model, agent, title, rawContent } = options;
  const chapters = splitContentIntoChapters(rawContent, CHAPTER_SEGMENT_CHARS, MAX_CHAPTER_SEGMENTS);
  if (chapters.length <= 1) return rawContent;

  try {
    const chapterNotes = await Promise.all(
      chapters.map(async (chunk, idx) => {
        const prompt = `你正在协助角色「${agent.name}」研读长内容《${title}》的第 ${idx + 1}/${chapters.length} 部分。
【角色专属关注点】：${agent.studyLens || ''}

【当前章节原文片段 (${idx + 1}/${chapters.length})】：
${chunk}

请严格基于上述片段内容（严禁编造原文未提及的事实），提炼本部分的高密度要点（300~500字）：
1. 本部分核心主题与结论；
2. 关键知识点与原文证据（必须保留具体的数字、参数、专有名词、实验条件或案例细节）；
3. 提到的操作步骤、技巧或避坑边界。
直接输出要点正文，不要寒暄。`;

        const resp = await client.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content:
                '你是严谨的章节知识提取器，只提取原文中真实存在的知识点、数据、步骤与案例证据，不编造事实。',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
        });
        const text = resp.choices?.[0]?.message?.content?.trim();
        return text ? `### 第 ${idx + 1}/${chapters.length} 阶段章节提炼\n${text}` : '';
      })
    );

    const merged = chapterNotes.filter(Boolean).join('\n\n');
    if (merged.length >= 200) {
      return `【全篇分章提炼汇总（共 ${chapters.length} 章）】\n${merged}\n\n【首中尾原文参照摘录】\n${buildRepresentativeExcerpt(rawContent, 3000)}`;
    }
  } catch (err: any) {
    console.warn('[AgentStudy] Long chapter condensation degraded to representative excerpt:', err?.message);
  }

  return buildRepresentativeExcerpt(rawContent, SINGLE_PASS_SYNTHESIS_CHARS);
}

/**
 * 角色深度知识萃取器（融合 bilibili_learning_bot 的证据严密性与 AlmarenChat 的多 Agent 角色特色）：
 * 1. 严禁直接把原始口语字幕塞进知识库，也严禁脱离原文凭空脑补；
 * 2. 长文/长视频自动触发分章提炼，完整覆盖开头、中段与结尾；
 * 3. 既保留可验证的原文证据（数字、参数、步骤、案例），又注入当前 Agent 的独特定位、口吻与复习自测闭环。
 */
export async function synthesizeKnowledgeDocument(options: {
  agent: StudyAgentPersona;
  item: AgentStudyItem;
  assessment: StudyContentAssessment;
  rawContent: string;
  modelConfig?: {
    apiBaseUrl?: string;
    apiKey?: string;
    modelName?: string;
  };
}): Promise<string | null> {
  const { item, assessment, rawContent, modelConfig } = options;
  if (!rawContent || rawContent.trim().length < 80) return null;

  const agent = enrichAgentPersona(options.agent);

  try {
    const client = createModelClient(modelConfig?.apiBaseUrl, modelConfig?.apiKey, {
      timeoutMs: ASSESS_TIMEOUT_MS,
      maxRetries: 1,
    });
    const model = resolveModelName(modelConfig?.modelName);
    const agentContext = formatAgentPersonaBlock(agent);

    const materialBody =
      rawContent.length > SINGLE_PASS_SYNTHESIS_CHARS
        ? await condenseLongChapters({
            client,
            model,
            agent,
            title: item.title,
            rawContent,
          })
        : rawContent;

    const prompt = `你是角色「${agent.name}」。你今天在自主研习中深入学习了以下素材（来自 ${item.sourceName}）：
【你的角色人设与专属研习透镜】：
${agentContext}

【原始素材信息】：
标题：《${item.title}》
作者/UP主: ${item.author || '网络'}
主要分类：${assessment.category || '通识知识'}
核心摘要：${assessment.summary}

【素材完整内容 / 分章提炼全文】:
${materialBody}

【你的研习重构任务】：
请将这份素材深度消化，整理为一篇**既有扎实原文证据、又极具「${agent.name}」个人特色**的 Markdown 研习笔记，存入你的专属知识库。

【铁律与写作准则】：
1. **事实与证据纪律**：只总结输入中确实出现的内容，绝不把推测写成事实；必须保留原文中的关键数字、配方比例、实验条件、具体案例和专业术语。
2. **深度脱水与纠错**：彻底剔除口语语气词（“啊、呢、首先声明不是广”）、主播寒暄、求三连投币等噪音；自动修正语音识别（ASR）可能出现的同音错字或英文专有名词拼写。
3. **鲜明的角色特色**：行文视角必须贴合「${agent.name}」的性格口吻与专业定位（${agent.studyLens}），但这篇笔记是你的核心知识资产，干货密度必须极高，不能写空洞的抒情水文。
4. **严格使用以下 5 大固定二级标题结构输出**（不要输出一级标题 #，不要输出代码块围栏）：

## 角色研习导读与核心结论
以你（「${agent.name}」）的第一人称口吻与专业视角，用 2~4 句话说明该内容解决什么核心问题、最重要的结论是什么，以及它为什么值得你收入知识库。

## 关键知识点与原文证据
使用编号列表（1. 2. 3. ...），列出 3~8 个可验证的核心知识点；每一项必须包含「**核心概念/结论** + **具体原理解析** + **原文/字幕证据**（引述原文的具体数据、案例或条件支撑）」。

## 方法论与实操步骤
按逻辑顺序列出原文中的具体操作步骤、实践技巧、参数配置或案例推导脉络；若原文不包含操作步骤，则梳理其核心分析框架，缺失部分不要凭空补写。

## 易错点与边界条件
列出原文明确提到的限制条件、风险、常见误区或避坑指南；如果原文未提及相关限制，请如实写“原文未专门说明边界限制”。

## 专属融合：角色应用与复习自测
- **在「${agent.name}」场景中的应用**：说明在后续与用户的对话、陪伴或专业协助中，你会在什么场景下如何主动运用这份知识；
- **一句话复习**：用符合你角色性格的一句话浓缩全文精华，便于日后快速检索唤醒；
- **自测思考题**：基于本文最核心的机制提出 1 个问题，并附上简明准确的参考解答。`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `你是角色「${agent.name}」的知识内化引擎。你严格忠于原文事实与数据证据，同时以「${agent.name}」独有的人设视角与专业透镜产出结构闭环的高质量 Markdown 研习笔记。`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    });

    const result = cleanSynthesizedMarkdown(response.choices?.[0]?.message?.content || '');
    if (result && result.length > 100) {
      return result;
    }
  } catch (err: any) {
    console.warn('[AgentStudy] Synthesize knowledge document failed:', err?.message);
  }
  return null;
}
