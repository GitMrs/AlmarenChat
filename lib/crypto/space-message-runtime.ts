import {
  extractCryptoTargetPlanId,
  formatPlanInspectionForPrompt,
  inspectPlansLifecycle,
  parseCryptoPlanDecision,
  parseTradePlansFromText,
  type PlanItem,
} from './trade-lifecycle';
import { extractCryptoSymbolFromText, formatCryptoContextForPrompt, getCryptoMarketData } from './okx-service';
import { getSentinelState, type ActivePositionItem, type AmbushPlanItem } from './sentinel-service';

export interface RuntimeHistoryMessage {
  role?: string;
  content?: string | null;
}

export interface CryptoMessageRuntimeInput {
  spaceId: string;
  textMessage: string;
  persistedMessages: RuntimeHistoryMessage[];
}

export interface CryptoAgentPolicyInput {
  agentId: string;
  isCoordinator: boolean;
}

export interface CryptoAttachmentInput {
  agentId: string;
  assistantContent: string;
  textMessage: string;
  rawHistory: RuntimeHistoryMessage[];
}

export interface PreparedCryptoMessageRuntime {
  promptContext: string;
  agentPolicy(input: CryptoAgentPolicyInput): string;
  assistantAttachments(input: CryptoAttachmentInput): object[];
}

const CRYPTO_QUERY_PATTERN = /(?:BTC|ETH|SOL|SUI|DOGE|PEPE|XRP|BNB|APT|AVAX|LINK|NEAR|ADA|TRX|DOT|ARB|OP|WIF|TON|AAVE|UNI|合约|开单|做多|做空|多单|空单|持仓|费率|OI|抄底|止损|大饼|以太)/i;

const EMPTY_RUNTIME: PreparedCryptoMessageRuntime = {
  promptContext: '',
  agentPolicy: () => '',
  assistantAttachments: () => [],
};

function formatTradingState(
  observationPlans: AmbushPlanItem[],
  openPositions: ActivePositionItem[]
): string {
  const positionContext = openPositions.length > 0
    ? [
        '【当前已开仓仓位】',
        ...openPositions.map((position) => [
          `- 仓位 ID：${position.id}`,
          `  ${position.symbol} ${position.direction}｜${position.name}`,
          `  成交价：${position.entryPrice}｜止损：${position.stopLoss}｜TP1：${position.takeProfit1}｜TP2：${position.takeProfit2}`,
          `  名义仓位：${position.positionSizeUsd} USDT｜杠杆：${position.leverage}x｜开仓时间：${position.openedAt}`,
        ].join('\n')),
      ].join('\n')
    : '【当前已开仓仓位】无。';

  const observationContext = observationPlans.length > 0
    ? [
        '【当前已确认加入的观察计划】',
        ...observationPlans.map((plan) => [
          `- 观察计划 ID：${plan.id}`,
          `  ${plan.symbol} ${plan.direction}｜${plan.name}`,
          `  入场：${plan.entryMin} - ${plan.entryMax}｜止损：${plan.stopLoss}｜TP1：${plan.takeProfit1}｜TP2：${plan.takeProfit2}｜结构失效：${plan.invalidationPrice}`,
        ].join('\n')),
      ].join('\n')
    : '【当前已确认加入的观察计划】无。';

  const policy = openPositions.length > 0
    ? '当前存在已开仓仓位。必须优先按实盘风控标准分析持仓风险、止损、止盈、减仓或退出，不得因系统实现方式降低风险等级；除非用户明确要求，否则不要另开无关新单。'
    : observationPlans.length > 0
      ? '当前存在有效观察计划。分析时必须引用对应的观察计划 ID，并优先结合最新行情复查、维护、调整或决定是否转为开仓仓位；除非用户明确要求新方案或其他标的，否则不得另开无关新单。'
      : '当前没有已开仓仓位或已确认观察计划。不要把历史聊天中出现但未经用户确认的策略当成有效计划；可以继续讨论行情，并在用户明确需要时生成新方案。';

  return [positionContext, observationContext, policy].join('\n\n');
}

async function appendMarketContext(
  baseContext: string,
  input: CryptoMessageRuntimeInput,
  observationPlans: AmbushPlanItem[],
  isCryptoSpace: boolean
): Promise<string> {
  const symbol = extractCryptoSymbolFromText(input.textMessage) || (isCryptoSpace ? 'BTC' : null);
  if (!symbol) return baseContext;

  const snapshot = await getCryptoMarketData(symbol);
  if (!snapshot) return baseContext;

  let promptContext = baseContext
    ? `${baseContext}\n\n${formatCryptoContextForPrompt(snapshot)}`
    : formatCryptoContextForPrompt(snapshot);
  const activePlans: PlanItem[] = isCryptoSpace
    ? observationPlans
        .filter((plan) => plan.symbol.toUpperCase() === snapshot.symbol.toUpperCase())
        .map((plan) => ({ ...plan, status: 'PENDING' }))
    : parseTradePlansFromText(
        input.persistedMessages.slice(-10).map((message) => message.content || '').join('\n')
      );
  if (activePlans.length > 0) {
    const inspection = inspectPlansLifecycle(activePlans, snapshot.price);
    const inspectionPrompt = formatPlanInspectionForPrompt(inspection, snapshot.price);
    if (inspectionPrompt) promptContext += `\n\n${inspectionPrompt}`;
  }
  return promptContext;
}

