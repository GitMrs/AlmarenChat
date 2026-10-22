import { extractCryptoSymbolFromText } from './okx-analysis.mjs';

const SNAPSHOT = /分析|深入|行情|走势|盘面|结构|支撑|阻力|压力位|资金费率|持仓量|\bOI\b|多空比|盘口|成交量|K线|情况|怎么样|如何|能(?:不能|否)买|可以(?:买|追)|适合.{0,6}(?:买|卖|做多|做空|入场)|(?:能|要)(?:做多|做空)|开仓|入场|止损|止盈/iu;
const QUOTE = /多少钱|什么价|啥价|报价|价格|现价|涨跌|涨了多少|跌了多少|涨多少|跌多少|到多少|多少了|(?:查|看).{0,6}(?:现在|当前)|(?:现在|当前).{0,6}(?:查|看)|\bprice\b/iu;
const LOOKUP = /查|看|分析|请问|如何|怎么样|怎样|多少|什么价|啥价|吗|么|？|\?|\bprice\b/iu;
const SKIP = /(?:不用|不要|别|无需).{0,6}(?:查|获取|联网|行情|价格)|(?:什么是|解释|科普|介绍).{0,12}(?:BTC|ETH|比特币|以太|资金费率|持仓量|多空比)|(?:昨天|前天|上周|上个月|去年|当时).{0,12}(?:多少|行情|价格)|(?:提醒|记一下|记住|定时|每天|每小时)/iu;
const FOLLOW_UP = /^(?:那|那么|再|继续|它|这个币|这币|请|帮我|现在|当前|的|呢|吧|一下|看看|看下|分析|深入|详细|价格|行情|走势|结构|支撑|阻力|资金费率|持仓量|多空比|能不能|可以|买|卖|做多|做空|入场|适合|怎么样|如何|多少|多少钱|什么价|什么价格|[，,。！？?\s])+$/u;

export function classifyCryptoMarketQuery(message, history = []) {
  const text = String(message || '').trim();
  const followUp = text.length <= 40 && FOLLOW_UP.test(text);
  const bareQuery = /^(?:BTC|ETH|SOL|SUI|DOGE|XRP|BNB|[A-Z0-9]{2,12}[-_/]?USDT|比特币|大饼|以太坊?)(?:的|当前|现在|最新|\s)*(?:价格|现价|报价|资金费率|持仓量|多空比|盘口|行情|走势)[？?]?$/iu.test(text);
  if (!text || SKIP.test(text) || (!LOOKUP.test(text) && !bareQuery && !followUp)) return null;
  const tool = SNAPSHOT.test(text) ? 'crypto_market_snapshot' : QUOTE.test(text) ? 'crypto_quote' : null;
  if (!tool) return null;
  let symbol = extractCryptoSymbolFromText(text);
  if (!symbol && followUp) {
    // Only carry a symbol across an immediate market follow-up, never from memories or old chat.
    const prior = history.filter((item) => item.role === 'user');
    if (prior.at(-1)?.content?.trim() === text) prior.pop();
    const last = String(prior.at(-1)?.content || '');
    if (!SKIP.test(last) && LOOKUP.test(last) && (QUOTE.test(last) || SNAPSHOT.test(last))) {
      symbol = extractCryptoSymbolFromText(last);
    }
  }
  if (!symbol && !/(?:加密|币价|币圈|合约|行情|做多|做空|费率|持仓量|盘口|K线)/u.test(text)) return null;
  return { tool, symbol };
}

export async function buildCryptoMarketContext({ message, history = [], query }) {
  const request = classifyCryptoMarketQuery(message, history);
  if (!request) return null;
  if (!request.symbol) return '【平台行情查询】请先询问用户要查询哪个币种，不默认使用BTC，不猜测价格。';
  try {
    const result = await query(request.tool, { symbol: request.symbol });
    if (!result) throw new Error('行情不可用');
    return `【平台只读行情：${request.tool}】\n${JSON.stringify(result)}\n这是OKX的USDT永续合约数据，不是现货或全网数据。标明来源、合约及时间；null或dataQuality为false表示缺失，不按0解读。周期涨跌是本周期开盘至现价，不是滚动窗口收益。不要把历史聊天中的价格当作最新价格。不包含用户仓位或有效交易计划，不声称已下单、建仓或启动监控。报价问题简短回答，分析时区分市场事实和你的推断，不编造清算热力图或保证收益。`;
  } catch {
    return `【平台行情查询失败】本轮未能取得${request.symbol}的可靠行情。明确告知查询失败，不沿用历史价格冒充现价，不猜测当前行情。`;
  }
}
