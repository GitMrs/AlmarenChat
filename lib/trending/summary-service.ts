import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createModelClient, resolveModelName } from '../model-client';
import { getTrendingSnapshot, getAvailableSources } from './service';
import { getSourcesByCategory } from './sources';
import { getLocalISODate } from './storage';
import type { TrendingCategory } from './types';

const TRENDING_DIR = path.join(process.cwd(), 'data', 'trending');
const SUMMARY_TTL_MS = 30 * 60 * 1000; // 实时总结缓存 30 分钟

export interface DistilledContextResult {
  distilledText: string;
  totalRawItems: number;
  sampleCount: number;
  dateLabel: string;
}

export interface SummaryResult {
  summary: string;
  cached: boolean;
  updatedAt: string;
  date: string;
  category: string;
  sampleCount: number;
}

/**
 * 结构化数据脱水与分层抽样算法：
 * 将 21 平台 500+ 条原始数据，高效精简为 30~35 条高浓度单行文本
 */
export async function distillTrendingContext(options?: {
  date?: string;
  category?: TrendingCategory | 'all';
}): Promise<DistilledContextResult> {
  const queryDate = options?.date || 'today';
  const category = options?.category || 'all';
  const isHistorical = queryDate !== 'today' && queryDate !== getLocalISODate();
  const dateLabel = isHistorical ? `${queryDate} 历史归档` : '今日全网实时';

  let targetSources = getAvailableSources();
  if (category !== 'all') {
    targetSources = getSourcesByCategory(category);
  }

  // 1. 并发获取目标源快照
  const snapshots = await Promise.all(
    targetSources.map(async (src) => {
      try {
        const snap = await getTrendingSnapshot(src.id, { date: queryDate });
        return { ...snap, sourceName: src.name, category: src.category };
      } catch {
        return null;
      }
    })
  );

  const validSnapshots = snapshots.filter((s) => s && s.items && s.items.length > 0);
  let totalRawCount = 0;
  validSnapshots.forEach((s) => {
    totalRawCount += s?.items?.length || 0;
  });

  // 2. 分层权重抽样（核心大众源多取，垂类源取头部）
  const sampledLines: string[] = [];

  for (const snap of validSnapshots) {
    if (!snap) continue;
    let takeCount = 3;

    // 核心综合大众源权重提升
    if (['zhihu', 'weibo'].includes(snap.source)) {
      takeCount = category === 'all' ? 5 : 6;
    } else if (['baidu', 'toutiao'].includes(snap.source)) {
      takeCount = category === 'all' ? 4 : 5;
    } else if (['36kr', 'bilibili'].includes(snap.source)) {
      takeCount = 3;
    } else {
      takeCount = category === 'all' ? 2 : 4;
    }

    const items = snap.items.slice(0, takeCount);
    for (const item of items) {
      const cleanTitle = item.title.replace(/\s+/g, ' ').trim();
      const heatPart = item.heat ? ` (热度:${item.heat})` : '';
      let descPart = '';
      if (item.desc) {
        const cleanDesc = item.desc
          .replace(/\[图片\]/g, '')
          .replace(/\[视频\]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 50);
        if (cleanDesc) descPart = ` | 背景：${cleanDesc}`;
      }
      sampledLines.push(`[${snap.sourceName}] 《${cleanTitle}》${heatPart}${descPart}`);
    }
  }

  // 如果总数依然过多，截断在 35 条以内，保证绝对不超 1500 Tokens
  const finalSamples = sampledLines.slice(0, 35);
  const distilledText = finalSamples.join('\n');

  return {
    distilledText,
    totalRawItems: totalRawCount,
    sampleCount: finalSamples.length,
    dateLabel,
  };
}

/**
 * 获取或生成全网智能汇总（带本地智能缓存）
 */
