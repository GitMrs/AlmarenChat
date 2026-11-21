export const CRYPTO_REVIEW_ROLES = ['crypto-chart-master', 'crypto-whale-hunter', 'crypto-risk-warden'];
export const CRYPTO_ROUND_TRIP_COST_BPS = 20;
const numberField = { type: 'number', exclusiveMinimum: 0 };
export const cryptoAssessmentTool = {
  type: 'function', function: {
    name: 'submit_crypto_follow_up_assessment',
    description: '合约复查必须提交一次结构化阶段结论。原条件满足时提交CANDIDATE并交接审核；不要只在正文说候选成立后又继续等。无法提供真实K线证据时用INSUFFICIENT_DATA。',
    parameters: { type: 'object', additionalProperties: false, required: ['status', 'reason'], properties: {
      status: { type: 'string', enum: ['WAITING', 'CANDIDATE', 'INVALIDATED', 'EXPIRED', 'INSUFFICIENT_DATA'] },
      reason: { type: 'string', maxLength: 1000, description: '对照原条件说明已满足、未满足或失效；不得改写原目标。' },
      candidate: { type: 'object', additionalProperties: false,
        required: ['symbol', 'direction', 'entryMin', 'entryMax', 'stopLoss', 'takeProfit1', 'takeProfit2', 'invalidationPrice', 'tp1Fraction', 'confirmation'],
        properties: {
          symbol: { type: 'string' }, direction: { type: 'string', enum: ['LONG', 'SHORT'] },
          entryMin: numberField, entryMax: numberField, stopLoss: numberField, takeProfit1: numberField,
          takeProfit2: numberField, invalidationPrice: numberField,
          tp1Fraction: { type: 'number', enum: [0.5], description: '沿用当前空间TP1平仓50%、剩余TP2的默认方案，填0.5。' },
          confirmation: { type: 'object', additionalProperties: false,
            required: ['period', 'breakoutStartMs', 'retestStartMs', 'level'],
            properties: { period: { type: 'string', enum: ['15m', '1H'] }, breakoutStartMs: numberField,
              retestStartMs: numberField, level: { ...numberField, description: '原观察位。回踩允许距观察位最多20基点的浅回踩，须明确披露。' } } },
        } },
    } },
  },
};

export const cryptoReviewVerdictTool = {
  type: 'function', function: { name: 'submit_crypto_review_verdict',
    description: '提交你本人对同一候选的审核，不修改原方案，不执行交易。资料不足要明确指出。',
    parameters: { type: 'object', additionalProperties: false, required: ['verdict', 'reason'], properties: {
      verdict: { type: 'string', enum: ['PASS', 'REJECT', 'NEEDS_DATA'] },
      reason: { type: 'string', maxLength: 1000 },
    } },
  },
};

export function normalizeCryptoAssessment(input) {
  const status = input?.status;
  const reason = String(input?.reason || '').trim();
  if (!['WAITING', 'CANDIDATE', 'INVALIDATED', 'EXPIRED', 'INSUFFICIENT_DATA'].includes(status)
    || !reason || reason.length > 1000) throw new Error('阶段结论或核验理由无效');
  if (status !== 'CANDIDATE') return { status, reason };
  const c = input.candidate;
  if (!c || !/^[A-Z0-9]{2,12}$/.test(c.symbol) || !['LONG', 'SHORT'].includes(c.direction)) throw new Error('候选标的或方向无效');
  const fields = ['entryMin', 'entryMax', 'stopLoss', 'takeProfit1', 'takeProfit2', 'invalidationPrice'];
  if (fields.some(key => typeof c[key] !== 'number' || !Number.isFinite(c[key]) || c[key] <= 0)
    || c.entryMin > c.entryMax || c.tp1Fraction !== 0.5) throw new Error('候选价位无效，或未采用当前空间TP1平仓50%的默认方案');
  const long = c.direction === 'LONG';
  if (long ? !(c.stopLoss < c.entryMin && c.invalidationPrice < c.entryMin && c.takeProfit1 > c.entryMax && c.takeProfit2 >= c.takeProfit1)
    : !(c.stopLoss > c.entryMax && c.invalidationPrice > c.entryMax && c.takeProfit1 < c.entryMin && c.takeProfit2 <= c.takeProfit1)) throw new Error('止损、失效位或目标方向错误');
  const proof = c.confirmation;
  if (!proof || !['15m', '1H'].includes(proof.period) || ['breakoutStartMs', 'retestStartMs', 'level']
    .some(key => typeof proof[key] !== 'number' || !Number.isFinite(proof[key]) || proof[key] <= 0)) throw new Error('候选缺少明确的突破及后续回踩K线证据');
  return { status, reason, candidate: { symbol: c.symbol, direction: c.direction,
    ...Object.fromEntries(fields.map(key => [key, c[key]])), tp1Fraction: c.tp1Fraction,
    confirmation: { period: proof.period, breakoutStartMs: proof.breakoutStartMs, retestStartMs: proof.retestStartMs, level: proof.level } } };
}

