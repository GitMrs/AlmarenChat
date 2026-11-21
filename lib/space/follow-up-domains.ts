import { TIMEFRAME_GUIDANCE } from '../workspace/crypto/timeframe-analysis.mjs';
import { extractCryptoSymbolFromText } from '../workspace/crypto/okx-analysis.mjs';
import { queryCryptoMarket } from '../workspace/crypto/market-tools';

const CRYPTO_REVIEW_GUIDANCE = [
  TIMEFRAME_GUIDANCE,
  '【合约复查】每次明确写出“进入候选方案评估的条件”和“结束当前观察的条件”：说明关键价格、指定周期收线/回踩要求和待验证数据。影响本次判断的关键资料不足时说明缺什么，不编造阈值，不强行给单。进入评估仍需空间既有分工核验与风控审核。',
  '【清算资料】清算数据仅作可选辅助证据，不是复查必填项；常规复查以价格结构、成交量、OI、资金费率和计划执行/失效条件为主。清算数据缺失时无需固定列出缺项，不因这一缺项阻止计划条件核验或单独安排续查。用户明确要求清算分析，或本次结论确实依赖清算证据时，才说明资料限制；没有可靠来源、合约单位和统计时间范围时，不依据记录数推断清算金额、集中爆仓或清算驱动方向，不把OKX有限记录称为全网统计或清算热力图。',
  '【OI时效】当前OI金额以美元计，1H变化按同一合约的持仓张数计算。引用1H变化时标明 oiDelta1hWindow 的比较起止时间、instId与持仓张数口径；与价格联动分析前须核对比较窗口是否一致，derivativesFetchedAt 只是抓取时间。与上次窗口相同即“沿用同一统计窗口，未获得新窗口确认”；窗口更新但数值相同应说明“新窗口数值相同”，不要仅凭百分比相同判断数据未更新。窗口缺失时明确时间未知，不宣称获得最新一小时新增确认。',
].join('\n');

export async function prepareFollowUpDomain(task: any) {
  if (task.domain !== 'CRYPTO') return { context: '', guidance: '', evidence: '', isCrypto: false };
  const symbol = extractCryptoSymbolFromText(task.prompt) || extractCryptoSymbolFromText(task.title);
  if (!symbol) return { context: '', guidance: CRYPTO_REVIEW_GUIDANCE, evidence: '', isCrypto: true };
  if (!task.networkAllowed) throw new Error('本次行情复查没有联网授权');
  const snapshot = await queryCryptoMarket('crypto_market_snapshot', { symbol });
  if (!snapshot) throw new Error(`未取得 ${symbol} 的可靠新行情`);
  const context = `【本次复查新获取的 OKX USDT 永续行情】\n${JSON.stringify(snapshot)}\n缺失字段不得当作0或自行补全；以各字段数据时间为准。`;
  const window = snapshot.oiDelta1hWindow;
  const displayTime = (value: string) => new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const evidence = window
    ? `OI 统计依据：OKX ${window.instId} 持仓张数，${displayTime(window.from)} 至 ${displayTime(window.to)}，变化 ${snapshot.oiDelta1hPercent?.toFixed(2)}%；本轮采集 ${displayTime(snapshot.derivativesFetchedAt)}（均为北京时间）。统计时点与采集时间不同，同一窗口不作为新增确认。`
    : 'OI 统计依据：本轮未取得可靠的 1H 比较窗口，不作为最新一小时的新增确认。';
  return { context, guidance: CRYPTO_REVIEW_GUIDANCE, evidence, isCrypto: true, snapshot };
}
