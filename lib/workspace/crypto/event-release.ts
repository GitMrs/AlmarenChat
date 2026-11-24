import type { CryptoEvent } from './event-temporal.ts';

export interface MacroRelease {
  status: 'published' | 'pending' | 'retry' | 'unavailable';
  scheduledAt: string;
  checkedAt: string;
  lastAttemptAt?: string;
  retryAt?: string;
  attempts: number;
  error?: string;
  reason?: string;
  actual?: string;
  /** 发布前日历快照；首次采集已经晚于发布时不冒充事前预期。 */
  forecast?: string | null;
  previous?: string | null;
  forecastRecordedAt?: string;
  sourceForecast?: string | null;
  sourcePrevious?: string | null;
  source?: { provider: 'nasdaq'; url: string; title: string; fetchedAt: string };
  revisions?: Array<{ actual: string; collectedAt: string }>;
}

export type MacroIndicator = { key: string; family: 'inflation' | 'growth' | 'employment' | 'unemployment' | 'rate'; names: string[] };
const indicators: Array<MacroIndicator & { pattern: RegExp }> = [
  { key: 'core-cpi-mm', family: 'inflation', pattern: /^core cpi m\/m$/i, names: ['Core CPI (MoM)'] },
  { key: 'core-cpi-yy', family: 'inflation', pattern: /^core cpi y\/y$/i, names: ['Core CPI (YoY)'] },
  { key: 'cpi-mm', family: 'inflation', pattern: /^cpi m\/m$/i, names: ['CPI (MoM)'] },
  { key: 'cpi-yy', family: 'inflation', pattern: /^cpi y\/y$/i, names: ['CPI (YoY)'] },
  { key: 'core-ppi-mm', family: 'inflation', pattern: /^core ppi m\/m$/i, names: ['Core PPI (MoM)'] },
  { key: 'core-ppi-yy', family: 'inflation', pattern: /^core ppi y\/y$/i, names: ['Core PPI (YoY)'] },
  { key: 'ppi-mm', family: 'inflation', pattern: /^ppi m\/m$/i, names: ['PPI (MoM)'] },
  { key: 'ppi-yy', family: 'inflation', pattern: /^ppi y\/y$/i, names: ['PPI (YoY)'] },
  { key: 'core-pce-mm', family: 'inflation', pattern: /^core pce price index m\/m$/i, names: ['Core PCE Price Index (MoM)'] },
  { key: 'core-pce-yy', family: 'inflation', pattern: /^core pce price index y\/y$/i, names: ['Core PCE Price Index (YoY)'] },
  { key: 'pce-mm', family: 'inflation', pattern: /^pce price index m\/m$/i, names: ['PCE Price index (MoM)'] },
  { key: 'pce-yy', family: 'inflation', pattern: /^pce price index y\/y$/i, names: ['PCE price index (YoY)'] },
  { key: 'flash-manufacturing-pmi', family: 'growth', pattern: /^flash manufacturing pmi$/i, names: ['S&P Global Manufacturing PMI'] },
  { key: 'flash-services-pmi', family: 'growth', pattern: /^flash services pmi$/i, names: ['S&P Global Services PMI'] },
  { key: 'ism-manufacturing', family: 'growth', pattern: /^ism manufacturing pmi$/i, names: ['ISM Manufacturing PMI'] },
  { key: 'ism-services', family: 'growth', pattern: /^ism (?:non-manufacturing|services) pmi$/i, names: ['ISM Non-Manufacturing PMI', 'ISM Services PMI'] },
  { key: 'nfp', family: 'employment', pattern: /^non-farm employment change$/i, names: ['Nonfarm Payrolls'] },
  { key: 'adp', family: 'employment', pattern: /^adp non-farm employment change$/i, names: ['ADP Nonfarm Employment Change'] },
  { key: 'unemployment-rate', family: 'unemployment', pattern: /^unemployment rate$/i, names: ['Unemployment Rate'] },
  { key: 'claims', family: 'unemployment', pattern: /^unemployment claims$/i, names: ['Initial Jobless Claims'] },
  { key: 'retail-mm', family: 'growth', pattern: /^retail sales m\/m$/i, names: ['Retail Sales (MoM)'] },
  { key: 'core-retail-mm', family: 'growth', pattern: /^core retail sales m\/m$/i, names: ['Core Retail Sales (MoM)', 'Core Retail Sales'] },
  { key: 'gdp-advance', family: 'growth', pattern: /^advance gdp q\/q$/i, names: ['GDP (QoQ)', 'GDP'] },
  { key: 'gdp-prelim', family: 'growth', pattern: /^prelim gdp q\/q$/i, names: ['GDP (QoQ)', 'GDP'] },
  { key: 'gdp-final', family: 'growth', pattern: /^final gdp q\/q$/i, names: ['GDP (QoQ)', 'GDP'] },
  { key: 'uom-prelim', family: 'growth', pattern: /^prelim uom consumer sentiment$/i, names: ['Michigan Consumer Sentiment'] },
  { key: 'uom-revised', family: 'growth', pattern: /^revised uom consumer sentiment$/i, names: ['Michigan Consumer Sentiment'] },
  { key: 'rate', family: 'rate', pattern: /^federal funds rate$/i, names: ['Fed Interest Rate Decision'] },
];