export function normalizeCryptoVerdict(input) {
  const reason = String(input?.reason || '').trim();
  if (!['PASS', 'REJECT', 'NEEDS_DATA'].includes(input?.verdict) || !reason || reason.length > 1000) throw new Error('审核结论必须为通过、否决或资料不足，并说明理由');
  return { verdict: input.verdict, reason };
}

export function verifyCandidateConfirmation(candidate, snapshot, now = Date.now()) {
  if (!snapshot || snapshot.symbol !== candidate.symbol || !snapshot.dataQuality?.ticker
    || !Number.isFinite(snapshot.price) || snapshot.price <= 0) return { ok: false, reason: '候选标的没有可靠的新行情' };
  const fetched = Date.parse(snapshot.realtimeFetchedAt);
  if (!Number.isFinite(fetched) || fetched > now || now - fetched > 180000) return { ok: false, reason: '候选行情过期，需重新核验' };
  const proof = candidate.confirmation;
  const duration = proof.period === '1H' ? 3600000 : 900000;
  const bars = proof.period === '1H' ? snapshot.candles1h : snapshot.candles15m;
  if (!snapshot.dataQuality?.candles15m || !snapshot.dataQuality?.[proof.period === '1H' ? 'candles1h' : 'candles15m']) return { ok: false, reason: '确认周期K线不可用' };
  const breakout = bars?.find(c => c.startTimeMs === proof.breakoutStartMs && c.isClosed === true);
  const retest = snapshot.candles15m?.find(c => c.startTimeMs === proof.retestStartMs && c.isClosed === true);
  if (!breakout || !retest || ![breakout.close, retest.close, retest.high, retest.low].every(v => Number.isFinite(v) && v > 0)) return { ok: false, reason: '指定突破或回踩K线不存在或未收盘' };
  if (retest.startTimeMs < breakout.startTimeMs + duration) return { ok: false, reason: '回踩必须发生在突破K线收盘之后；同时收盘不算后续确认' };
  if (retest.startTimeMs + 900000 > now || now - (retest.startTimeMs + 900000) > 3600000) return { ok: false, reason: '回踩证据尚未收盘或已超过一小时，不能当作当前信号' };
  const long = candidate.direction === 'LONG';
  const prior = bars?.find(c => c.startTimeMs === breakout.startTimeMs - duration && c.isClosed === true);
  if (!prior || !Number.isFinite(prior.close)) return { ok: false, reason: '缺少突破前的已收盘K线，不能确认穿越' };
  const crossed = long ? breakout.close > proof.level && prior.close <= proof.level : breakout.close < proof.level && prior.close >= proof.level;
  const held = long ? retest.close > proof.level && retest.low >= proof.level && retest.low <= proof.level * 1.002
    : retest.close < proof.level && retest.high <= proof.level && retest.high >= proof.level * 0.998;
  // A wick through the level followed by a close back is also an explicit retest.
  const reclaimed = long ? retest.low <= proof.level && retest.close > proof.level : retest.high >= proof.level && retest.close < proof.level;
  if (!crossed || !(held || reclaimed)) return { ok: false, reason: '实际K线不满足候选声明的突破和回踩守住条件' };
  if (long ? snapshot.price <= candidate.invalidationPrice : snapshot.price >= candidate.invalidationPrice) return { ok: false, reason: '现价已越过候选失效位' };
  if (long ? retest.low <= candidate.invalidationPrice : retest.high >= candidate.invalidationPrice) return { ok: false, reason: '回踩期间已越过候选结构失效位' };
  if (long ? snapshot.price >= candidate.takeProfit1 : snapshot.price <= candidate.takeProfit1) return { ok: false, reason: '行情已触达候选第一目标，原机会已过期，不能追价补单' };
  return { ok: true, reason: '已核验突破后独立的15m回踩收线（允许20基点浅回踩）' };
}