export async function getOrGenerateTrendingSummary(options?: {
  date?: string;
  category?: TrendingCategory | 'all';
  forceRefresh?: boolean;
  apiBaseUrl?: string | null;
  apiKey?: string | null;
  modelName?: string | null;
}): Promise<SummaryResult> {
  const queryDate = options?.date || 'today';
  const category = options?.category || 'all';
  const isHistorical = queryDate !== 'today' && queryDate !== getLocalISODate();
  const todayStr = getLocalISODate();

  // 1. 缓存路径计算
  const cacheDir = isHistorical
    ? path.join(TRENDING_DIR, 'history', queryDate)
    : TRENDING_DIR;
  const cacheFilePath = path.join(cacheDir, `summary_${category}.json`);

  // 2. 尝试从磁盘读取现有缓存
  if (!options?.forceRefresh) {
    try {
      const content = await readFile(cacheFilePath, 'utf8');
      const cached = JSON.parse(content);
      if (cached && cached.summary) {
        // 历史数据永久有效；今日数据如果在有效期内直接返回
        const isFresh = isHistorical || (Date.now() - new Date(cached.updatedAt).getTime() < SUMMARY_TTL_MS);
        if (isFresh) {
          return {
            summary: cached.summary,
            cached: true,
            updatedAt: cached.updatedAt,
            date: queryDate,
            category,
            sampleCount: cached.sampleCount || 30,
          };
        }
      }
    } catch {
      // 缓存未命中，继续生成
    }
  }

  // 3. 执行数据脱水与上下文蒸馏
  const { distilledText, sampleCount, dateLabel } = await distillTrendingContext({
    date: queryDate,
    category,
  });

  if (!distilledText.trim()) {
    return {
      summary: `【${dateLabel}】当前分类暂无足够的热点数据，请稍后刷新或切换其他日期查看。`,
      cached: false,
      updatedAt: new Date().toISOString(),
      date: queryDate,
      category,
      sampleCount: 0,
    };
  }

  // 4. 构建紧凑的高密度 Prompt（区分全网综合与加密Web3垂直赛道）
  const isCrypto = category === 'crypto';
  const roleTitle = isCrypto
    ? '你是一位敏锐的资深全球 Web3 与加密市场宏观投资总监'
    : '你是一位敏锐的资深全网舆情情报总编与商业趋势分析师';

  const briefTitle = isCrypto ? '全球加密市场与Web3热点情报' : '全网热点全景情报';
  const firstSection = isCrypto
    ? '### 🌟 市场核心定调\n（用 1~2 句话点出今日大盘主情绪基调、宏观资金风向或恐慌贪婪偏向）'
    : '### 🌟 全网核心定调\n（用 1~2 句话点出今天/该日全网最大的核心风向与公众情绪基调）';

  const secondSection = isCrypto
    ? '### 🔥 核心热点主线\n（归纳 3 条关键主线，例如：1. 🟡 交易所动态与上币催化 / 2. 🏛️ 宏观政策、ETF与机构动向 / 3. ⚡ 链上叙事与突发事件；每条用 2~3 句话串联具体事件并指出背后资金或监管脉络）'
    : '### 🔥 核心舆论主线\n（归纳 3 条关键主线，例如：1. 💡 科技前沿与智能浪潮 / 2. 🚗 假期民生与生活消费 / 3. 🎬 文娱热点与社会心态；每条主线用 2~3 句话串联具体事件并指出背后脉络）';

  const thirdSection = isCrypto
    ? '### 💡 交易员与从业者洞察\n（提炼 1~2 点中短期深层规律、风险提示或给普通投资者与Web3建设者的战略启示）'
    : '### 💡 独家洞察与反思\n（提炼 1~2 点深层规律、消费/社交观念转向或对普通人与从业者的启发）';

  const prompt = `${roleTitle}。
以下是【${dateLabel}】从主流渠道（${isCrypto ? '律动 BlockBeats、Foresight News、欧易星球热议、CoinTelegraph 等' : '知乎、微博、百度、36氪、B站等'}）提炼出的核心事件（共 ${sampleCount} 条代表动态）：

${distilledText}

请你从宏观全局视角，输出一份言简意赅、见解深刻的【${briefTitle}】。
请严格按以下三段式 Markdown 结构输出，语言犀利、专业、直击本质，严禁打官腔套话：

${firstSection}

${secondSection}

${thirdSection}`;

  // 5. 调用大模型
  const client = createModelClient(options?.apiBaseUrl, options?.apiKey);
  const model = resolveModelName(options?.modelName);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: '你是一个顶尖的全网情报分析大脑，擅长在纷繁杂乱的热搜数据中抽丝剥茧，提炼极具洞察力的结构化简报。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.6,
    max_tokens: 1200,
  });

  const generatedSummary = completion.choices?.[0]?.message?.content?.trim() || '暂无提炼结果';
  const now = new Date().toISOString();

  // 6. 异步写入缓存落盘（历史归档一次写入永久有效；今日写入半小时缓存）
  try {
    await mkdir(cacheDir, { recursive: true });
    const cachePayload = {
      summary: generatedSummary,
      date: queryDate,
      category,
      updatedAt: now,
      sampleCount,
    };
    await writeFile(cacheFilePath, JSON.stringify(cachePayload, null, 2), 'utf8');
  } catch (err: any) {
    console.warn('[trending-summary] Failed to write cache:', err?.message);
  }

  return {
    summary: generatedSummary,
    cached: false,
    updatedAt: now,
    date: queryDate,
    category,
    sampleCount,
  };
}
