const WORLD_EVENT_AGENTS = new Set([
  'fx-kurumi', 'fx-mochiko', 'fx-mebuki', 'fx-yasuko',
  'crypto-chart-master', 'crypto-risk-warden', 'crypto-whale-hunter', 'crypto-ticker-sentinel',
]);
const FINANCE_QUERY = /财经|经济数据|宏观|数据公布|公布.*数据|盯盘|行情|合约|外汇|杠杆|爆仓|做多|做空|美联储|降息|加息|利率|非农|就业|失业|通胀|零售|美股|美元|大饼|比特币|以太坊|\b(?:BTC|ETH|CPI|PPI|PCE|ADP|NFP|FOMC|GDP|PMI)\b|(?:今天|今晚|明天|明晚|最近|近期).*(?:事件|大事|日历|数据|公布)/i;
const FOLLOW_UP = /^(?:(?:那|那么|然后|所以|它|这个|那个|这场|那场|后来|接下来|现在)[，,\s]*(?:呢|如何|怎么样|会|结果|公布|影响|涨|跌)|结果|公布|影响|还有呢)/;

export interface WorldEventHistoryMessage { role?: string; content?: string | null }

export const WORLD_EVENTS_UNAVAILABLE_CONTEXT = '【共享现实事件·财经】\n本轮财经事件资料暂不可用，不能声称已获取最新日历、公布值或行情；保留角色身份，正常回应，涉及最新事实时说明未知。';

export function isWorldEventAgent(agentId?: string | null): boolean {
  return Boolean(agentId && WORLD_EVENT_AGENTS.has(agentId));
}

/** 只在财经话题或紧接财经问题的追问中读取资料，不干扰其他闲聊。 */
export function resolveWorldEventQuery(query: string, history: readonly WorldEventHistoryMessage[] = []): string {
  if (FINANCE_QUERY.test(query)) return query;
  if (query.length > 80 || !FOLLOW_UP.test(query.trim())) return '';
  const recentUser = history.filter((message) => message.role === 'user' && message.content !== query).slice(-2);
  const previous = recentUser.at(-1)?.content ?? '';
  return FINANCE_QUERY.test(previous) ? `${previous}\n${query}` : '';
}