export function candidateRiskCheck(candidate) {
  const ratios = [candidate.entryMin, candidate.entryMax].map(entry => {
    const sign = candidate.direction === 'LONG' ? 1 : -1;
    const cost = entry * CRYPTO_ROUND_TRIP_COST_BPS / 10000;
    const reward = sign * (candidate.tp1Fraction * candidate.takeProfit1 + (1 - candidate.tp1Fraction) * candidate.takeProfit2 - entry) - cost;
    const risk = sign * (entry - candidate.stopLoss) + cost;
    return reward / risk;
  });
  const minNetRR = Math.min(...ratios);
  return { minNetRR, roundTripCostBps: CRYPTO_ROUND_TRIP_COST_BPS,
    passed: Number.isFinite(minNetRR) && minNetRR >= 2, maxAccountRiskFraction: 0.02,
    sizing: 'NEEDS_CURRENT_ACCOUNT_EQUITY', costNote: '往返手续费与滑点合计按20基点估算，不代表实际交易所费率；须用户核对' };
}

export function formatCryptoAssessment(review) {
  const labels = { WAITING: '原条件尚未满足', CANDIDATE: '候选已提交', INVALIDATED: '原观察已失效', EXPIRED: '原机会已过期',
    INSUFFICIENT_DATA: '核验资料不足', CONFIRMATION_FAILED: '候选确认证据未通过', REVIEW_BLOCKED: '审核未完成',
    REJECTED: '候选被否决', APPROVED_FOR_WATCH: '候选审核通过，待用户确认观察计划' };
  const lines = [`【候选阶段结果】${labels[review.status] || review.status}`, review.reason];
  if (review.verifiedAt) lines.push(`审核后行情核验：${review.referencePrice}，数据时间${review.verifiedAt}。`);
  for (const r of review.reviews || []) lines.push(`${r.agentName || r.agentId}：${({ PASS: '通过', REJECT: '否决', NEEDS_DATA: '资料不足' })[r.verdict]}。${r.reason}`);
  if (review.risk) lines.push(`程序风控：按最不利入场与分批目标估算，扣除假设成本后RR为1:${review.risk.minNetRR.toFixed(2)}；${review.risk.costNote}。账户净值未核验，不输出可执行仓位。`);
  if (review.candidate) {
    const c = review.candidate;
    lines.push(`技术候选：${c.symbol} ${c.direction === 'LONG' ? '做多' : '做空'}；入场${c.entryMin}–${c.entryMax}，止损${c.stopLoss}，TP1 ${c.takeProfit1}（${(c.tp1Fraction * 100).toFixed(0)}%），TP2 ${c.takeProfit2}，失效位${c.invalidationPrice}。`);
  }
  lines.push('审核不执行交易；通过仅生成可供用户确认的观察方案，持仓与仓位仍需核对当前账户。');
  return lines.join('\n\n');
}
