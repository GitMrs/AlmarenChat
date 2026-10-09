export type TradePlanStatus = 'PENDING' | 'TRIGGERED' | 'BREAKEVEN' | 'COMPLETED' | 'EXPIRED';

export interface PlanItem {
  id: string;
  symbol: string; // 如 "BTC", "ETH"
  name: string; // 如 "BTC 方案 A (箱体下沿做多)"
  direction: 'LONG' | 'SHORT';
  status: TradePlanStatus;
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  invalidationPrice: number; // 结构破坏失效价格
  rrRatio?: string; // 盈亏比
  note?: string;
}

export interface PlanRiskRewardPoint {
  entryPrice: number;
  riskAmount: number;
  riskPercent: number;
  tp1Ratio: number;
  tp2Ratio: number;
}

export interface PlanRiskRewardAnalysis {
  lowerEntry: PlanRiskRewardPoint;
  midpointEntry: PlanRiskRewardPoint;
  upperEntry: PlanRiskRewardPoint;
  riskPercentRange: [number, number];
  tp1RatioRange: [number, number];
  tp2RatioRange: [number, number];
  claimedRatio?: number;
}

export interface PlanInspectionResult {
  hasActivePlans: boolean;
  alerts: string[];
  plansStatus: Array<{
    name: string;
    direction: 'LONG' | 'SHORT';
    status: TradePlanStatus;
    distancePercent: number; // 距入场区间最近边界的距离 (%)
    statusDescription: string;
  }>;
}

export type CryptoPlanAction = 'WATCH' | 'MAINTAIN' | 'UPDATE' | 'INVALIDATE' | 'ENTER_SIMULATION';

export interface CryptoPlanDecision {
  type: 'crypto_plan_decision_v1';
  version: 1;
  mode: 'CREATE' | 'REVIEW';
  targetPlanId?: string;
  action: CryptoPlanAction;
  summary: string;
  analyzedAt: string;
  referencePrice?: number;
  proposedPlan?: PlanItem;
}

