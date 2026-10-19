import cryptoEventsRaw from './crypto-events.json' with { type: 'json' };

export type EventCategory = 'macro' | 'unlock' | 'upgrade' | 'regulatory' | 'derivatives';
export type VolatilityTier = 1 | 2 | 3;
export type EventPhase = 'IMPENDING' | 'IN_THE_STORM' | 'DIGESTING' | 'DORMANT';

export interface EventImpactRecord {
  actualValue?: string;
  expectedValue?: string;
  surpriseFactor?: 'HAWKISH' | 'DOVISH' | 'IN_LINE';
  marketReaction: {
    fiveMinSpikePct: number;
    oneHourTrendPct: number;
    twentyFourHourResult: 'V_REVERSAL' | 'DUMP' | 'PUMP' | 'CHOPPY';
    liquidationsUsdMillion?: number;
  };
  playbookTakeaway: string;
  optimalAction: string;
}

export interface CryptoEvent {
  /**
   * 唯一事件标识，日期后缀严格对齐该事件的实际官方发布/生效日期 (YYYY-MM-DD)，杜绝发布日与统计月份混淆
   */
  id: string;
  title: string;
  category: EventCategory;
  country?: string; // "USD", "ALL" 等
  timestamp: string; // ISO8601 UTC string (精确到秒的官方发布时刻)
  /**
   * 受影响的币种资产定义：
   * - ["ALL"]: 全市场系统性资产（包含 BTC、ETH 及全部主流/山寨合约标的，受全网流动性与美元指数直接冲击）
   * - ["BTC", "ETH"]: 仅对大市值蓝筹基准产生直接主导影响
   * - ["TIA"], ["SOL"] 等: 标的专属事件（如原生代币大额悬崖解锁、主网升级），仅在涉及该标的的作战室激活风控
   */
  impactCoins: string[];
  volatilityTier: VolatilityTier;
  preAlertHours?: number; // 默认 4 小时，3 星事件默认 24 小时 (重大年终决议可至 72 小时)
  postDigestHours?: number; // 默认 4 小时
  forecast?: string | null;
  previous?: string | null;
  simulated?: boolean; // 若为情景模拟数据标记为 true，防范回测误用
  guidance?: {
    bullishCondition?: string;
    bearishCondition?: string;
    riskInstruction?: string;
  };
  impact?: EventImpactRecord;
}

export interface EvaluatedEvent {
  event: CryptoEvent;
  phase: EventPhase;
  deltaMinutes: number;
  countdownText: string;
  formattedLocalTime: string;
}

export interface EventRadarOptions {
  events?: CryptoEvent[];
  spaceCustomEvents?: CryptoEvent[];
  activeSymbols?: string[];
  now?: Date;
  maxActiveEvents?: number;
  maxPlaybookItems?: number;
}

// 维护内存中可变事件缓存
let globalEventsCache: CryptoEvent[] = Array.isArray(cryptoEventsRaw)
  ? (JSON.parse(JSON.stringify(cryptoEventsRaw)) as CryptoEvent[])
  : [];

/**
 * 获取系统内置的全局客观大事件列表（免网络 I/O）
 */
export function loadGlobalCryptoEvents(): CryptoEvent[] {
  return globalEventsCache;
}

/**
 * 更新/重新加载内存中的全局事件缓存
 */
export function reloadGlobalCryptoEvents(events: CryptoEvent[]) {
  globalEventsCache = events;
}

/**
 * 重置/更新内存中的事件缓存（主要用于测试）
 */
export function setGlobalEventsCacheForTesting(events: CryptoEvent[]) {
  globalEventsCache = events;
}

/**
 * 格式化倒计时与时间文本
 */
