import { createModelClient, resolveModelName } from '@/lib/model-client';
import type { AgentStudyItem } from './types';
import {
  normalizeContentKind,
  type StudyContentAssessment,
} from './content-kind';

const ASSESS_TIMEOUT_MS = 30_000;
const MAX_CONTENT_PER_ITEM = 6_000;

export interface AssessStudyContentsOptions {
  agent: {
    name: string;
    category?: string | null;
    description?: string | null;
    tone?: string | null;
    systemPrompt?: string | null;
  };
  items: Array<{ item: AgentStudyItem; content: string }>;
  modelConfig?: {
    apiBaseUrl?: string;
    apiKey?: string;
    modelName?: string;
  };
}

function buildAssessPrompt(options: AssessStudyContentsOptions) {
  const agentDesc = [
    `角色名称: ${options.agent.name}`,
    options.agent.category ? `所属分类/领域: ${options.agent.category}` : '',
    options.agent.tone ? `说话口吻: ${options.agent.tone}` : '',
    options.agent.description ? `角色背景: ${options.agent.description.slice(0, 300)}` : '',
    options.agent.systemPrompt ? `人设规则: ${options.agent.systemPrompt.slice(0, 300)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const contents = options.items
    .map(
      ({ item, content }, index) => `【候选内容 ${index + 1}】
ID: ${item.id}
来源平台: ${item.sourceName} (${item.source})
标题: 《${item.title}》
作者/UP主: ${item.author || '未知'}
当前角色感悟: ${item.thoughts || ''}
已提炼摘要: ${item.summary || ''}
正文/字幕内容:
${content.slice(0, MAX_CONTENT_PER_ITEM)}
`
    )
    .join('\n');

  return `你是一个专业的角色知识鉴别官。角色「${options.agent.name}」今天研读了以下内容。
【当前角色人设与定位】：
${agentDesc}

请为「${options.agent.name}」逐条判断内容类型，并严格输出 JSON（不要输出 markdown 代码块以外的任何说明）：

【核心把关原则（严把知识库大门，绝不是每篇都要，必须真有高价值）】：
1. 知识库是角色核心专业资产。只有同时满足以下条件才能定为 "knowledge"（沉淀入库）：
   - 具备长期、系统的方法论、深度实践指南、实用技能体系或扎实结论；
   - 真正与「${options.agent.name}」的专业领域或角色成长契合，能真正丰富 TA 面对用户时的专业背景或技能储备；
   - 信息密度高、干货明确，绝不是博主随口聊天的口水碎碎念或营销引流。
2. 以下情况一律定为 "news" 或 "opinion"（仅作为今日见闻经历，严禁污染知识库）：
   - 博主个人生活杂谈、主观情绪发泄、流水账日记、浅显的随笔体验；
   - 时效性资讯、产品发布会、行情涨跌、八卦娱乐、盘点推荐；
   - 缺乏体系结构、没有可操作步骤或方法论的内容。
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
 * 角色深度知识萃取器（深度结合当前 Agent 人设）：
 * 绝不直接把原始口语音频字幕或网页爬虫生搬硬套塞进知识库！
 * 由当前 Agent 以自身专业视角进行深度吸收与重构：
 * 1. 彻底剔除口语语气词、主播寒暄、求关注/点赞投币等噪音；
 * 2. 纠正语音识别（ASR）错别字；
 * 3. 注入角色独特专业视角，组织成结构完整、条理严密的专业 Markdown：
 *    - ## 角色研习视角与核心价值解读
 *    - ## 系统化方法论与核心操作步骤（详述要领）
 *    - ## 实操技巧与常见误区（避坑指南）
 *    - ## 在我角色职能中的应用场景与总结
 * 4. 行文必须完整闭环，严禁半截断！
 */
export async function synthesizeKnowledgeDocument(options: {
  agent: {
    name: string;
    category?: string | null;
    description?: string | null;
    tone?: string | null;
    systemPrompt?: string | null;
  };
  item: AgentStudyItem;
  assessment: StudyContentAssessment;
  rawContent: string;
  modelConfig?: {
    apiBaseUrl?: string;
    apiKey?: string;
    modelName?: string;
  };
}): Promise<string | null> {
  const { agent, item, assessment, rawContent, modelConfig } = options;
  if (!rawContent || rawContent.trim().length < 80) return null;

  try {
    const client = createModelClient(modelConfig?.apiBaseUrl, modelConfig?.apiKey, {
      timeoutMs: ASSESS_TIMEOUT_MS,
      maxRetries: 1,
    });
    const model = resolveModelName(modelConfig?.modelName);

    const agentContext = [
      `角色名称: ${agent.name}`,
      agent.category ? `所属类别: ${agent.category}` : '',
      agent.tone ? `说话口吻: ${agent.tone}` : '',
      agent.description ? `人物定位: ${agent.description}` : '',
      agent.systemPrompt ? `人设规则: ${agent.systemPrompt.slice(0, 300)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const prompt = `你是角色「${agent.name}」。你今天在自主研习中摄入了以下素材（来自 ${item.sourceName}）：
【你的角色人设背景】：
${agentContext}

【原始素材信息】：
标题：《${item.title}》
作者/UP主: ${item.author || '网络'}
主要分类：${assessment.category || '通识知识'}
核心摘要：${assessment.summary}

【素材原文 / 视频字幕全文】:
${rawContent.slice(0, 6000)}

【你的研习重构任务】：
请绝对不要直接复制或截取原文/字幕流水账！
请以你的角色身份与专业视角，将这段素材深度消化萃取为一篇高质量、高信息密度、排版优雅规范的 Markdown 研习笔记，存入你的专属知识库。

【写作准则】：
1. 彻底去除所有口语语气词（“啊、呢、吧、首先声明不是广”）、主播寒暄、求关注/点赞投币等噪音。
2. 纠正语音识别（ASR）可能存在的同音错别字或专有名词英文错误（如 deep stick 改正为 DeepSeek 等）。
3. 结合你的人设视角与定位，组织成清晰的多层级 Markdown 结构：
   ## 角色研习视角与核心价值解读（以你的口吻说明为什么这个知识对你和用户很有价值、你关注的初衷）
   ## 系统化实践方案与核心步骤（客观详述，分条列出扎实的操作要领，去除口语）
   ## 实操技巧与常见误区（避坑指南）
   ## 在我角色职能中的应用场景（在以后的对话或为用户服务中，你将如何运用这些经验）
4. 全文内容必须结构完整，逻辑严密，行文必须自然收尾闭环，绝对严禁在半句中间截断！
5. 直接输出正文 Markdown（从二级标题 ## 开始，开头不需要重复一级标题），不要输出任何前言后语。`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `你正在扮演角色「${agent.name}」，将学习到的素材以自己的专业视角深度萃取为体系化专业知识笔记。`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    });

    const result = response.choices?.[0]?.message?.content?.trim();
    if (result && result.length > 100) {
      return result;
    }
  } catch (err: any) {
    console.warn('[AgentStudy] Synthesize knowledge document failed:', err?.message);
  }
  return null;
}