export function calculatePlanRiskReward(
  plan: Pick<PlanItem, 'direction' | 'entryMin' | 'entryMax' | 'stopLoss' | 'takeProfit1' | 'takeProfit2' | 'rrRatio'>
): PlanRiskRewardAnalysis | null {
  const pointAt = (entryPrice: number): PlanRiskRewardPoint | null => {
    const riskAmount = plan.direction === 'LONG'
      ? entryPrice - plan.stopLoss
      : plan.stopLoss - entryPrice;
    const tp1Reward = plan.direction === 'LONG'
      ? plan.takeProfit1 - entryPrice
      : entryPrice - plan.takeProfit1;
    const tp2Reward = plan.direction === 'LONG'
      ? plan.takeProfit2 - entryPrice
      : entryPrice - plan.takeProfit2;
    if (entryPrice <= 0 || riskAmount <= 0 || tp1Reward <= 0 || tp2Reward <= 0) return null;
    return {
      entryPrice,
      riskAmount,
      riskPercent: (riskAmount / entryPrice) * 100,
      tp1Ratio: tp1Reward / riskAmount,
      tp2Ratio: tp2Reward / riskAmount,
    };
  };

  const lowerEntry = pointAt(plan.entryMin);
  const midpointEntry = pointAt((plan.entryMin + plan.entryMax) / 2);
  const upperEntry = pointAt(plan.entryMax);
  if (!lowerEntry || !midpointEntry || !upperEntry) return null;

  const range = (values: number[]): [number, number] => [Math.min(...values), Math.max(...values)];
  const claimedMatch = plan.rrRatio?.match(/([0-9]+(?:\.[0-9]+)?)\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
  const claimedBase = Number(claimedMatch?.[1]);
  const claimedReward = Number(claimedMatch?.[2]);
  const claimedRatio = claimedBase > 0 && claimedReward > 0 ? claimedReward / claimedBase : undefined;

  return {
    lowerEntry,
    midpointEntry,
    upperEntry,
    riskPercentRange: range([lowerEntry.riskPercent, midpointEntry.riskPercent, upperEntry.riskPercent]),
    tp1RatioRange: range([lowerEntry.tp1Ratio, midpointEntry.tp1Ratio, upperEntry.tp1Ratio]),
    tp2RatioRange: range([lowerEntry.tp2Ratio, midpointEntry.tp2Ratio, upperEntry.tp2Ratio]),
    ...(claimedRatio ? { claimedRatio } : {}),
  };
}

/**
 * 从文本或 markdown (如 trade-plan.md, 聊天消息) 中解析结构化挂单方案
 */
export function parseTradePlansFromText(text: string): PlanItem[] {
  if (!text || typeof text !== 'string') return [];
  const plans: PlanItem[] = [];

  // 匹配方案块（兼容固定交易计划卡与历史战术卡格式）
  const planBlockRegex = /(?:(?:#{1,6}\s*)?[^\n]*?(?:交易计划卡|方案\s*[A-Za-z0-9一二三四]?|[多空]单(?:战术卡|方案|计划)|战术卡|开单计划|挂单方案|执行标准)[^\n]*)[\s\S]*?(?=(?:(?:#{1,6}\s*)?[^\n]*?(?:交易计划卡|方案\s*[A-Za-z0-9一二三四]?|[多空]单(?:战术卡|方案|计划)|战术卡|开单计划|挂单方案|执行标准)|$))/gi;
  const matches = [...text.matchAll(planBlockRegex)];

  for (const match of matches) {
    const block = match[0];
    const header = block.split('\n')[0];
    const isLong = /做多|多单|买入|Long/i.test(block);
    const isShort = /做空|空单|卖出|Short/i.test(block);
    if (!isLong && !isShort) continue;

    const direction: 'LONG' | 'SHORT' = isLong ? 'LONG' : 'SHORT';

    const parseNum = (val?: string) => (val ? parseFloat(val.replace(/,/g, '')) : 0);

    // 宽松匹配入场区间（支持 $、**、空格、表格符号等）
    const entryMatch = block.match(/(?:进场|入场|挂单|Entry)[^0-9\r\n]*?([0-9,]+(?:\.[0-9]+)?)\s*[-~～至到]\s*[^0-9\r\n]*?([0-9,]+(?:\.[0-9]+)?)/i);
    const slMatch = block.match(/(?:止损(?:\s*\([^)]*\))?|SL(?:\s*\([^)]*\))?)[^0-9\r\n]*?([0-9,]+(?:\.[0-9]+)?)/i);
    const tp1Match = block.match(/(?:第一(?:止盈)?目标|第一止盈|TP1|目标1|减仓保本点)(?:\s*\([^)]*\))?[^0-9\r\n]*?([0-9,]+(?:\.[0-9]+)?)/i);
    const tp2Match = block.match(/(?:第二(?:止盈)?目标|第二止盈|TP2|目标2|清仓)(?:\s*\([^)]*\))?[^0-9\r\n]*?([0-9,]+(?:\.[0-9]+)?)/i);
    const invalidMatch = block.match(/(?:(?:结构)?失效(?:线|位)?(?:\s*\([^)]*\))?|作废|Invalidation)[^0-9\r\n]*?([0-9,]+(?:\.[0-9]+)?)/i);
    const rrMatch = block.match(/(?:盈亏比|RR)[^0-9\r\n]*([0-9]+(?:\.[0-9]+)?\s*:\s*[0-9]+(?:\.[0-9]+)?)/i);

    let entryMin = parseNum(entryMatch?.[1]);
    let entryMax = parseNum(entryMatch?.[2]);
    if (entryMin > entryMax && entryMax > 0) {
      [entryMin, entryMax] = [entryMax, entryMin];
    }
    const stopLoss = parseNum(slMatch?.[1]);
    const takeProfit1 = parseNum(tp1Match?.[1]);
    const takeProfit2 = parseNum(tp2Match?.[1]);
    const invalidationPrice = parseNum(invalidMatch?.[1]) || stopLoss;

    const symMatch = block.match(/(?:交易标的|标的|币种|Symbol)[^A-Za-z0-9\r\n]*([A-Za-z0-9]+)/i)
      || block.match(/\b(BTC|ETH|SOL|DOGE|PEPE|SUI|XRP|BNB|AVAX|LINK|NEAR|ADA)\b/i);
    const symbol = symMatch?.[1]?.toUpperCase() || 'BTC';

    // 清理生成方案名称
    const cleanHeader = header.replace(/^#+\s*/, '').replace(/^[📋\s*【\[]+|[】\]\s*]+$/g, '').trim();
    const planName = cleanHeader || `${symbol} ${direction === 'LONG' ? '做多' : '做空'}方案`;

    if (entryMin > 0 && stopLoss > 0) {
      plans.push({
        id: `plan-${plans.length + 1}`,
        symbol,
        name: planName.includes(symbol) ? planName : `${symbol} ${planName}`,
        direction,
        status: 'PENDING',
        entryMin,
        entryMax: entryMax || entryMin,
        stopLoss,
        takeProfit1,
        takeProfit2,
        invalidationPrice,
        ...(rrMatch?.[1] ? { rrRatio: rrMatch[1] } : {}),
      });
    }
  }

  return plans;
}

