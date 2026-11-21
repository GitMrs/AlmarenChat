export const FOLLOW_UP_WATCH_COOLDOWN_MS = 5 * 60_000;

export const followUpWatchSchema = {
  type: 'array', maxItems: 6,
  description: '合约跟进的鹰眼条件，可提前唤醒本次复查。仅填写本轮行情支持的明确价位；PRICE为盘中穿越预警，15m/1H为收盘穿越，均不代表允许开仓。定时时间仍作兜底。',
  items: {
    type: 'object', additionalProperties: false,
    required: ['symbol', 'period', 'direction', 'level'],
    properties: {
      symbol: { type: 'string', description: '币种，如BTC，限OKX USDT永续' },
      period: { type: 'string', enum: ['PRICE', '15m', '1H'] },
      direction: { type: 'string', enum: ['ABOVE', 'BELOW'] },
      level: { type: 'number', exclusiveMinimum: 0 },
    },
  },
};

export function normalizeFollowUpWatches(input) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 6) throw new Error('鹰眼条件最多6项');
  const seen = new Set();
  return input.map(rule => {
    const symbol = String(rule?.symbol || '').toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(symbol) || !['PRICE', '15m', '1H'].includes(rule.period)
      || !['ABOVE', 'BELOW'].includes(rule.direction) || typeof rule.level !== 'number'
      || !Number.isFinite(rule.level) || rule.level <= 0) throw new Error('鹰眼条件的币种、周期、方向或价格无效');
    const result = { symbol, period: rule.period, direction: rule.direction, level: rule.level };
    const key = JSON.stringify(result);
    if (seen.has(key)) throw new Error('鹰眼条件不能重复');
    seen.add(key);
    return result;
  });
}

// Baselines are actual exchange samples, never an AI-provided price. A rule already
// satisfied when first armed must move back across the level before it can fire.
export function sampleFollowUpWatch(rule, snapshot, now) {
  if (!snapshot || snapshot.symbol !== rule.symbol) return null;
  if (rule.period === 'PRICE') {
    const at = Date.parse(snapshot.realtimeFetchedAt);
    if (!snapshot.dataQuality?.ticker || !Number.isFinite(snapshot.price) || snapshot.price <= 0
      || !Number.isFinite(at) || at > now || now - at > 90_000) return null;
    return { price: snapshot.price, at };
  }
  const duration = rule.period === '15m' ? 900_000 : 3_600_000;
  const rows = rule.period === '15m' ? snapshot.candles15m : snapshot.candles1h;
  if (!snapshot.dataQuality?.[rule.period === '15m' ? 'candles15m' : 'candles1h']) return null;
  const candle = (rows || []).filter(c => c.isClosed === true && Number.isFinite(c.startTimeMs)
    && c.startTimeMs + duration <= now && Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => b.startTimeMs - a.startTimeMs)[0];
  if (!candle || now - (candle.startTimeMs + duration) > duration + 90_000) return null;
  return { price: candle.close, at: candle.startTimeMs + duration };
}

export function evaluateFollowUpWatches(rules, previous, snapshots, now = Date.now()) {
  const state = { ...(previous || {}) };
  let event = null;
  for (const rule of rules) {
    const key = JSON.stringify(rule);
    const sample = sampleFollowUpWatch(rule, snapshots[rule.symbol], now);
    if (!sample) continue;
    const prior = state[key];
    if (prior && sample.at <= prior.at) continue;
    state[key] = sample;
    const crossed = prior && (rule.direction === 'ABOVE'
      ? prior.price <= rule.level && sample.price > rule.level
      : prior.price >= rule.level && sample.price < rule.level);
    if (crossed && !event) event = { ...rule, ...sample, previousPrice: prior.price, previousAt: prior.at };
  }
  return { state, event };
}

export function formatFollowUpWatchEvent(event) {
  return `鹰眼${event.period === 'PRICE' ? '盘中预警' : `${event.period}收盘变化`}：${event.symbol} 从 ${event.previousPrice} 到 ${event.price}，${event.direction === 'ABOVE' ? '上穿' : '下穿'} ${event.level}；数据时间 ${new Date(event.at).toISOString()}。这是提前复查的触发依据，不等于回踩确认、趋势反转或允许开仓。`;
}
