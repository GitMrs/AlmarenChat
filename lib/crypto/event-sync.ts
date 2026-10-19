import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  type CryptoEvent,
  type EventImpactRecord,
  loadGlobalCryptoEvents,
  reloadGlobalCryptoEvents,
} from './event-temporal.ts';
import { smartFetch } from '../network/proxy.ts';

const JSON_PATH = fileURLToPath(new URL('./crypto-events.json', import.meta.url));

// 常用宏观指标的官方中英文对照与交易指引映射 (统一明晰标注发布时区: 美东 ET / 北京时间 UTC+8 / UTC)
export const MACRO_DICTIONARY = [
  {
    pattern: /cpi/i,
    chineseTitle: '美国CPI消费者物价指数(BLS官方通胀锚)',
    guidance: {
      bullishCondition: '若实际值低于预期，降息预期大幅升温，利好加密风险资产突破',
      bearishCondition: '若实际值超预期反弹，通胀粘性担忧加剧，谨防假突破诱多后急跌',
      riskInstruction: '美东时间 08:30 (夏令时北京时间 20:30 / UTC 12:30；冬令时北京时间 21:30 / UTC 13:30) 公布，前后15分钟强制禁止新开高杠杆仓位',
    },
    tier: 3 as const,
  },
  {
    pattern: /adp/i,
    chineseTitle: '美国ADP就业人数变动(小非农/NER Pulse)',
    guidance: {
      bullishCondition: '就业增速平稳回落，强化软着陆降息预期，利好风险资产',
      bearishCondition: '就业意外大幅过热推迟宽松，或断崖暴跌引发衰退担忧',
      riskInstruction: '美东时间 08:15 (夏令时北京时间 20:15 / UTC 12:15；冬令时北京时间 21:15 / UTC 13:15) 公布。注：该周度高频数据(NER Pulse)不提供官方一致预期(forecast: null)，仅供大非农前瞻参考，不建议作为独立开仓信号。',
    },
    tier: 3 as const,
  },
  {
    pattern: /non-farm|nfp|employment change/i,
    chineseTitle: '美国非农就业人口变动(NFP)及失业率',
    guidance: {
      bullishCondition: '就业温和放缓符合软着陆预期，强化流动性充裕预期',
      bearishCondition: '就业数据过热推迟宽松，或失业率异动引发衰退恐慌',
      riskInstruction: '美东时间 08:30 (夏令时北京时间 20:30 / UTC 12:30；冬令时北京时间 21:30 / UTC 13:30) 公布，瞬时脉冲极大，挂单止损需拉开足够安全垫',
    },
    tier: 3 as const,
  },
  {
    pattern: /federal funds rate|fomc/i,
    chineseTitle: '美联储 FOMC 利率决议及鲍威尔新闻发布会',
    guidance: {
      bullishCondition: '决议降息或鲍威尔表态温和偏鸽，全网风险偏好提振普涨',
      bearishCondition: '意外放鹰或强调长期维持高利率，谨防去杠杆瀑布',
      riskInstruction: '美东时间 14:00 (夏令时北京时间次日 02:00 / UTC 18:00；冬令时北京时间次日 03:00 / UTC 19:00) 决议出炉，半小时后鲍威尔发布会，为极端波动窗口，严禁入场',
    },
    tier: 3 as const,
  },
  {
    pattern: /ppi/i,
    chineseTitle: '美国PPI生产者物价指数(通胀先行指标)',
    guidance: {
      bullishCondition: '生产端通胀放缓，预示后续CPI回落，利好行情企稳',
      bearishCondition: '生产端成本上升，通胀传导担忧升温，压制多头动能',
      riskInstruction: '美东时间 08:30 (夏令时北京时间 20:30 / UTC 12:30；冬令时北京时间 21:30 / UTC 13:30) 公布，作为CPI前瞻参考，注意分时冲高回落',
    },
    tier: 2 as const,
  },
  {
    pattern: /pce/i,
    chineseTitle: '美国核心PCE物价指数(美联储首选通胀锚)',
    guidance: {
      bullishCondition: '核心PCE稳步向2%目标靠拢，加息周期彻底终结，利好多头',
      bearishCondition: '核心PCE反弹停滞，货币政策转向迟滞，防范阴跌',
      riskInstruction: '美东时间 08:30 (夏令时北京时间 20:30 / UTC 12:30；冬令时北京时间 21:30 / UTC 13:30) 公布，美股开盘阶段易出现剧烈博弈，严控杠杆',
    },
    tier: 3 as const,
  },
  {
    pattern: /gdp/i,
    chineseTitle: '美国实际GDP年化季率(经济增长概况)',
    guidance: {
      bullishCondition: 'GDP稳健增长消除衰退担忧，基本面支撑风险市场',
      bearishCondition: 'GDP大幅不及预期引发硬着陆担忧，避险情绪升温',
      riskInstruction: '美东时间 08:30 (夏令时北京时间 20:30 / UTC 12:30；冬令时北京时间 21:30 / UTC 13:30) 公布，终值与初值修正差异较大时易出现瞬时扫盘',
    },
    tier: 2 as const,
  },
  {
    pattern: /powell/i,
    chineseTitle: '美联储主席鲍威尔公开讲话',
    guidance: {
      bullishCondition: '讲话口吻偏软、肯定去通胀进程，提振市场多头信心',
      bearishCondition: '强调抗通胀未结束、警告市场过度乐观，谨防鹰派重击',
      riskInstruction: '讲话期间字字珠玑，算法高频抢跑频繁，不宜市价单开仓',
    },
    tier: 3 as const,
  },
  {
    pattern: /unemployment claims/i,
    chineseTitle: '美国当周初请失业金人数',
    guidance: {
      bullishCondition: '初请数据符合预期范围，劳动力市场平稳',
      bearishCondition: '数据异动激增或锐减，引发短期避险情绪波动',
      riskInstruction: '美东时间周四 08:30 (夏令时北京时间 20:30 / UTC 12:30；冬令时北京时间 21:30 / UTC 13:30) 公布，顺应既有趋势为主',
    },
    tier: 2 as const,
  },
  {
    pattern: /retail sales/i,
    chineseTitle: '美国核心零售销售月率(恐怖数据)',
    guidance: {
      bullishCondition: '消费支出温和增长未失速，化解硬着陆忧虑，利好风险情绪',
      bearishCondition: '零售数据暴跌引发通缩/衰退恐慌，或大幅过热引发鹰派反扑',
      riskInstruction: '美东时间 08:30 (夏令时北京时间 20:30 / UTC 12:30；冬令时北京时间 21:30 / UTC 13:30) 公布，素有恐怖数据之称，短线剧烈洗盘',
    },
    tier: 2 as const,
  },
  {
    pattern: /flash.*pmi|s&p.*pmi/i,
    chineseTitle: '美国 S&P Global 制造业/服务业采购经理人指数 (Flash PMI 初值)',
    guidance: {
      bullishCondition: 'PMI 站稳荣枯线 50 上方扩张，经济基本面健康支撑资产估值',
      bearishCondition: 'PMI 深度跌入收缩区间，衰退预期骤升，避险资产受捧',
      riskInstruction: '美东时间 09:45 (夏令时北京时间 21:45 / UTC 13:45) 由标普全球 (S&P Global / 原 Markit) 发布初值，美股早盘时段共振波动',
    },
    tier: 2 as const,
  },
  {
    pattern: /^ism\b|ism.*pmi/i,
    chineseTitle: '美国 ISM 采购经理人景气度指数(PMI)',
    guidance: {
      bullishCondition: 'ISM 处于荣枯线 50 上方，制造业/服务业扩张支撑宏观基本面',
      bearishCondition: 'ISM 大幅滑落跌入萎缩区间，加剧硬着陆衰退忧虑',
      riskInstruction: '美东时间 10:00 (夏令时北京时间 22:00 / UTC 14:00) 由美国供应管理学会 (ISM) 在月初发布，属于月度核心景气指标',
    },
    tier: 2 as const,
  },
  {
    pattern: /consumer sentiment|michigan/i,
    chineseTitle: '美国密歇根大学消费者信心及通胀预期终值(Final)',
    guidance: {
      bullishCondition: '信心终值稳健且 1 年期通胀预期下行，提供完美宏观温床',
      bearishCondition: '通胀预期终值意外上窜，推迟降息节奏，压制币圈估值',
      riskInstruction: '美东时间 10:00 (夏令时北京时间 22:00 / UTC 14:00) 由密歇根大学在月末发布官方终值 (Final)，重点留意通胀预期分项终值修正',
    },
    tier: 2 as const,
  },
];