export function getMacroIndicator(event: Pick<CryptoEvent, 'category' | 'source' | 'title'>): MacroIndicator | undefined {
  if (event.category !== 'macro') return undefined;
  const title = event.source?.title || event.title;
  return indicators.find((entry) => entry.pattern.test(title));
}

export function cleanReleaseValue(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const value = String(raw).replace(/&nbsp;|&#160;/gi, ' ').trim();
  return !value || /^(?:[-–—]|n\/a|na|null|pending)$/i.test(value) ? null : value;
}

/** 严格解析，不把区间、占位符、错误文字或单位不同的数值当成可比较的数字。 */
export function parseReleaseNumber(raw: unknown): { value: number; unit: 'percent' | 'number'; scale: number } | null {
  const text = cleanReleaseValue(raw)?.replace(/−/g, '-');
  if (!text) return null;
  const match = /^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([%KMBT]?)$/i.exec(text);
  if (!match) return null;
  const suffix = match[2].toUpperCase();
  const scale = ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 } as Record<string, number>)[suffix] || 1;
  const value = Number(match[1].replaceAll(',', '')) * scale;
  return Number.isFinite(value) ? { value, unit: suffix === '%' ? 'percent' : 'number', scale } : null;
}

export function compareReleaseValues(actual: unknown, reference: unknown) {
  const a = parseReleaseNumber(actual);
  const b = parseReleaseNumber(reference);
  if (!a || !b || a.unit !== b.unit) return null;
  const delta = Number((a.value - b.value).toPrecision(12));
  const scale = Math.max(a.scale, b.scale);
  const suffix = a.unit === 'percent' ? '个百分点' : scale === 1e12 ? 'T' : scale === 1e9 ? 'B' : scale === 1e6 ? 'M' : scale === 1e3 ? 'K' : '点';
  const displayed = Number((delta / scale).toFixed(6));
  return { delta, direction: delta > 0 ? 'above' : delta < 0 ? 'below' : 'inline', text: `${delta > 0 ? '+' : ''}${displayed} ${suffix}` };
}

export function getPublishedRelease(event: CryptoEvent, now = new Date()): MacroRelease | undefined {
  const release = event.release;
  const at = Date.parse(event.timestamp);
  const checked = Date.parse(release?.checkedAt || '');
  if (event.simulated || release?.status !== 'published' || Date.parse(release.scheduledAt) !== at ||
      !Number.isFinite(at) || at > now.getTime() || !Number.isFinite(checked) || checked < at || checked > now.getTime() ||
      !cleanReleaseValue(release.actual) || release.source?.provider !== 'nasdaq' ||
      Date.parse(release.source.fetchedAt) !== checked) return undefined;
  try {
    const url = new URL(release.source.url);
    if (url.protocol !== 'https:' || url.hostname !== 'api.nasdaq.com' || url.pathname !== '/api/calendar/economicevents') return undefined;
  } catch { return undefined; }
  return release;
}

