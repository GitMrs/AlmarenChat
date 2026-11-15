import { extractCryptoSymbolFromText } from '../workspace/crypto/okx-analysis.mjs';
import { queryCryptoMarket } from '../workspace/crypto/market-tools';

const CRYPTO_REVIEW_GUIDANCE = [
  '【合约复查】每次明确写出“进入候选方案评估的条件”和“结束当前观察的条件”：说明关键价格、指定周期收线/回踩要求和待验证数据。资料不足时说明缺什么，不编造阈值，不强行给单。进入评估仍需空间既有分工核验与风控审核。',
  '【OI时效】OI金额与币种合约统计的1H变化是不同口径。引用1H变化时标明 oiDelta1hWindow 的比较起止时间与币种范围，derivativesFetchedAt 只是抓取时间。与上次窗口相同即“沿用同一统计窗口，未获得新窗口确认”；窗口更新但数值相同应说明“新窗口数值相同”，不要仅凭百分比相同判断数据未更新。窗口缺失时明确时间未知，不宣称获得最新一小时新增确认。',
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
    ? `OI 统计依据：OKX ${symbol} 币种合约统计，${displayTime(window.from)} 至 ${displayTime(window.to)}，变化 ${snapshot.oiDelta1hPercent?.toFixed(2)}%；本轮采集 ${displayTime(snapshot.derivativesFetchedAt)}（均为北京时间）。统计时点与采集时间不同，同一窗口不作为新增确认。`
    : 'OI 统计依据：本轮未取得可靠的 1H 比较窗口，不作为最新一小时的新增确认。';
  return { context, guidance: CRYPTO_REVIEW_GUIDANCE, evidence, isCrypto: true };
}