function cryptoAgentPolicy(hasOpenPositions: boolean, input: CryptoAgentPolicyInput): string {
  const rolePolicy = input.isCoordinator
    ? '【协调者特别纪律】：协调者仅做隐形场控与简要调度，【绝对禁止代替凌风提前发布完整的开单方案与挂单点位】！开单点位方案必须由凌风主导提出，筹码由幽影解读，仓位与盈亏比由雷震把关，盘面异动由鹰眼鸣警。'
    : input.agentId === 'crypto-risk-warden'
      ? [
          hasOpenPositions
            ? '【最终风控纪律】：当前存在已开仓仓位，你必须先给出继续持有、调整止损、分批止盈或全部退出之一的持仓决策；不得把已开仓仓位重新当作观察计划，也不得再建立同一笔仓位。'
            : '【最终风控纪律】：你负责给出唯一的最终决策。当前动作只能是继续观察、维持原计划、调整计划、原计划失效、立即建立模拟仓位之一。',
          '新建或调整观察计划时，回复末尾必须严格附带以下字段完整的固定格式；“交易计划卡”是执行摘要，不代表 30 秒行情周期：',
          '【交易计划卡】',
          '最终结论：<审核结论>',
          '当前动作：<上述五种动作之一>',
          '观察计划 ID：<复查已有计划时填写实际 ID；新建计划填写“无”>',
          '交易标的：<如 BTC-USDT-SWAP>',
          '交易方向：<做多或做空>',
          '入场区间：<最低价> - <最高价>',
          '止损：<价格>',
          'TP1：<价格>',
          'TP2：<价格>',
          '结构失效：<价格>',
          '盈亏比：<如 1:2.5>',
          '区间分隔符必须使用半角连字符“-”，不得遗漏字段或改写字段名。复查系统提供的已确认观察计划时，必须原样填写对应的观察计划 ID。用户未说明本金规模时，引导其对齐实际账户净值。',
        ].join('\n')
      : '【专业分析纪律】：你负责提供本角色的专业分析依据，不替代雷震发布最终风控结论，也不要把中间意见包装成最终执行命令；需要形成交易计划时，请明确邀请雷震完成最终审核。';

  return [
    '本空间为加密合约实战作战室。当分析行情与开单时，严格依托所注入的实时 OKX 盘面数据进行技术和筹码推演，严禁脱离实盘数据胡编价格；严格遵守轻重双轨制，日常看盘快问快答短平快，开单把关必须核验盈亏比 ≥ 1:2 与 2% 风控线。',
    rolePolicy,
  ].join('\n');
}

export async function prepareCryptoSpaceMessageRuntime(
  input: CryptoMessageRuntimeInput
): Promise<PreparedCryptoMessageRuntime> {
  let observationPlans: AmbushPlanItem[] = [];
  let openPositions: ActivePositionItem[] = [];
  let promptContext = '';

  try {
    const state = await getSentinelState(input.spaceId);
    observationPlans = state.ambushPlans;
    openPositions = state.activePositions;
    promptContext = formatTradingState(observationPlans, openPositions);
  } catch (error: any) {
    console.warn('[spaces/crypto] Confirmed trading state retrieval failed:', error?.message);
    promptContext = '【交易状态】读取失败，当前无法确认是否存在已开仓仓位或有效观察计划。不要根据历史聊天自行认定计划已经生效。';
  }

  if (input.textMessage.trim()) {
    try {
      promptContext = await appendMarketContext(promptContext, input, observationPlans, true);
    } catch (error: any) {
      console.warn('[spaces/crypto] Crypto market data fetch failed:', error?.message);
    }
  }

  return {
    promptContext,
    agentPolicy: (policyInput) => cryptoAgentPolicy(openPositions.length > 0, policyInput),
    assistantAttachments: (attachmentInput) => {
      if (attachmentInput.agentId !== 'crypto-risk-warden') return [];
      const lastUserContent = [...attachmentInput.rawHistory]
        .reverse()
        .find((message) => message.role === 'user')?.content || '';
      const decision = parseCryptoPlanDecision(attachmentInput.assistantContent, {
        targetPlanId: extractCryptoTargetPlanId(attachmentInput.textMessage)
          || extractCryptoTargetPlanId(lastUserContent),
      });
      return decision ? [decision] : [];
    },
  };
}

export async function prepareGeneralCryptoQueryRuntime(
  input: CryptoMessageRuntimeInput
): Promise<PreparedCryptoMessageRuntime> {
  if (!input.textMessage.trim() || !CRYPTO_QUERY_PATTERN.test(input.textMessage)) return EMPTY_RUNTIME;
  try {
    return {
      ...EMPTY_RUNTIME,
      promptContext: await appendMarketContext('', input, [], false),
    };
  } catch (error: any) {
    console.warn('[spaces/crypto] Crypto market data fetch failed:', error?.message);
    return EMPTY_RUNTIME;
  }
}