export function getReleasePresentation(event: CryptoEvent, now = new Date()) {
  const indicator = getMacroIndicator(event);
  const narrative = /speaks|speech|minutes|statement|press conference|讲话|纪要|声明|发布会/i.test(event.source?.title || event.title);
  const release = getPublishedRelease(event, now);
  const at = Date.parse(event.timestamp);
  const state = event.release && Date.parse(event.release.scheduledAt) === at ? event.release : undefined;
  const supported = !!indicator && !event.simulated;
  let status = !supported ? (narrative ? '文字事件，待来源核验' : '暂未接入结果源')
    : now.getTime() < at ? '待公布'
    : release ? '已采集公布值'
    : state?.status === 'retry' ? '采集失败，等待重试'
    : state?.status === 'unavailable' ? '公布值暂未取得'
    : '已到公布时间，等待公布值';
  if (event.simulated) status = '情景模拟，不采集真实公布值';
  const forecast = release ? release.forecast : event.forecast;
  const previous = release ? release.previous : event.previous;
  const surprise = release ? compareReleaseValues(release.actual, forecast) : null;
  const change = release ? compareReleaseValues(release.actual, previous) : null;
  const baselineKnownBefore = !!release?.forecastRecordedAt && Date.parse(release.forecastRecordedAt) < at;
  const forecastDiffers = !!release?.sourceForecast && !!forecast && compareReleaseValues(release.sourceForecast, forecast)?.direction !== 'inline' && release.sourceForecast !== forecast;
  const actualNumber = release ? parseReleaseNumber(release.actual) : null;
  const economicState = indicator?.names.some((name) => /pmi/i.test(name)) && actualNumber?.unit === 'number'
    ? actualNumber.value > 50 ? 'PMI 高于 50，处于扩张区间' : actualNumber.value < 50 ? 'PMI 低于 50，处于收缩区间' : 'PMI 位于 50，处于荣枯分界' : undefined;
  const result = !release ? '尚无已核验的公布值'
    : !surprise ? '预期缺失或数值口径不可比较'
    : surprise.direction === 'above' ? '高于日历预期'
    : surprise.direction === 'below' ? '低于日历预期' : '符合日历预期';
  let bias: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL' | 'UNKNOWN' = 'UNKNOWN';
  let interpretation = '取得公布结果后再解读，价格涨跌不能反推公布值。';
  if (!supported) interpretation = narrative ? '需要核验公告或讲话原文；不按数值指标自动计算多空。' : '尚无可靠的指标匹配规则，不自动填写结果或判断多空。';
  else if (release) {
    if (!surprise) interpretation = '已取得公布值，缺少同口径预期，暂不判断 BTC 多空。';
    else if (!baselineKnownBefore) interpretation = '预期首次记录于公布后，仅作数值对照，不能视为已核验的事前预期差。';
    else if (forecastDiffers) interpretation = '两份来源的预期不一致，保留原日历差值供对照，暂不自动判断 BTC 多空。';
    else if (surprise.direction === 'inline') { bias = 'NEUTRAL'; interpretation = '公布值符合记录的预期，单项数据未形成明显预期差；仍需观察其他分项与行情。'; }
    else if (indicator?.family === 'inflation') {
      bias = surprise.direction === 'below' ? 'BULLISH' : 'BEARISH';
      interpretation = surprise.direction === 'below' ? '通胀低于预期：按宽松预期路径，对 BTC 参考偏利多；需结合其他分项和市场验证。' : '通胀高于预期：按政策偏紧路径，对 BTC 参考偏利空；需结合其他分项和市场验证。';
    } else {
      bias = 'MIXED';
      interpretation = indicator?.family === 'rate' ? '利率结果需结合声明、预期路径与发布会，单个利率值不足以确定 BTC 方向。'
        : indicator?.family === 'growth' ? '增长数据同时涉及经济前景与利率预期，对 BTC 影响可能分歧，等待市场验证。'
        : '就业数据同时涉及经济韧性、衰退与政策预期，对 BTC 影响可能分歧，等待市场验证。';
    }
  }
  return { supported, status, release, forecast, previous, surprise, change, baselineKnownBefore, result, bias, interpretation, economicState,
    previousDiffers: !!release?.sourcePrevious && !!previous && compareReleaseValues(release.sourcePrevious, previous)?.direction !== 'inline' && release.sourcePrevious !== previous,
    forecastDiffers,
  };
}

/** 分组仅共用外层入口；每个数值阶段仍保留自己的时刻、来源和结果。 */
export function getAdditionalReleaseEvents(event: CryptoEvent): CryptoEvent[] {
  return (event.eventGroupMembers || []).map((member): CryptoEvent => ({
    ...member, impactCoins: event.impactCoins, volatilityTier: event.volatilityTier,
  })).filter((member) => !!getMacroIndicator(member));
}

export function formatEventReleaseContext(event: CryptoEvent, now = new Date()): string {
  if (event.category !== 'macro') return '';
  const p = getReleasePresentation(event, now);
  const release = p.release;
  const own = `公布结果：${p.status}；实际值 ${release?.actual || '未知'}；${p.result}${p.surprise ? `（${p.surprise.text}）` : ''}；较原日历前值 ${p.change?.text || '不可比较'}。` +
    (release ? `日历预期记录于 ${release.forecastRecordedAt || '未知'}；公布值来源 Nasdaq 聚合日历 ${release.source!.url}，采集 ${release.checkedAt}。` : '') +
    (p.previousDiffers ? `补充源前值 ${release!.sourcePrevious} 与原日历 ${p.previous} 不同，未确认为官方修正。` : '') +
    (p.forecastDiffers ? `补充源预期 ${release!.sourceForecast} 与原日历 ${p.forecast} 不同，不覆盖原记录。` : '') +
    (p.economicState ? `${p.economicState}。` : '') +
    `BTC 解读：${p.interpretation}行情统计不能单独证明事件因果。`;
  const additional = getAdditionalReleaseEvents(event).map((member) => `${member.title}（${member.timestamp}）：${formatEventReleaseContext(member, now)}`);
  return [own, ...additional].join('\n');
}