export function formatCountdownMinutes(deltaMinutes: number): string {
  if (deltaMinutes <= 0) {
    const passedMinutes = Math.abs(deltaMinutes);
    if (passedMinutes < 60) return `已过去 ${Math.round(passedMinutes)} 分钟`;
    const hours = Math.floor(passedMinutes / 60);
    const mins = Math.round(passedMinutes % 60);
    return mins > 0 ? `已过去 ${hours} 小时 ${mins} 分钟` : `已过去 ${hours} 小时`;
  }

  if (deltaMinutes < 60) {
    return `${Math.max(1, Math.round(deltaMinutes))} 分钟`;
  }
  const hours = Math.floor(deltaMinutes / 60);
  const mins = Math.round(deltaMinutes % 60);
  if (hours < 24) {
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days} 天 ${remainingHours} 小时` : `${days} 天`;
}

/**
 * 格式化为北京时间 (UTC+8) 字符串
 */
export function formatLocalTime(date: Date): string {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
}

/**
 * 计算单个事件在当前时刻的四阶段状态
 */
export function evaluateEventPhase(event: CryptoEvent, now = new Date()): {
  phase: EventPhase;
  deltaMinutes: number;
  countdownText: string;
  formattedLocalTime: string;
} {
  const eventDate = new Date(event.timestamp);
  const deltaMinutes = (eventDate.getTime() - now.getTime()) / (60 * 1000);
  const preAlertHours = event.preAlertHours ?? (event.volatilityTier === 3 ? 24 : 4);
  const postDigestHours = event.postDigestHours ?? 4;

  const preAlertMinutes = preAlertHours * 60;
  const postDigestMinutes = postDigestHours * 60;

  let phase: EventPhase = 'DORMANT';

  // 极窄暴风雨剧变期: [T - 5min, T + 15min]
  if (deltaMinutes >= -15 && deltaMinutes <= 5) {
    phase = 'IN_THE_STORM';
  } else if (deltaMinutes > 5 && deltaMinutes <= preAlertMinutes) {
    // 临近倒计时预警期
    phase = 'IMPENDING';
  } else if (deltaMinutes < -15 && Math.abs(deltaMinutes) <= postDigestMinutes) {
    // 落地消化与复盘期
    phase = 'DIGESTING';
  } else {
    // 平时休眠
    phase = 'DORMANT';
  }

  return {
    phase,
    deltaMinutes,
    countdownText: formatCountdownMinutes(deltaMinutes),
    formattedLocalTime: formatLocalTime(eventDate),
  };
}

/**
 * 针对具体空间的多租户过滤机制：
 * 1. 合并全局客观事件与当前空间专属私有事件；
 * 2. 依据空间关注的币种（如 BTC、ETH、TIA）做精准过滤，避免噪音打扰。
 */
export function filterEventsForSpace(
  globalEvents: CryptoEvent[],
  spaceCustomEvents: CryptoEvent[] = [],
  activeSymbols: string[] = []
): CryptoEvent[] {
  const merged = [...globalEvents, ...spaceCustomEvents];
  if (activeSymbols.length === 0) {
    // 未指定币种时默认仅返回影响全市场的全局事件
    return merged.filter((e) => e.impactCoins.includes('ALL'));
  }

  const normalizedSymbols = new Set(
    activeSymbols.map((s) => s.toUpperCase().replace(/-USDT-SWAP$/i, '').replace(/USDT$/i, ''))
  );

  return merged.filter((event) => {
    if (event.impactCoins.includes('ALL')) return true;
    return event.impactCoins.some((c) => normalizedSymbols.has(c.toUpperCase()));
  });
}

/**
 * 召回同类历史大事件复盘记录（历史对策剧本）
 */
export function getHistoricalPlaybook(
  allEvents: CryptoEvent[],
  category?: EventCategory,
  limit = 2
): Array<{ eventTitle: string; impact: EventImpactRecord }> {
  const eventsWithImpact = allEvents.filter((e) => Boolean(e.impact));

  // 优先召回同 category 的事件，不够时由其他大事件补齐
  const categoryMatched = category
    ? eventsWithImpact.filter((e) => e.category === category)
    : eventsWithImpact;

  const result = (categoryMatched.length > 0 ? categoryMatched : eventsWithImpact)
    .slice(-limit)
    .map((e) => ({
      eventTitle: e.title,
      impact: e.impact!,
    }));

  return result;
}

/**
 * 组装注入大模型 System Prompt 的大事件雷达 Markdown 上下文
 */
export function buildEventRadarContext(options: EventRadarOptions = {}): string {
  const now = options.now ?? new Date();
  const globalEvents = options.events ?? loadGlobalCryptoEvents();
  const spaceEvents = options.spaceCustomEvents ?? [];
  const activeSymbols = options.activeSymbols ?? ['BTC'];
  const maxActiveEvents = options.maxActiveEvents ?? 2;
  const maxPlaybookItems = options.maxPlaybookItems ?? 2;

  // 1. 空间级别过滤
  const filteredEvents = filterEventsForSpace(globalEvents, spaceEvents, activeSymbols);

  // 2. 评估每个事件当前的时态状态
  const activeEvaluations: EvaluatedEvent[] = [];
  for (const event of filteredEvents) {
    const evaluation = evaluateEventPhase(event, now);
    if (evaluation.phase !== 'DORMANT') {
      activeEvaluations.push({
        event,
        ...evaluation,
      });
    }
  }

  if (activeEvaluations.length === 0) {
    return '';
  }

  // 排序：剧变期 (IN_THE_STORM) 优先，其次为临近 (IMPENDING，按剩余时间升序)，最后为消化期 (DIGESTING)
  activeEvaluations.sort((a, b) => {
    const phaseOrder = { IN_THE_STORM: 0, IMPENDING: 1, DIGESTING: 2, DORMANT: 3 };
    if (phaseOrder[a.phase] !== phaseOrder[b.phase]) {
      return phaseOrder[a.phase] - phaseOrder[b.phase];
    }
    return Math.abs(a.deltaMinutes) - Math.abs(b.deltaMinutes);
  });

  const selectedActive = activeEvaluations.slice(0, maxActiveEvents);

  const lines: string[] = ['【🚨 宏观与重大事件实时战备雷达】'];

  for (const item of selectedActive) {
    const { event, phase, countdownText, formattedLocalTime } = item;
    const tierIcon = event.volatilityTier === 3 ? '🔴 3星极度高危' : event.volatilityTier === 2 ? '🟡 2星强震' : '🔵 1星扰动';

    if (phase === 'IN_THE_STORM') {
      lines.push(
        `- ⚡【暴风雨正当时 · 严禁追单】${event.title}（${tierIcon}）`,
        `  • 当前时间正处于数据公布窗口（${formattedLocalTime}），全网流动性极度脆弱，秒级双向插针概率极高！`,
        `  • 战备铁律：严禁在当前15分钟内使用市价单追涨杀跌，只看不动，等待分时形态收敛！`
      );
    } else if (phase === 'IMPENDING') {
      lines.push(
        `- ⏳【临近决战倒计时 · 防插针戒尺】${event.title}（${tierIcon}，距离公布仅剩 ${countdownText}）`,
        `  • 预定发布：${formattedLocalTime} (北京时间 UTC+8)`,
        `  • 防御纪律：${event.guidance?.riskInstruction || '在数据出炉前禁止开高杠杆盲目博弈，持仓严格上移止损防双爆'}`
      );
      if (event.guidance?.bullishCondition || event.guidance?.bearishCondition) {
        lines.push(
          `  • 多空推演：${event.guidance?.bullishCondition || ''}；${event.guidance?.bearishCondition || ''}`
        );
      }
    } else if (phase === 'DIGESTING') {
      lines.push(
        `- 🌊【事件落地消化中 · 观察承接】${event.title}（${tierIcon}，${countdownText}落地）`,
        `  • 重点观察：市场是否出现“冲高回落诱多”或“下插针见底利空出尽”形态，待放量方向确认后再行布局。`
      );
    }
  }

  // 3. 提取历史同类事件的复盘剧本 (Playbook) 供大模型推演参考
  const topCategory = selectedActive[0]?.event.category;
  const playbookItems = getHistoricalPlaybook(globalEvents, topCategory, maxPlaybookItems);

  if (playbookItems.length > 0) {
    lines.push('【📚 历史同类事件复盘与战术剧本参考】');
    playbookItems.forEach((p, idx) => {
      const rx = p.impact.marketReaction;
      const surpriseDesc =
        p.impact.surpriseFactor === 'HAWKISH'
          ? '超预期利空'
          : p.impact.surpriseFactor === 'DOVISH'
          ? '低于预期利好'
          : '符合预期';
      const spikeSign = rx.fiveMinSpikePct >= 0 ? `+${rx.fiveMinSpikePct}%` : `${rx.fiveMinSpikePct}%`;
      const liqStr = rx.liquidationsUsdMillion ? `，全网爆仓 $${rx.liquidationsUsdMillion}M` : '';

      lines.push(
        `  ${idx + 1}. ${p.eventTitle}（公布值 ${p.impact.actualValue || 'N/A'}，${surpriseDesc}）：` +
          `5分钟瞬时波动 ${spikeSign}，1小时走势 ${rx.oneHourTrendPct >= 0 ? '+' : ''}${rx.oneHourTrendPct}%${liqStr}。` +
          `\n     💡 实战剧本总结：${p.impact.playbookTakeaway}。最优战术：${p.impact.optimalAction}`
      );
    });
  }

  return lines.join('\n');
}
