import vm from 'node:vm';
import type { NormalizedHotItem } from './types';

export function parseZhihu(data: any): NormalizedHotItem[] {
  if (!data?.data || !Array.isArray(data.data)) return [];

  return data.data.map((item: any, index: number) => {
    const target = item.target || {};

    // 关键修复：知乎问题 ID 是 19 位超大整数（如 2089638530678875180）
    // JSON.parse 解析大整数会触发 JS Number (Float64) 精度丢失，导致末尾数位被进位取整变成 404 错误链接！
    // 优先从原始字符串属性 card_id ("Q_2089638530678875180") 或 target.url 中精准提取绝对精确的字符串 ID
    let qId = '';
    if (typeof item.card_id === 'string' && item.card_id.startsWith('Q_')) {
      qId = item.card_id.replace(/^Q_/, '');
    } else if (typeof target.url === 'string') {
      const match = target.url.match(/questions?\/(\d+)/);
      if (match) qId = match[1];
    }
    if (!qId && target.id) {
      qId = String(target.id);
    }

    const questionUrl = qId
      ? `https://www.zhihu.com/question/${qId}`
      : (typeof target.url === 'string' ? target.url.replace('api.zhihu.com/questions', 'www.zhihu.com/question') : '');
    const thumbnail = item.children?.[0]?.thumbnail || '';
    const cleanDesc = (target.excerpt || '').replace(/\[图片\]/g, '').replace(/\[视频\]/g, '').trim();

    return {
      id: `zhihu-${qId || index}`,
      source: 'zhihu',
      sourceName: '知乎',
      title: (target.title || '').trim(),
      url: questionUrl,
      heat: item.detail_text || '',
      desc: cleanDesc,
      thumbnail,
      extra: {
        answerCount: target.answer_count,
        created: target.created,
      },
    };
  }).filter((item: NormalizedHotItem) => item.title.length > 0);
}

export function parse36Kr(data: any): NormalizedHotItem[] {
  const itemList = data?.data?.itemList;
  if (!itemList || !Array.isArray(itemList)) return [];

  return itemList.map((item: any, index: number) => {
    const mat = item.templateMaterial || {};
    const id = item.itemId ? String(item.itemId) : `36kr-${index}`;
    const title = (mat.widgetTitle || '').trim();
    const content = (mat.widgetContent || '').trim();
    const url = item.itemId ? `https://36kr.com/newsflashes/${item.itemId}` : 'https://36kr.com/newsflashes';

    return {
      id: `36kr-${id}`,
      source: '36kr',
      sourceName: '36氪',
      title,
      url,
      heat: '实时快讯',
      desc: content,
    };
  }).filter((item: NormalizedHotItem) => item.title.length > 0);
}

export function parseDouHotlist(data: any, sourceId: string, sourceName: string): NormalizedHotItem[] {
  if (!data?.data || !Array.isArray(data.data)) return [];

  return data.data.map((item: any, index: number) => {
    const title = (item.title || item.word || '').trim();
    const heat = item.hot ? `${item.hot}` : '';
    const url = item.url || item.mobilUrl || '';

    return {
      id: `${sourceId}-${item.index ?? index}`,
      source: sourceId,
      sourceName,
      title,
      url,
      heat,
      desc: item.desc || '',
    };
  }).filter((item: NormalizedHotItem) => item.title.length > 0);
}

export function parseDailyHot(data: any, sourceId: string, sourceName: string): NormalizedHotItem[] {
  const list = data?.data;
  if (!list || !Array.isArray(list)) return [];

  return list.map((item: any, index: number) => {
    const itemId = item.id ? String(item.id) : `${sourceId}-${index}`;
    const heat = item.hot ? String(item.hot) : '';
    return {
      id: `${sourceId}-${itemId}`,
      source: sourceId,
      sourceName,
      title: (item.title || item.word || '').trim(),
      url: item.url || item.mobileUrl || '',
      heat,
      desc: (item.desc || '').trim(),
      thumbnail: item.pic || item.cover || '',
    };
  }).filter((item: NormalizedHotItem) => item.title.length > 0);
}