export function extractCryptoTargetPlanId(text: string): string | undefined {
  const match = text.match(/(?:观察计划|计划)\s*ID\s*[：:]\s*([a-zA-Z0-9_-]{1,100})/i);
  return match?.[1];
}

function validPlanShape(plan: PlanItem): boolean {
  const values = [
    plan.entryMin,
    plan.entryMax,
    plan.stopLoss,
    plan.takeProfit1,
    plan.invalidationPrice,
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return false;
  if (plan.entryMin > plan.entryMax) return false;

  if (plan.direction === 'LONG') {
    return plan.stopLoss < plan.entryMin
      && plan.invalidationPrice < plan.entryMin
      && plan.takeProfit1 > plan.entryMax;
  }

  return plan.stopLoss > plan.entryMax
    && plan.invalidationPrice > plan.entryMax
    && plan.takeProfit1 < plan.entryMin;
}

function inferCryptoPlanAction(text: string, hasTargetPlan: boolean, hasPlan: boolean): CryptoPlanAction | null {
  const actionLine = text.match(/(?:当前动作|最终动作|最终结论|执行结论)[^\r\n]*/i)?.[0] || '';
  const source = actionLine || text;

  if (/(?:结构|计划|方案).{0,12}(?:失效|作废)|(?:取消|撤销|放弃).{0,8}(?:观察|计划|方案|挂单)/i.test(source)) {
    return 'INVALIDATE';
  }

  const forbidsEntry = /(?:严禁|禁止|不要|不可|暂不|不宜).{0,10}(?:开仓|进场|入场|追)/i.test(source);
  if (!forbidsEntry && /(?:立即|马上|当前|现价).{0,8}(?:模拟建仓|建立模拟仓位|开仓|进场|入场)/i.test(source)) {
    return 'ENTER_SIMULATION';
  }

  if (/(?:更新|调整|修改|微调).{0,10}(?:计划|方案|点位|入场|止损|止盈)|(?:计划|方案|点位).{0,10}(?:更新|调整|修改|微调)/i.test(source)) {
    return 'UPDATE';
  }

  if (/(?:继续|维持|保持).{0,8}(?:观察|等待|原计划|原方案)|无需调整|保持不变/i.test(source)) {
    return hasTargetPlan ? 'MAINTAIN' : 'WATCH';
  }

  if (hasTargetPlan && hasPlan) return 'UPDATE';
  if (!hasTargetPlan && hasPlan) return 'WATCH';
  return null;
}

/**
 * 将单条最终风控回复转换为程序可消费的交易决策。
 * 历史消息扫描仍可继续使用 parseTradePlansFromText，但不应再用于创建正式观察计划。
 */
export function parseCryptoPlanDecision(
  text: string,
  options: { targetPlanId?: string; analyzedAt?: string } = {}
): CryptoPlanDecision | null {
  if (!text || typeof text !== 'string') return null;

  const parsedPlan = parseTradePlansFromText(text).find(validPlanShape);
  const proposedPlan = parsedPlan
    ? {
        ...parsedPlan,
        takeProfit2: parsedPlan.takeProfit2 || parsedPlan.takeProfit1,
      }
    : undefined;
  const targetPlanId = options.targetPlanId || extractCryptoTargetPlanId(text);
  const action = inferCryptoPlanAction(text, Boolean(targetPlanId), Boolean(proposedPlan));
  if (!action) return null;
  if ((action === 'WATCH' || action === 'UPDATE') && !proposedPlan) return null;

  const actionLine = text.match(/(?:当前动作|最终动作|最终结论|执行结论)[^\r\n]*/i)?.[0];
  const referenceMatch = text.match(/(?:当前价格|当前现价|现价|参考价格)[^0-9\r\n]*([0-9,]+(?:\.[0-9]+)?)/i);
  const referencePrice = referenceMatch ? Number(referenceMatch[1].replace(/,/g, '')) : undefined;

  return {
    type: 'crypto_plan_decision_v1',
    version: 1,
    mode: targetPlanId ? 'REVIEW' : 'CREATE',
    ...(targetPlanId ? { targetPlanId } : {}),
    action,
    summary: (actionLine || text.split(/\r?\n/).find((line) => line.trim()) || action)
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, 300),
    analyzedAt: options.analyzedAt || new Date().toISOString(),
    ...(referencePrice && referencePrice > 0 ? { referencePrice } : {}),
    ...(proposedPlan ? { proposedPlan } : {}),
  };
}

