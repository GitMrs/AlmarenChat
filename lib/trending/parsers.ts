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