export function parseBilibili(data: any): NormalizedHotItem[] {
  const list = data?.data?.list;
  if (!list || !Array.isArray(list)) return [];

  return list.map((item: any, index: number) => {
    const bvid = item.bvid || `bv-${index}`;
    const reason = item.rcmd_reason?.content || '';
    const viewCount = item.stat?.view ? `${Math.round(item.stat.view / 10000)}万播放` : '';
    const heat = reason || viewCount;

    return {
      id: `bilibili-${bvid}`,
      source: 'bilibili',
      sourceName: 'B站',
      title: (item.title || '').trim(),
      url: `https://www.bilibili.com/video/${bvid}`,
      heat,
      desc: (item.desc || '').trim(),
      thumbnail: item.pic || '',
      extra: {
        owner: item.owner?.name,
        view: item.stat?.view,
        like: item.stat?.like,
      },
    };
  }).filter((item: NormalizedHotItem) => item.title.length > 0);
}

export function parseBaidu(data: any): NormalizedHotItem[] {
  try {
    const cards = data?.data?.cards;
    if (!cards || !Array.isArray(cards)) return [];

    const innerList = cards[0]?.content?.[0]?.content;
    if (!innerList || !Array.isArray(innerList)) return [];

    return innerList.map((item: any, index: number) => {
      const heat = item.hotScore ? `${item.hotScore}分` : '';
      return {
        id: `baidu-${index}`,
        source: 'baidu',
        sourceName: '百度',
        title: (item.word || '').trim(),
        url: item.url || '',
        heat,
        desc: (item.desc || '').trim(),
        thumbnail: item.img || '',
        extra: {
          isTop: Boolean(item.isTop),
        },
      };
    }).filter((item: NormalizedHotItem) => item.title.length > 0);
  } catch {
    return [];
  }
}

/**
 * 通用 XML/RSS 资讯提炼解析器（支持 CoinTelegraph, CoinDesk 等）
 */