/**
 * 对照实盘现价，巡检策略的生命周期与生效/失效状态
 */
export function inspectPlansLifecycle(plans: PlanItem[], currentPrice: number): PlanInspectionResult {
  if (!Array.isArray(plans) || plans.length === 0 || currentPrice <= 0) {
    return { hasActivePlans: false, alerts: [], plansStatus: [] };
  }

  const alerts: string[] = [];
  const plansStatus: PlanInspectionResult['plansStatus'] = [];

  for (const plan of plans) {
    let status: TradePlanStatus = 'PENDING';
    let statusDesc = '挂单等待中';
    let distPercent = 0;

    if (plan.direction === 'LONG') {
      // 1. 多单失效检查：价格跌穿结构失效位/止损线
      if (currentPrice <= plan.invalidationPrice) {
        status = 'EXPIRED';
        statusDesc = `已失效 (现价 $${currentPrice.toLocaleString()} 跌穿失效线 $${plan.invalidationPrice.toLocaleString()})`;
        alerts.push(`🚨 【多单方案失效预警】：现价 $${currentPrice.toLocaleString()} 已击穿结构失效位 $${plan.invalidationPrice.toLocaleString()}！${plan.name} 已失效（EXPIRED），请务必撤销原挂单！`);
      }
      // 2. 目标达成检查
      else if (plan.takeProfit1 > 0 && currentPrice >= plan.takeProfit1) {
        status = 'BREAKEVEN';
        statusDesc = `已达第一目标 ($${plan.takeProfit1.toLocaleString()})，推保本中`;
        alerts.push(`🎯 【止盈推保本提示】：现价 $${currentPrice.toLocaleString()} 已触达 ${plan.name} 的 TP1 目标 ($${plan.takeProfit1.toLocaleString()})，建议平仓 50% 并将止损上移至开仓价保本！`);
      }
      // 3. 入场区间触碰检查
      else if (currentPrice >= plan.entryMin && currentPrice <= plan.entryMax) {
        status = 'TRIGGERED';
        statusDesc = `已进入入场区间 ($${plan.entryMin.toLocaleString()} - $${plan.entryMax.toLocaleString()})`;
        alerts.push(`⚡ 【挂单触碰提示】：现价 $${currentPrice.toLocaleString()} 已进入 ${plan.name} 挂单区间！密切关注 15m 企稳信号，带好止损！`);
      }
      // 4. 等待回踩
      else {
        const diff = currentPrice - plan.entryMax;
        distPercent = (diff / currentPrice) * 100;
        statusDesc = distPercent > 0 ? `等待回踩中 (距入场区上方 +${distPercent.toFixed(2)}%)` : `距入场区下方 ${distPercent.toFixed(2)}%`;
      }
    } else {
      // 1. 空单失效检查：价格向上突破结构失效位/前高
      if (currentPrice >= plan.invalidationPrice) {
        status = 'EXPIRED';
        statusDesc = `已失效 (现价 $${currentPrice.toLocaleString()} 冲破失效线 $${plan.invalidationPrice.toLocaleString()})`;
        alerts.push(`🚨 【空单方案失效预警】：现价 $${currentPrice.toLocaleString()} 已放量冲破失效位 $${plan.invalidationPrice.toLocaleString()}！${plan.name} 已失效（EXPIRED），严禁在原点位挂空！`);
      }
      // 2. 目标达成检查
      else if (plan.takeProfit1 > 0 && currentPrice <= plan.takeProfit1) {
        status = 'BREAKEVEN';
        statusDesc = `已达第一目标 ($${plan.takeProfit1.toLocaleString()})，推保本中`;
        alerts.push(`🎯 【止盈推保本提示】：现价 $${currentPrice.toLocaleString()} 已触达 ${plan.name} 的 TP1 目标 ($${plan.takeProfit1.toLocaleString()})，建议平仓 50% 并推保本损！`);
      }
      // 3. 入场区间触碰检查
      else if (currentPrice >= plan.entryMin && currentPrice <= plan.entryMax) {
        status = 'TRIGGERED';
        statusDesc = `已进入入场区间 ($${plan.entryMin.toLocaleString()} - $${plan.entryMax.toLocaleString()})`;
        alerts.push(`⚡ 【挂单触碰提示】：现价 $${currentPrice.toLocaleString()} 已进入 ${plan.name} 挂单区间！密切关注 15m 滞涨信号！`);
      }
      // 4. 等待反弹
      else {
        const diff = plan.entryMin - currentPrice;
        distPercent = (diff / currentPrice) * 100;
        statusDesc = distPercent > 0 ? `等待反弹中 (距入场区下方 -${distPercent.toFixed(2)}%)` : `距入场区上方 +${distPercent.toFixed(2)}%`;
      }
    }

    plansStatus.push({
      name: plan.name,
      direction: plan.direction,
      status,
      distancePercent: distPercent,
      statusDescription: statusDesc,
    });
  }

  return {
    hasActivePlans: plans.length > 0,
    alerts,
    plansStatus,
  };
}

/**
 * 格式化为注入 System Prompt 的策略时效巡检看板
 */
export function formatPlanInspectionForPrompt(inspection: PlanInspectionResult, currentPrice: number): string {
  if (!inspection.hasActivePlans) return '';

  const statusLines = inspection.plansStatus.map(
    (p) => `  • 【${p.name}】状态: ${p.status} ➔ ${p.statusDescription}`
  ).join('\n');

  const alertLines = inspection.alerts.length > 0
    ? `\n【🚨 紧急时效预警 (必须在回复中首先提醒用户)】:\n` + inspection.alerts.map((a) => `  ${a}`).join('\n')
    : '';

  return `
---
【当前作战室活跃策略生命周期巡检 (基准现价: $${currentPrice.toLocaleString()})】
${statusLines}${alertLines}
---
`.trim();
}
