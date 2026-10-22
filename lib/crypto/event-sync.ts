import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  type CryptoEvent,
  type EventImpactRecord,
  reloadGlobalCryptoEvents,
} from './event-temporal.ts';
import { smartFetch } from '../web/proxy.ts';
import { EVENT_MARKET_INSTRUMENT, getEventMarketResult, type EventMarketObservation, type EventMarketWindow } from './event-market.ts';

// 与 CLI 共用项目数据文件，不能使用打包后 import.meta.url 指向的静态副本。
const JSON_PATH = path.join(process.cwd(), 'lib', 'crypto', 'crypto-events.json');
const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

// 常用宏观指标的系统中文名与交易指引映射（评级和指引均非来源原文）
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
    chineseTitle: '美国ADP月度就业人数变动(小非农)',
    guidance: {
      bullishCondition: '就业增速平稳回落，强化软着陆降息预期，利好风险资产',
      bearishCondition: '就业意外大幅过热推迟宽松，或断崖暴跌引发衰退担忧',
      riskInstruction: '月度 ADP 为私营部门就业报告，与周度高频数据分开观察；公布时刻以日历为准，不宜单独作为非农结果的预测。',
    },
    tier: 3 as const,
  },
  {
    pattern: /non-farm|nfp|employment change/i,
    chineseTitle: '美国非农就业人口变动(NFP)',
    guidance: {
      bullishCondition: '就业温和放缓符合软着陆预期，强化流动性充裕预期',
      bearishCondition: '就业数据过热推迟宽松，或失业率异动引发衰退恐慌',
      riskInstruction: '美东时间 08:30 (夏令时北京时间 20:30 / UTC 12:30；冬令时北京时间 21:30 / UTC 13:30) 公布，瞬时脉冲极大，挂单止损需拉开足够安全垫',
    },
    tier: 3 as const,
  },
  {
    pattern: /federal funds rate|fomc/i,
    chineseTitle: '美联储 FOMC 事件',
    guidance: {
      bullishCondition: '政策信号偏向宽松或措辞偏鸽，可能提振风险偏好',
      bearishCondition: '政策信号偏向收紧或强调长期高利率，留意去杠杆风险',
      riskInstruction: '利率决议、会议纪要、经济预测与新闻发布会为不同事件，各自以日历所列公布时刻为准，注意声明与问答阶段的波动。',
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
    chineseTitle: '美国PCE物价指数',
    guidance: {
      bullishCondition: 'PCE通胀放缓可能提振宽松预期，需区分整体与核心分项',
      bearishCondition: 'PCE通胀反弹可能延缓宽松，需结合预期差判断',
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
    chineseTitle: '美国零售销售',
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
    pattern: /uom|consumer sentiment|michigan/i,
    chineseTitle: '美国密歇根大学调查',
    guidance: {
      bullishCondition: '消费者信心企稳或通胀预期回落，可能改善风险偏好',
      bearishCondition: '消费者信心走弱或通胀预期上升，可能压制风险偏好',
      riskInstruction: '消费者信心和通胀预期为不同分项，初值与修正值分开观察；公布时刻以日历为准。',
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
let calendarCache: { data: RawCalendarItem[]; expiresAt: number; fetchedAt: string } | null = null;

/**
 * 从 FairEconomy / ForexFactory 聚合源拉取本周经济日历（非统计机构直连）
 */
export async function fetchLiveForexFactoryCalendar(forceFresh = false): Promise<RawCalendarItem[]> {
  const now = Date.now();
  if (!forceFresh && calendarCache && calendarCache.expiresAt > now) {
    return calendarCache.data;
  }

  // 使用系统双轨智能请求助手 smartFetch（本地直连优先，若遇限流/网络阻断自动无缝切换代理重试）
  const res = await smartFetch(CALENDAR_URL, {
    prefer: 'direct-first',
    timeoutMs: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const rawEvents = (await res.json()) as RawCalendarItem[];
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    throw new Error('返回的日历为空或非数组结构，保留现有数据');
  }
  // 完整快照用于清理改期记录，任何损坏行都应中止同步，不能当作事件撤下。
  for (const item of rawEvents) {
    if (!item || typeof item.title !== 'string' || typeof item.country !== 'string' ||
        typeof item.impact !== 'string' || typeof item.date !== 'string' ||
        !Number.isFinite(Date.parse(item.date))) {
      throw new Error('日历行缺少有效名称、评级或公布时间，保留现有数据');
    }
  }

  calendarCache = {
    data: rawEvents,
    expiresAt: now + 5 * 60 * 1000, // 5 分钟缓存
    fetchedAt: new Date().toISOString(),
  };

  return rawEvents;
}

/**
 * 返回该公布时刻所属的美东日历周（周日起）。
 */
function calendarWeek(timestamp: string): string {
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp));
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

/** 只收录 USD 重点事件，保留来源名称与评级，避免其他国家数据被标为美国指标。 */
export function transformToCryptoEvents(rawEvents: RawCalendarItem[], fetchedAt = new Date().toISOString()): CryptoEvent[] {
  const transformed: CryptoEvent[] = [];

  for (const item of rawEvents) {
    // 1. 严格过滤：必须是 USD 货币事件（宏观锚定唯一基准）
    if (item.country !== 'USD') continue;

    const normalizedTitle = item.title.trim();

    // 2. 匹配宏观词典
    const matchedMeta = MACRO_DICTIONARY.find((dict) => dict.pattern.test(normalizedTitle));
    const isHighImpact = item.impact === 'High';
    const isMediumImpact = item.impact === 'Medium';

    // 仅收录高影响或命中核心宏观关键词的项目
    if (!isHighImpact && !matchedMeta) continue;

    if (!Number.isFinite(Date.parse(item.date))) throw new Error(`无效公布时间：${item.title}`);
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
    } else if (/uom|michigan/i.test(normalizedTitle)) {
      const variant = /prelim/i.test(normalizedTitle) ? '初值' : /revised/i.test(normalizedTitle) ? '修正值' : /final/i.test(normalizedTitle) ? '终值' : '';
      chineseName = `美国密歇根大学${/inflation expectations/i.test(normalizedTitle) ? '通胀预期' : '消费者信心'}${variant}`;
    } else if (/retail sales/i.test(normalizedTitle)) {
      chineseName = /core/i.test(normalizedTitle) ? '美国核心零售销售' : '美国零售销售';
    } else if (/pce/i.test(normalizedTitle)) {
      chineseName = /core/i.test(normalizedTitle) ? '美国核心PCE物价指数' : '美国PCE物价指数';
    } else if (/fomc|federal funds rate/i.test(normalizedTitle)) {
      chineseName = /minutes/i.test(normalizedTitle) ? '美联储 FOMC 会议纪要'
        : /press conference/i.test(normalizedTitle) ? '美联储 FOMC 新闻发布会'
        : /projections/i.test(normalizedTitle) ? '美联储 FOMC 经济预测'
        : /statement/i.test(normalizedTitle) ? '美联储 FOMC 政策声明'
        : /federal funds rate/i.test(normalizedTitle) ? '美联储利率决议' : chineseName;
    } else if (/gdp/i.test(normalizedTitle)) {
      if (/price index/i.test(normalizedTitle)) chineseName = '美国GDP价格指数';
      chineseName += /advance/i.test(normalizedTitle) ? '初值' : /prelim/i.test(normalizedTitle) ? '修正值' : /final/i.test(normalizedTitle) ? '终值' : '';
    } else if (/cpi|ppi/i.test(normalizedTitle)) {
      chineseName = `美国${/core/i.test(normalizedTitle) ? '核心' : ''}${/cpi/i.test(normalizedTitle) ? 'CPI消费者物价指数' : 'PPI生产者物价指数'}`;
    }

    const isWeeklyAdp = /adp weekly/i.test(normalizedTitle);
    if (isWeeklyAdp) chineseName = '美国ADP周度就业人数变动(NER Pulse)';
    const volTier = isWeeklyAdp ? 1 : matchedMeta ? matchedMeta.tier : isHighImpact ? 3 : isMediumImpact ? 2 : 1;

    const guidance = isWeeklyAdp ? {
      bullishCondition: '周度就业增速温和放缓，可作为劳动力市场趋势参考',
      bearishCondition: '周度数据大幅偏离近期趋势时留意风险情绪变化',
      riskInstruction: '这是周度高频数据，与月度小非农不同；源未提供市场预期时不推测，不宜作为独立开仓信号。',
    } : matchedMeta?.guidance || {
      bullishCondition: '若数据利好美元流动性宽松，利好大盘风险资产',
      bearishCondition: '若数据偏紧，引发紧缩预期，谨防冲高回落',
      riskInstruction: '数据发布前后15分钟内市场流动性剧震，严禁市价追单',
    };

    // 源未提供的市场预期或前值显式记为 null，不自行推测。
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
      source: {
        provider: 'faireconomy', url: CALENDAR_URL, title: item.title,
        impact: item.impact, fetchedAt, calendarWeek: calendarWeek(isoDate),
      },
      guidance,
    });
  }

  return transformed;
}

/**
 * 每次读取共享文件，确保 CLI 同步后其他服务进程不再使用旧缓存。
 */
export async function readCryptoEventsFromDisk(): Promise<CryptoEvent[]> {
  const events = JSON.parse(await readFile(JSON_PATH, 'utf8'));
  if (!Array.isArray(events)) throw new Error('本地日历非数组，停止写入');
  reloadGlobalCryptoEvents(events);
  return events;
}

// 同一进程内的同步和复盘回填串行写入，避免各自读到旧副本后相互覆盖。
const globalForEventWrites = globalThis as unknown as { __cryptoEventWrites?: { pending: Promise<unknown> } };
const eventWrites = globalForEventWrites.__cryptoEventWrites ??= { pending: Promise.resolve() };
function withEventWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = eventWrites.pending.then(operation);
  eventWrites.pending = result.catch(() => {});
  return result;
}

