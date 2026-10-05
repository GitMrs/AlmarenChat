import { smartFetch } from '@/lib/network/proxy';
import { getSourceConfig, TRENDING_SOURCES } from './sources';
import { parseBaidu, parseBilibili, parseDailyHot, parseDouHotlist, parse36Kr, parseZhihu, parseRssFeed, parseBinanceArticles, parseOkxAnnouncements, parseOkxOrbitHtml, parseBlockBeatsHtml, parseForesightHtml } from './parsers';
import { isSnapshotFresh, readSnapshot, saveSnapshot, getLocalISODate } from './storage';
import type { NormalizedHotItem, TrendingSnapshot, TrendingSourceConfig } from './types';

const FETCH_TIMEOUT_MS = 6000;

// 真实主流浏览器 User-Agent 指纹池（涵盖 Chrome、Edge、Safari、Firefox 多系统）
const USER_AGENT_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
];

export function getRandomUserAgent(): string {
  const index = Math.floor(Math.random() * USER_AGENT_POOL.length);
  return USER_AGENT_POOL[index];
}

export function getRealisticHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'User-Agent': getRandomUserAgent(),
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    ...extra,
  };
}

async function fetchRemoteItems(config: TrendingSourceConfig): Promise<NormalizedHotItem[]> {
  try {
    let data: any;

    if (config.type === '36kr') {
      const res = await smartFetch(config.url, {
        method: 'POST',
        prefer: 'direct-first',
        headers: getRealisticHeaders({
          'Content-Type': 'application/json;charset=UTF-8',
        }),
        body: JSON.stringify({
          partner_id: 'web',
          timestamp: Date.now(),
          param: { siteId: 1, platformId: 2, pageSize: 20, pageEvent: 0, pageCallback: '' },
        }),
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      return parse36Kr(data);
    }

    if (config.type === 'dailyhot') {
      // 默认本地直连优先，若受阻自动切换代理重试
      const res = await smartFetch(config.url, {
        prefer: 'direct-first',
        headers: getRealisticHeaders(),
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      return parseDailyHot(data, config.id, config.name);
    }

    if (config.type === 'binance') {
      const res = await smartFetch(config.url, {
        prefer: 'direct-first',
        headers: getRealisticHeaders({ lang: 'zh-CN' }),
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return parseBinanceArticles(json);
    }

    if (config.type === 'okx') {
      const isOrbit = config.url.includes('orbit');
      const res = await smartFetch(config.url, {
        prefer: 'direct-first',
        headers: getRealisticHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9' }),
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (isOrbit) {
        const html = await res.text();
        const items = parseOkxOrbitHtml(html);
        if (items.length > 0) return items;
      } else {
        const json = await res.json();
        return parseOkxAnnouncements(json);
      }
    }

    if (config.type === 'rss') {
      const res = await smartFetch(config.url, {
        prefer: 'direct-first',
        headers: getRealisticHeaders(),
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      return parseRssFeed(xml, config.id, config.name);
    }

    if (config.type === 'blockbeats') {
      const flashUrl = 'https://www.theblockbeats.info/newsflash';
      const artUrl = 'https://www.theblockbeats.info/article';

      const fetchPage = async (targetUrl: string) => {
        try {
          const res = await smartFetch(targetUrl, {
            prefer: 'direct-first',
            headers: getRealisticHeaders(),
            timeoutMs: FETCH_TIMEOUT_MS,
          });
          if (res.ok) return await res.text();
        } catch {}
        return '';
      };

      const [flashHtml, artHtml] = await Promise.all([
        fetchPage(flashUrl),
        fetchPage(artUrl),
      ]);

      const items = parseBlockBeatsHtml(flashHtml, artHtml);
      if (items.length > 0) return items;
    }

    if (config.type === 'foresight') {
      const newsUrl = 'https://foresightnews.pro/news';
      const artUrl = 'https://foresightnews.pro/article';

      const fetchPage = async (targetUrl: string) => {
        try {
          const res = await smartFetch(targetUrl, {
            prefer: 'direct-first',
            headers: getRealisticHeaders(),
            timeoutMs: FETCH_TIMEOUT_MS,
          });
          if (res.ok) return await res.text();
        } catch {}
        return '';
      };

      const [newsHtml, artHtml] = await Promise.all([
        fetchPage(newsUrl),
        fetchPage(artUrl),
      ]);

      const items = parseForesightHtml(newsHtml, artHtml);
      if (items.length > 0) return items;
    }

    // 全网热搜默认均走本地网络直连优先，失败时无缝由代理重试接管
    const res = await smartFetch(config.url, {
      prefer: 'direct-first',
      headers: getRealisticHeaders(),
      timeoutMs: FETCH_TIMEOUT_MS,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    data = await res.json();

    switch (config.type) {
      case 'zhihu':
        return parseZhihu(data);
      case 'weibo':
      case 'toutiao':
        return parseDouHotlist(data, config.id, config.name);
      case 'bilibili':
        return parseBilibili(data);
      case 'baidu':
        return parseBaidu(data);
      default:
        return [];
    }
  } catch (err: any) {
    throw err;
  }
}

export async function getTrendingSnapshot(
  sourceId: string,
  options?: { forceRefresh?: boolean; ttlMs?: number; date?: string }
): Promise<TrendingSnapshot> {
  const config = getSourceConfig(sourceId);
  if (!config) {
    throw new Error(`Unsupported trending source: "${sourceId}". Supported: ${TRENDING_SOURCES.map((s) => s.id).join(', ')}`);
  }

  // 0. 历史时光机归档查询（只读且不发起远端爬取）
  const isHistorical = options?.date && options.date !== 'today' && options.date !== getLocalISODate();
  if (isHistorical) {
    const historicalSnapshot = await readSnapshot(sourceId, { date: options.date });
    if (historicalSnapshot && historicalSnapshot.items) {
      return {
        ...historicalSnapshot,
        category: config.category,
        categoryName: config.categoryName,
        icon: config.icon,
      };
    }
    return {
      source: config.id,
      sourceName: config.name,
      category: config.category,
      categoryName: config.categoryName,
      icon: config.icon,
      updatedAt: `${options.date}T23:59:59+08:00`,
      total: 0,
      items: [],
    };
  }

  const cached = await readSnapshot(sourceId);

  // 1. 如果缓存新鲜且未要求强刷，直接返回磁盘数据 (0ms)
  if (!options?.forceRefresh && isSnapshotFresh(cached, options?.ttlMs)) {
    return {
      ...cached!,
      category: config.category,
      categoryName: config.categoryName,
      icon: config.icon,
    };
  }

  // 2. 尝试从远端拉取最新数据
  try {
    const items = await fetchRemoteItems(config);
    if (items.length > 0) {
      const freshSnapshot: TrendingSnapshot = {
        source: config.id,
        sourceName: config.name,
        category: config.category,
        categoryName: config.categoryName,
        icon: config.icon,
        updatedAt: new Date().toISOString(),
        total: items.length,
        items,
      };
      // 异步落盘，不阻塞后续响应
      await saveSnapshot(freshSnapshot);
      return freshSnapshot;
    }
  } catch (err: any) {
    console.warn(`[trending-service] Fetch failed for ${sourceId}: ${err?.message || err}. Falling back to cache.`);
  }

  // 3. 降级容灾：若拉取失败但有旧缓存，返回旧缓存
  if (cached && cached.items && cached.items.length > 0) {
    return {
      ...cached,
      category: config.category,
      categoryName: config.categoryName,
      icon: config.icon,
    };
  }

  // 4. 最底线保底返回
  return {
    source: config.id,
    sourceName: config.name,
    category: config.category,
    categoryName: config.categoryName,
    icon: config.icon,
    updatedAt: new Date().toISOString(),
    total: 0,
    items: [],
  };
}

export function getAvailableSources(): TrendingSourceConfig[] {
  return TRENDING_SOURCES.filter((s) => s.enabled !== false);
}

/**
 * 将热榜条目格式化为适合注入 Agent System Prompt / 上下文的 Markdown
 */
export function formatTrendingForPrompt(
  snapshot: TrendingSnapshot,
  options?: { limit?: number; includeDesc?: boolean }
): string {
  const limit = options?.limit || 8;
  const includeDesc = options?.includeDesc ?? true;
  const items = (snapshot.items || []).slice(0, limit);

  if (items.length === 0) {
    return `【今日实时热榜（${snapshot.sourceName}）】\n暂无可用热点数据。`;
  }

  const lines = [
    `【今日实时热榜参考（${snapshot.sourceName}）】`,
    `更新时间：${new Date(snapshot.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    '---',
  ];

  items.forEach((item, index) => {
    const heatText = item.heat ? `（热度/讨论：${item.heat}）` : '';
    lines.push(`${index + 1}. 《${item.title}》${heatText}`);
    if (includeDesc && item.desc) {
      const cleanDesc = item.desc.replace(/\s+/g, ' ').slice(0, 100);
      lines.push(`   背景简述：${cleanDesc}...`);
    }
    if (item.url) {
      lines.push(`   原文链接：${item.url}`);
    }
  });

  lines.push('---');
  lines.push('说明：以上是现实世界当下正在发生的真实热榜。若用户向你提问热点、资讯、或需要以此展开讨论、创作、观点碰撞，请以此为客观事实依据，并结合你自身独特鲜明的性格口吻进行回应。');

  return lines.join('\n');
}

/**
 * 智能检测用户消息中是否表达了想获取热点、热搜、新闻的意图
 */
export function detectTrendingIntent(message: string): { wantsTrending: boolean; preferredSource?: string } {
  if (!message || typeof message !== 'string') return { wantsTrending: false };

  const normalized = message.toLowerCase().replace(/\s+/g, '');

  const trendingVerbs = ['热', '榜', '话题', '消息', '新闻', '新鲜事', '动态', '讨论', '都在聊', '怎么看', '最近', '发生', '瓜', '大事', '有啥', '什么'];
  const hasTrendingFlavor = (platform: string) => {
    return normalized.includes(platform) && trendingVerbs.some((verb) => normalized.includes(verb));
  };

  // 匹配特定源
  if (hasTrendingFlavor('知乎')) {
    return { wantsTrending: true, preferredSource: 'zhihu' };
  }
  if (hasTrendingFlavor('微博')) {
    return { wantsTrending: true, preferredSource: 'weibo' };
  }
  if (hasTrendingFlavor('百度')) {
    return { wantsTrending: true, preferredSource: 'baidu' };
  }
  if (hasTrendingFlavor('b站') || hasTrendingFlavor('哔哩哔哩') || normalized.includes('bilibili')) {
    return { wantsTrending: true, preferredSource: 'bilibili' };
  }
  if (hasTrendingFlavor('头条') || normalized.includes('今日头条')) {
    return { wantsTrending: true, preferredSource: 'toutiao' };
  }
  if (hasTrendingFlavor('36氪') || normalized.includes('36kr') || normalized.includes('科技新闻') || normalized.includes('创投')) {
    return { wantsTrending: true, preferredSource: '36kr' };
  }
  if (hasTrendingFlavor('虎扑')) {
    return { wantsTrending: true, preferredSource: 'hupu' };
  }
  if (hasTrendingFlavor('贴吧')) {
    return { wantsTrending: true, preferredSource: 'tieba' };
  }
  if (hasTrendingFlavor('it之家') || normalized.includes('ithome')) {
    return { wantsTrending: true, preferredSource: 'ithome' };
  }
  if (hasTrendingFlavor('掘金')) {
    return { wantsTrending: true, preferredSource: 'juejin' };
  }
  if (hasTrendingFlavor('少数派') || normalized.includes('sspai')) {
    return { wantsTrending: true, preferredSource: 'sspai' };
  }
  if (hasTrendingFlavor('微信读书') || normalized.includes('读书榜')) {
    return { wantsTrending: true, preferredSource: 'weread' };
  }
  if (hasTrendingFlavor('豆瓣') || normalized.includes('电影榜')) {
    return { wantsTrending: true, preferredSource: 'douban-movie' };
  }
  if (normalized.includes('原神')) {
    return { wantsTrending: true, preferredSource: 'genshin' };
  }

  // 通用热点意图词
  const genericKeywords = [
    '今天有什么热搜',
    '今天有什么大新闻',
    '网上在讨论什么',
    '有什么热点',
    '看下热榜',
    '今日热搜',
    '今日热点',
    '现在的热搜',
    '热搜榜',
    '今日早报',
    '最近有什么大新闻',
    '发生了什么大事',
    '最近有什么热门',
    '全网热搜',
    '全网热点',
    '实时热搜',
    '大家都在聊什么',
  ];

  const matched = genericKeywords.some((kw) => normalized.includes(kw));
  if (matched) {
    return { wantsTrending: true, preferredSource: 'all' }; // 聚合知乎 + 微博 + 百度
  }

  return { wantsTrending: false };
}

/**
 * 跨平台聚合热搜快照：提取知乎、微博、百度等前列热点，给 Agent 形成全网综合全景
 */
export async function getCompositeTrendingSnapshot(
  sourceIds: string[] = ['zhihu', 'weibo', 'baidu']
): Promise<TrendingSnapshot> {
  const snapshots = await Promise.all(
    sourceIds.map(async (id) => {
      try {
        return await getTrendingSnapshot(id);
      } catch {
        return null;
      }
    })
  );
  const valid = snapshots.filter(Boolean) as TrendingSnapshot[];
  const combinedItems: NormalizedHotItem[] = [];
  valid.forEach((s) => {
    (s.items || []).slice(0, 4).forEach((item) => {
      combinedItems.push({
        ...item,
        title: `[${s.sourceName}] ${item.title}`,
      });
    });
  });

  return {
    source: 'all',
    sourceName: '全网多平台精选热搜',
    updatedAt: new Date().toISOString(),
    total: combinedItems.length,
    items: combinedItems,
  };
}