export interface RawCalendarItem {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast?: string;
  previous?: string;
}

// 内存 5 分钟缓存，防止短时间内高频连续请求触发上游 Cloudflare 429 限流
let calendarCache: { data: RawCalendarItem[]; expiresAt: number } | null = null;

/**
 * 从 FairEconomy (ForexFactory 官方公开无鉴权 JSON 数据源) 拉取本周真实经济日历
 */
export async function fetchLiveForexFactoryCalendar(forceFresh = false): Promise<RawCalendarItem[]> {
  const now = Date.now();
  if (!forceFresh && calendarCache && calendarCache.expiresAt > now) {
    return calendarCache.data;
  }

  const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

  // 使用系统双轨智能请求助手 smartFetch（本地直连优先，若遇限流/网络阻断自动无缝切换代理重试）
  const res = await smartFetch(url, {
    prefer: 'direct-first',
    timeoutMs: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (!res.ok) {
    if (res.status === 429 && calendarCache) {
      console.warn('[event-sync] 上游 429 限流，降级返回上一份有效缓存');
      return calendarCache.data;
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const rawEvents = (await res.json()) as RawCalendarItem[];
  if (!Array.isArray(rawEvents)) {
    throw new Error('返回的日历数据非数组结构');
  }

  calendarCache = {
    data: rawEvents,
    expiresAt: now + 5 * 60 * 1000, // 5 分钟缓存
  };

  return rawEvents;
}

/**
 * 将原始英文外汇日历清洗、过滤为适合加密合约作战室的 CryptoEvent
 * ⚠️ 严格防范：只收录 country === 'USD'，绝不将非美国家（英镑GBP、新西兰元NZD、加元CAD等）通胀数据误标为美国CPI
 */
export function transformToCryptoEvents(rawEvents: RawCalendarItem[]): CryptoEvent[] {
  const transformed: CryptoEvent[] = [];

  for (const item of rawEvents) {
    // 1. 严格过滤：必须是 USD 货币事件（宏观锚定唯一基准）
    if (item.country !== 'USD') continue;

    // 规范化标题与名称处理
    let normalizedTitle = item.title;
    // 修正外汇日历中密歇根大学将“Final (终值)”错标为“Revised (修正值)”的非标准命名
    if (/revised.*uom.*consumer sentiment/i.test(normalizedTitle)) {
      normalizedTitle = normalizedTitle.replace(/revised/i, 'Final');
    }

    // 2. 匹配宏观词典
    const matchedMeta = MACRO_DICTIONARY.find((dict) => dict.pattern.test(normalizedTitle));
    const isHighImpact = item.impact === 'High';
    const isMediumImpact = item.impact === 'Medium';

    // 仅收录高影响或命中核心宏观关键词的项目
    if (!isHighImpact && !matchedMeta) continue;

    const isoDate = new Date(item.date).toISOString();
    const cleanDateStr = isoDate.slice(0, 10);
    const slug = normalizedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const id = `macro-${slug}-${cleanDateStr}`;

    // 针对特定分项微调中文标题（例如明确标普 S&P Global 制造业 vs 服务业 Flash PMI，彻底与月初的 ISM 区分）
    let chineseName = matchedMeta ? matchedMeta.chineseTitle : `美国重点财经事件: ${normalizedTitle}`;
    if (/flash manufacturing pmi/i.test(normalizedTitle)) {
      chineseName = '美国 S&P Global 制造业采购经理人指数 (Flash PMI)';
    } else if (/flash services pmi/i.test(normalizedTitle)) {
      chineseName = '美国 S&P Global 服务业采购经理人指数 (Flash PMI)';
    } else if (/final uom consumer sentiment/i.test(normalizedTitle)) {
      chineseName = '美国密歇根大学消费者信心及通胀预期终值 (Final)';
    }

    const volTier = matchedMeta ? matchedMeta.tier : isHighImpact ? 3 : isMediumImpact ? 2 : 1;

    const guidance = matchedMeta?.guidance || {
      bullishCondition: '若数据利好美元流动性宽松，利好大盘风险资产',
      bearishCondition: '若数据偏紧，引发紧缩预期，谨防冲高回落',
      riskInstruction: '数据发布前后15分钟内市场流动性剧震，严禁市价追单',
    };

    // 严格规范 forecast / previous: 无预期时显式标为 null (如下游 ADP NER Pulse 周度高频数据无官方预期)
    const forecastVal = item.forecast && item.forecast.trim() ? item.forecast.trim() : null;
    const previousVal = item.previous && item.previous.trim() ? item.previous.trim() : null;

    transformed.push({
      id,
      title: `${chineseName} (${normalizedTitle})`,
      category: 'macro',
      country: 'USD',
      timestamp: isoDate,
      impactCoins: ['ALL'],
      volatilityTier: volTier,
      preAlertHours: volTier === 3 ? 24 : 4,
      postDigestHours: 6,
      forecast: forecastVal,
      previous: previousVal,
      guidance,
    });
  }

  return transformed;
}

/**
 * 增量合并到本地 crypto-events.json（保护已沉淀的实战 impact 影响复盘，不被覆盖）
 */
export async function mergeEventsIntoJson(newEvents: CryptoEvent[]) {
  let existing: CryptoEvent[] = [];
  try {
    const content = await readFile(JSON_PATH, 'utf8');
    existing = JSON.parse(content);
  } catch (err: any) {
    console.warn('[event-sync] 未读取到现有文件，将使用新数据');
  }

  const existingMap = new Map<string, CryptoEvent>(existing.map((e) => [e.id, e]));

  // 剔除已更正或作废的历史旧 ID，防范残留重复
  const DEPRECATED_LEGACY_IDS = new Set([
    'macro-revised-uom-consumer-sentiment-2026-10-23',
    'fomc-2026-11-06',
    'macro-cpi-m-m-2026-10-19',
    'macro-median-cpi-y-y-2026-10-19',
    'macro-trimmed-cpi-y-y-2026-10-19',
    'macro-cpi-y-y-2026-10-21',
    'macro-cpi-q-q-2026-10-21',
  ]);
  for (const depId of DEPRECATED_LEGACY_IDS) {
    existingMap.delete(depId);
  }

  let addedCount = 0;
  let updatedCount = 0;

  for (const event of newEvents) {
    if (existingMap.has(event.id)) {
      const oldEvent = existingMap.get(event.id)!;
      // 保留已有的实战复盘记录 (impact)，绝不覆盖
      existingMap.set(event.id, {
        ...event,
        impact: oldEvent.impact || event.impact,
      });
      updatedCount++;
    } else {
      existingMap.set(event.id, event);
      addedCount++;
    }
  }

  // 按时间升序排序
  const mergedList = Array.from(existingMap.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  await writeFile(JSON_PATH, JSON.stringify(mergedList, null, 2), 'utf8');
  reloadGlobalCryptoEvents(mergedList);

  return { total: mergedList.length, addedCount, updatedCount, events: mergedList };
}

/**
 * 一键拉取与同步真实经济日历
 */
export async function syncMacroEvents() {
  const raw = await fetchLiveForexFactoryCalendar();
  const events = transformToCryptoEvents(raw);
  const result = await mergeEventsIntoJson(events);
  return { ...result, fetchedRawCount: raw.length, filteredCount: events.length };
}

/**
 * 【数据闭环核心】：将事件落地后的真实盘面走势与实战复盘持久化回填进 crypto-events.json
 */
export async function persistEventImpact(
  eventId: string,
  impact?: EventImpactRecord
): Promise<boolean> {
  const globalEvents = loadGlobalCryptoEvents();
  const target = globalEvents.find((e) => e.id === eventId);
  if (!target) return false;

  target.impact = impact;

  try {
    await writeFile(JSON_PATH, JSON.stringify(globalEvents, null, 2), 'utf8');
    reloadGlobalCryptoEvents(globalEvents);
    return true;
  } catch (err: any) {
    console.warn('[event-sync] Failed to write back event impact to crypto-events.json:', err?.message);
    return false;
  }
}