async function writeEvents(events: CryptoEvent[]) {
  const tempPath = `${JSON_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(events, null, 2), 'utf8');
  await rename(tempPath, JSON_PATH);
  reloadGlobalCryptoEvents(events);
}

export async function mergeEventsIntoJson(newEvents: CryptoEvent[], snapshotWeeks: string[] = []) {
  return withEventWrite(async () => {
    const existing = await readCryptoEventsFromDisk();
    const existingMap = new Map<string, CryptoEvent>(existing.map((e) => [e.id, e]));
    const incomingIds = new Set(newEvents.map((e) => e.id));
    let removedCount = 0;
    // 只对同源、同周、尚未发布且没有复盘的记录按完整快照对账。
    // 不凭同名跨周迁移，避免将不同统计期当成改期；手工和历史记录不受影响。
    for (const old of existing) {
      if (old.source?.provider === 'faireconomy' && snapshotWeeks.includes(old.source.calendarWeek) &&
          Date.parse(old.timestamp) > Date.now() && !old.impact && !incomingIds.has(old.id)) {
        existingMap.delete(old.id);
        removedCount++;
      }
    }

    let addedCount = 0;
    let updatedCount = 0;
    for (const event of newEvents) {
      // 旧实现曾擅自把 Revised 改写为 Final，按同一发布日迁移并保留复盘。
      const legacyId = event.id.replace('macro-revised-uom-consumer-sentiment-', 'macro-final-uom-consumer-sentiment-');
      const oldEvent = existingMap.get(event.id) || (legacyId !== event.id ? existingMap.get(legacyId) : undefined);
      if (legacyId !== event.id) existingMap.delete(legacyId);
      existingMap.set(event.id, {
        ...event, impact: oldEvent?.impact || event.impact,
        marketObservation: oldEvent && Date.parse(oldEvent.timestamp) === Date.parse(event.timestamp)
          ? oldEvent.marketObservation : undefined,
      });
      if (oldEvent) updatedCount++;
      else addedCount++;
    }
    const mergedList = Array.from(existingMap.values()).sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    );
    await writeEvents(mergedList);
    return { total: mergedList.length, addedCount, updatedCount, removedCount, events: mergedList };
  });
}

/**
 * 一键拉取与同步真实经济日历
 */
export async function syncMacroEvents() {
  const raw = await fetchLiveForexFactoryCalendar(true);
  const fetchedAt = calendarCache!.fetchedAt;
  const events = transformToCryptoEvents(raw, fetchedAt);
  const snapshotWeeks = Array.from(new Set(raw.map((item) => calendarWeek(item.date))));
  const result = await mergeEventsIntoJson(events, snapshotWeeks);
  return { ...result, fetchedRawCount: raw.length, filteredCount: events.length, fetchedAt };
}

/**
 * 【数据闭环核心】：将事件落地后的真实盘面走势与实战复盘持久化回填进 crypto-events.json
 */
export async function persistEventImpact(
  eventId: string,
  impact?: EventImpactRecord
): Promise<boolean> {
  try {
    return await withEventWrite(async () => {
      const events = await readCryptoEventsFromDisk();
      const target = events.find((e) => e.id === eventId);
      if (!target) return false;
      target.impact = impact;
      await writeEvents(events);
      return true;
    });
  } catch (err: any) {
    console.warn('[event-sync] Failed to write back event impact to crypto-events.json:', err?.message);
    return false;
  }
}

/** 单阶段合并到最新文件，拒绝在取数期间已经改期的事件。 */
export async function persistEventMarketStage(
  eventId: string,
  scheduledAt: string,
  window: EventMarketWindow,
  stage: NonNullable<EventMarketObservation['stages'][EventMarketWindow]>
): Promise<boolean> {
  return withEventWrite(async () => {
    const events = await readCryptoEventsFromDisk();
    const event = events.find((item) => item.id === eventId);
    if (!event || Date.parse(event.timestamp) !== Date.parse(scheduledAt)) return false;
    // 已完成的数据不被晚到的请求或失败状态覆盖。
    if (getEventMarketResult(event, window)) return true;
    const existing = event.marketObservation;
    event.marketObservation = {
      provider: 'okx', instrument: EVENT_MARKET_INSTRUMENT, scheduledAt,
      stages: { ...(existing && Date.parse(existing.scheduledAt) === Date.parse(scheduledAt) ? existing.stages : {}), [window]: stage },
    };
    await writeEvents(events);
    return true;
  });
}
