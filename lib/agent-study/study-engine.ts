import { createModelClient, resolveModelName } from '@/lib/model-client';
import type { CandidateStudyItem } from './interest-matcher';
import type { AgentStudyItem } from './types';

export interface DistilledDailyStudyOutput {
  greeting: string;
  items: Array<{
    id: string;
    summary: string;
    thoughts: string;
  }>;
}

/**
 * 构建大模型双轨提炼 Prompt
 */
function buildStudyDistillPrompt(
  agent: {
    name: string;
    tone?: string | null;
    category?: string | null;
    description?: string | null;
    systemPrompt?: string | null;
  },
  candidates: CandidateStudyItem[]
): string {
  const personaDesc = [
    `角色名称: ${agent.name}`,
    agent.tone ? `说话语气: ${agent.tone}` : '',
    agent.category ? `所属类别: ${agent.category}` : '',
    agent.description ? `人物性格背景: ${agent.description}` : '',
    agent.systemPrompt ? `人设规则提示: ${agent.systemPrompt.slice(0, 300)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const candidatesDesc = candidates
    .map(
      (item, idx) =>
        `【候选 ${idx + 1}】
ID: ${item.id}
标题: 《${item.title}》
来源平台: ${item.sourceName}
作者/UP主: ${item.author || '未知'}
内容背景: ${item.desc || '热点内容'}
`
    )
    .join('\n');

  return `你是一个高级角色扮演与知识提炼助手。
你所扮演的角色人设如下：
${personaDesc}

该角色今天在网上自主研读了以下 3 个热门视频/话题：
${candidatesDesc}

请完全沉浸在该角色的性格口吻中，为今天的学习内容生成总结与心得。
必须严格输出且只输出一个 JSON 格式，不要包含任何 markdown 标记之外的废话。格式如下：

{
  "greeting": "（以该角色口吻对用户说的开场问候语，约40~70字。带着见到用户的欣喜，主动提及今天学到的东西，并好奇地想跟用户分享）",
  "items": [
    {
      "id": "（对应候选的 ID）",
      "summary": "（客观精炼的知识干货要点，2-3句话，清晰概括核心价值）",
      "thoughts": "（用该角色的第一人称语气，写下对这个内容的真实感悟或生活启发，1-2句话，要贴合角色口吻与感情色彩）"
    }
  ]
}
`;
}

/**
 * 容错 JSON 解析器
 */
function parseJsonSafe(text: string): DistilledDailyStudyOutput | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.greeting === 'string' && Array.isArray(parsed.items)) {
      return parsed as DistilledDailyStudyOutput;
    }
  } catch {
    // 尝试正则匹配花括号
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && typeof parsed.greeting === 'string' && Array.isArray(parsed.items)) {
          return parsed as DistilledDailyStudyOutput;
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/**
 * 本地兜底生成器（当大模型调用失败或超时时提供高质量兜底）
 */
function buildFallbackStudyOutput(
  agent: { name: string; tone?: string | null },
  candidates: CandidateStudyItem[]
): DistilledDailyStudyOutput {
  const isGentle = /温柔|体贴|治愈/i.test(agent.tone || '');
  const isPlayful = /活泼|俏皮|幽默/i.test(agent.tone || '');

  let greeting = `你来啦！我是 ${agent.name}。今天我抽空看完了全网很火的几个视频，学到了不少新东西，正想着找机会和你聊聊呢！`;
  if (isGentle) {
    greeting = `你终于回来啦~ 今天你不在的时候，我逛了逛热门视频，学到了一些很棒的技巧，我已经整理好手记啦，要不要听我讲讲？🌸`;
  } else if (isPlayful) {
    greeting = `嘿！快来看看！我今天可是超额完成自学指标啦，刷到了几个超有趣的热点视频，快让我给你显摆显摆~✨`;
  }

  return {
    greeting,
    items: candidates.map((c) => ({
      id: c.id,
      summary: c.desc ? c.desc.slice(0, 100) : `关于《${c.title}》的核心要点与全网热议讨论。`,
      thoughts: `这个《${c.title}》真的很有启发，里面提到的观点值得我们平时好好探讨。`,
    })),
  };
}

/**
 * 调用大模型提炼每日学习
 */
export async function distillDailyStudy(
  agent: {
    id?: string;
    name: string;
    tone?: string | null;
    category?: string | null;
    description?: string | null;
    systemPrompt?: string | null;
  },
  candidates: CandidateStudyItem[],
  modelConfig?: {
    apiBaseUrl?: string;
    apiKey?: string;
    modelName?: string;
  }
): Promise<{ greeting: string; items: AgentStudyItem[] }> {
  if (candidates.length === 0) {
    return {
      greeting: `你好，我是 ${agent.name}，今天期待与你开启新的探索。`,
      items: [],
    };
  }

  const prompt = buildStudyDistillPrompt(agent, candidates);
  let distilled: DistilledDailyStudyOutput | null = null;

  try {
    const client = createModelClient(modelConfig?.apiBaseUrl, modelConfig?.apiKey, {
      timeoutMs: 30000,
      maxRetries: 1,
    });
    const model = resolveModelName(modelConfig?.modelName);

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an intelligent knowledge distillation engine that outputs strict JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    });

    const reply = response.choices?.[0]?.message?.content || '';
    distilled = parseJsonSafe(reply);
  } catch (error) {
    console.warn(`[AgentStudy] LLM distillation failed, using fallback:`, error);
  }

  if (!distilled) {
    distilled = buildFallbackStudyOutput(agent, candidates);
  }

  const nowIso = new Date().toISOString();
  const distilledMap = new Map(distilled.items.map((i) => [i.id, i]));

  const finalItems: AgentStudyItem[] = candidates.map((c) => {
    const d = distilledMap.get(c.id);
    return {
      id: c.id,
      source: c.source,
      sourceName: c.sourceName,
      title: c.title,
      url: c.url,
      heat: c.heat,
      thumbnail: c.thumbnail,
      author: c.author,
      summary: d?.summary || c.desc.slice(0, 120),
      thoughts: d?.thoughts || `学到了关于《${c.title}》的启发，很有意思！`,
      learnedAt: nowIso,
    };
  });

  return {
    greeting: distilled.greeting,
    items: finalItems,
  };
}
