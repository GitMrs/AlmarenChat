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
    options.agent.category ? `角色类别: ${options.agent.category}` : '',
    options.agent.description ? `角色背景: ${options.agent.description.slice(0, 200)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const contents = options.items
    .map(
      ({ item, content }, index) => `【内容 ${index + 1}】
ID: ${item.id}
来源: ${item.sourceName} (${item.source})
标题: 《${item.title}》
角色已写摘要: ${item.summary}
正文:
${content.slice(0, MAX_CONTENT_PER_ITEM)}
`
    )
    .join('\n');

  return `你是一个知识鉴别助手。角色「${options.agent.name}」今天研读了以下内容。
${agentDesc}

请逐条判断内容类型，并严格输出 JSON（不要输出 markdown 代码块以外的任何说明）：

分类规则：
- knowledge：可复用的知识（原理、方法、工具用法、教程、可长期成立的结论）。换一个时间/对象仍然成立。
- news：有时效性的资讯、事件、发布、价格/股价变动。过期即失效。
- opinion：评价、观点、情绪、娱乐、二创、明星/游戏活动。
- personal_fact：与角色或用户相关、跨天仍成立的稳定事实（例如“用户喜欢 XX”）。

输出格式：
{
  "items": [
    {
      "id": "对应 ID",
      "contentKind": "knowledge | news | opinion | personal_fact",
      "category": "技术 | 产品 | 商业 | 生活 | 健康 | 文化 | 教育 | 其他",
      "title": "知识标题（仅 knowledge/personal_fact 需要，其他留空）",
      "summary": "2-3 句客观摘要；personal_fact 时写成一句可长期记忆的事实",
      "keyPoints": ["最多 4 条关键要点，仅 knowledge 需要"],
      "confidence": 0.0
    }
  ]
}

判断不确定时一律选择 news（宁可只做见闻，也不要污染知识库）。

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