export function parseRssFeed(xmlText: string, sourceId: string, sourceName: string): NormalizedHotItem[] {
  if (!xmlText || typeof xmlText !== 'string') return [];

  const items: NormalizedHotItem[] = [];
  const itemRegex = /<item[\s\S]*?>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = itemRegex.exec(xmlText)) !== null && items.length < 30) {
    idx++;
    const content = match[1];

    const titleMatch = content.match(/<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i);
    const linkMatch = content.match(/<link>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/link>/i);
    const descMatch = content.match(/<description>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/description>/i);
    const pubDateMatch = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    const mediaMatch =
      content.match(/<media:content[^>]+url=["']([^"']+)["']/i) ||
      content.match(/<enclosure[^>]+url=["']([^"']+)["']/i) ||
      content.match(/<img[^>]+src=["']([^"']+)["']/i);

    const title = (titleMatch?.[1] || titleMatch?.[2] || '').trim();
    const link = (linkMatch?.[1] || linkMatch?.[2] || '').trim();
    let desc = (descMatch?.[1] || descMatch?.[2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (desc.length > 200) desc = desc.slice(0, 200) + '...';

    if (title) {
      items.push({
        id: `${sourceId}-${idx}`,
        source: sourceId,
        sourceName,
        title,
        url: link,
        desc,
        heat: '最新要闻',
        thumbnail: mediaMatch?.[1] || '',
        extra: {
          pubDate: pubDateMatch?.[1] || '',
        },
      });
    }
  }

  return items;
}

/**
 * 币安官方要闻与新币上线解析器
 */
export function parseBinanceArticles(data: any): NormalizedHotItem[] {
  const articles = data?.data?.articles;
  if (!articles || !Array.isArray(articles)) return [];

  return articles
    .map((item: any, index: number) => {
      const title = (item.title || '').trim();
      const code = item.code || '';
      const url = code
        ? `https://www.binance.com/zh-CN/support/announcement/${code}`
        : 'https://www.binance.com/zh-CN/support/announcement';

      return {
        id: `binance-${item.id || index}`,
        source: 'binance',
        sourceName: '币安资讯',
        title,
        url,
        heat: '官方要闻',
        desc: '币安官方最新上币、合约与产品重磅动态',
        thumbnail: item.imageLink || '',
      };
    })
    .filter((item: NormalizedHotItem) => item.title.length > 0);
}

/**
 * 欧易 OKX 星球热门话题 (OKX Orbit Topics) 解析器
 * 解析官方网页上的热门代币议题、ETF动向与宏观分析
 */
export function parseOkxOrbitHtml(html: string): NormalizedHotItem[] {
  if (!html || typeof html !== 'string') return [];

  const items: NormalizedHotItem[] = [];
  const cardRegex = /<a[^>]*href="(\/zh-hans\/orbit\/topic\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = cardRegex.exec(html)) !== null && items.length < 30) {
    idx++;
    const link = 'https://www.okx.com' + match[1];
    const raw = match[2];
    const titleMatch = raw.match(/<h[1-6][^>]*>#?<!-- -->?([\s\S]*?)<\/h[1-6]>/i);
    const descMatch = raw.match(/<p[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // 提取关联代币及涨跌幅 (如 BTC +2.14%)
    const tokens: string[] = [];
    const tokenRegex = /tokenName-[^"]*">([^<]+)<\/span>\s*<span[^>]*class="[^"]*">([^<]+)<\/span>/g;
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tokenRegex.exec(raw)) !== null) {
      tokens.push(`${tMatch[1]} (${tMatch[2]})`);
    }

    // 提取背景图片
    const bgImgMatch = raw.match(/background-image:url\(([^)]+)\)/i);
    const thumbnail = bgImgMatch ? bgImgMatch[1].replace(/["']/g, '') : '';

    if (title) {
      const formattedTitle = title.startsWith('#') ? title : `#${title}#`;
      const heatLabel = tokens.length > 0 ? tokens.join(' · ') : '星球高热';
      items.push({
        id: `okx-orbit-${idx}`,
        source: 'okx',
        sourceName: '欧易星球热议',
        title: formattedTitle,
        url: link,
        heat: heatLabel,
        desc: desc || 'OKX 星球最热门话题，汇聚社区讨论、代币洞察与实时加密大事件',
        thumbnail,
        extra: {
          tokens,
        },
      });
    }
  }

  return items;
}

/**
 * 欧易 OKX 官方公告与生态快讯解析器
 */
export function parseOkxAnnouncements(data: any): NormalizedHotItem[] {
  const details = data?.data?.[0]?.details || data?.data;
  if (!details || !Array.isArray(details)) return [];

  return details
    .map((item: any, index: number) => {
      const title = (item.title || '').trim();
      const url = item.url || (item.annUrl ? item.annUrl : 'https://www.okx.com/help');

      return {
        id: `okx-${index}`,
        source: 'okx',
        sourceName: '欧易公告',
        title,
        url,
        heat: '官方快讯',
        desc: '欧易OKX官方最新产品上线、活动福利与生态通知',
        extra: {
          pTime: item.pTime,
        },
      };
    })
    .filter((item: NormalizedHotItem) => item.title.length > 0);
}

function safeNuxtParse(html?: string): any {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/window\.__NUXT__\s*=\s*([\s\S]*?);<\/script>/);
  if (!match) return null;
  try {
    return vm.runInNewContext(match[1], {}, { timeout: 1500 });
  } catch (err) {
    console.warn('[trending] Nuxt sandbox parse failed:', err);
    return null;
  }
}

/**
 * 律动 BlockBeats 实时快讯与深度要闻解析器
 */
export function parseBlockBeatsHtml(flashHtml?: string, articleHtml?: string): NormalizedHotItem[] {
  const items: NormalizedHotItem[] = [];

  if (flashHtml) {
    const d = safeNuxtParse(flashHtml);
    const days = d?.data?.[0]?.days || [];
    for (const day of days) {
      for (const c of (day.children || [])) {
        if (!c.title) continue;
        const cleanDesc = (c.content || '').replace(/<[^>]+>/g, '').replace(/BlockBeats 消息[，,]?\s*/g, '').trim();
        items.push({
          id: `bb-flash-${c.id}`,
          source: 'blockbeats',
          sourceName: '律动 BlockBeats',
          title: c.title.trim(),
          url: c.url || (`https://www.theblockbeats.info/flash/${c.id}`),
          desc: cleanDesc || '律动实时快讯',
          heat: c.is_hot ? '🔥 热门快讯' : c.is_first ? '⚡ 首发快讯' : '快讯',
          thumbnail: c.img_url || c.c_img_url || undefined,
          extra: {
            timestamp: (c.add_time || 0) * 1000,
          },
        });
      }
    }
  }

  if (articleHtml) {
    const d = safeNuxtParse(articleHtml);
    const list = d?.data?.[0]?.list || [];
    for (const a of list) {
      if (!a.title) continue;
      const tags = Array.isArray(a.tag_list) ? a.tag_list.filter(Boolean) : [];
      items.push({
        id: `bb-art-${a.article_id || a.id}`,
        source: 'blockbeats',
        sourceName: '律动 BlockBeats',
        title: a.title.trim(),
        url: `https://www.theblockbeats.info/article/${a.article_id || a.id}`,
        desc: (a.abstract || '').trim() || '律动深度行业专栏研报',
        heat: '📰 深度' + (tags.length ? ` · ${tags.slice(0, 2).join('/')}` : ''),
        thumbnail: a.img_url || a.c_img_url || undefined,
        extra: {
          timestamp: (a.add_time || 0) * 1000,
        },
      });
    }
  }

  return items
    .sort((a, b) => (b.extra?.timestamp || 0) - (a.extra?.timestamp || 0))
    .slice(0, 30);
}

/**
 * Foresight News 实时快讯与深度研报解析器
 */
export function parseForesightHtml(newsHtml?: string, articleHtml?: string): NormalizedHotItem[] {
  const items: NormalizedHotItem[] = [];

  if (newsHtml) {
    const d = safeNuxtParse(newsHtml);
    const list = d?.data?.[0]?.list || [];
    for (const day of list) {
      for (const n of (day.news || [])) {
        if (!n.title) continue;
        const tagStr = Array.isArray(n.tags) ? n.tags.map((t: any) => t.name).filter(Boolean).slice(0, 2).join(' · ') : '';
        let heat = n.important_tag?.name
          ? `🔥 ${n.important_tag.name}`
          : n.is_important
          ? '🔥 重点要闻'
          : tagStr || '快讯';

        const cleanDesc = (n.brief || n.content || '').replace(/<[^>]+>/g, '').replace(/Foresight News 消息[，,]?\s*/g, '').trim();

        items.push({
          id: `fn-news-${n.id}`,
          source: 'foresight',
          sourceName: 'Foresight News',
          title: n.title.trim(),
          url: n.source_link || `https://foresightnews.pro/news/detail/${n.id}`,
          desc: cleanDesc || 'Foresight News 实时要闻追踪',
          heat,
          thumbnail: n.img || undefined,
          extra: {
            timestamp: (n.published_at || 0) * 1000,
          },
        });
      }
    }
  }

  if (articleHtml) {
    const d = safeNuxtParse(articleHtml);
    const list = d?.data?.[0]?.list || [];
    for (const a of list) {
      if (!a.title) continue;
      const tagStr = Array.isArray(a.tags) ? a.tags.map((t: any) => t.name).filter(Boolean).slice(0, 2).join(' · ') : '';
      items.push({
        id: `fn-art-${a.id || a.link || Math.random()}`,
        source: 'foresight',
        sourceName: 'Foresight News',
        title: a.title.trim(),
        url: a.link || `https://foresightnews.pro/article/detail/${a.id}`,
        desc: (a.brief || '').trim() || 'Foresight 独家深度研报',
        heat: '📰 研报' + (tagStr ? ` · ${tagStr}` : ''),
        thumbnail: a.img || undefined,
        extra: {
          timestamp: Date.now() - 3600000,
        },
      });
    }
  }

  return items
    .sort((a, b) => (b.extra?.timestamp || 0) - (a.extra?.timestamp || 0))
    .slice(0, 30);
}



