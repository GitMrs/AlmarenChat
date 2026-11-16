// Versioned, descriptive rules; these are not calibrated trading probabilities.
export const TIMEFRAME_GUIDANCE = '周期纪律：4H判断背景，1H制定交易结构，15m只核验计划执行条件；允许周期方向不同，逆向方案必须标明逆势。高低点需左右各2根已收盘K线确认，右侧确认有延迟；高低点均抬高判偏多、均降低判偏空，混合结构不强判方向。反向收盘突破只标记结构转变待确认，不能直接宣布趋势反转。未确认高低点不能提前使用。触碰区域不等于入场，硬止损不等待收线。';
export function analyzeStructure(candles = [], period = '4H') {
  const duration = { '4H': 14400000, '1H': 3600000, '15m': 900000 }[period];
  const rows = [...candles].filter(c => c?.isClosed === true && Number.isFinite(c.startTimeMs)
    && [c.open,c.high,c.low,c.close].every(v => Number.isFinite(v) && v > 0))
    .sort((a,b) => a.startTimeMs-b.startTimeMs);
  const highs = [], lows = [];
  for (let i=2;i<rows.length-2;i++) {
    const c=rows[i], neighbors=rows.slice(i-2,i+3);
    if (neighbors.some((r,j) => r.startTimeMs !== c.startTimeMs+(j-2)*duration)) continue;
    const point={ price:c.high, at:c.startTimeMs, confirmedAt:rows[i+2].startTimeMs+duration };
    if(neighbors.every(r=>r===c || c.high>r.high)) highs.push(point);
    if(neighbors.every(r=>r===c || c.low<r.low)) lows.push({...point,price:c.low});
  }
  const h=highs.slice(-2), l=lows.slice(-2);
  let bias='UNKNOWN';
  if(h.length===2 && l.length===2) bias=h[1].price>h[0].price && l[1].price>l[0].price?'UP':
    h[1].price<h[0].price && l[1].price<l[0].price?'DOWN':'MIXED';
  const last = rows.at(-1);
  const breakAbove = !!(last && h.length && last.close > h.at(-1).price);
  const breakBelow = !!(last && l.length && last.close < l.at(-1).price);
  // A close through the opposing pivot invalidates the old structure;
  // it does not, by itself, confirm a complete reversal.
  if ((bias === 'UP' && breakBelow) || (bias === 'DOWN' && breakAbove)) bias = 'TRANSITION';
  return {period, ruleVersion:'PIVOT_2_2_V1', closedCount:rows.length, bias, highs:h,lows:l,
    latestClosedAt:last ? last.startTimeMs + duration : null, breakAbove, breakBelow};
}
export function analyzeTimeframes(snapshot) {
  const background = analyzeStructure(snapshot.candles4h, '4H');
  const setup = analyzeStructure(snapshot.candles1h, '1H');
  const directional = [background.bias, setup.bias].every(b => ['UP', 'DOWN'].includes(b));
  return { background, setup, relationship: directional
    ? (background.bias === setup.bias ? 'ALIGNED' : 'COUNTER_TREND') : 'UNDETERMINED',
    execution: analyzeStructure(snapshot.candles15m, '15m'), guidance: TIMEFRAME_GUIDANCE };
}
export function alignedPriceChange(snapshot) {
  const w=snapshot.oiDelta1hWindow;
  if(!snapshot.dataQuality?.oiDelta1h || !Number.isFinite(snapshot.oiDelta1hPercent) || !w || w.instId!==snapshot.instId) return null;
  const from=Date.parse(w.from),to=Date.parse(w.to);
  if(to-from!==3600000) return null;
  const row=snapshot.candles1h?.find(c=>c.startTimeMs===from && c.isClosed===true);
  // Hour-boundary open is the price sample; never use a later live quote.
  const end=snapshot.candles1h?.find(c=>c.startTimeMs===to);
  if(!row || !(row.open>0) || !(end?.open>0)) return null;
  return {from:w.from,to:w.to,percent:(end.open-row.open)/row.open*100};
}
export function evaluateExecution(plan, snapshot, now = Date.now()) {
  const c=plan.executionCondition;
  if(!c) return {status:'UNCONFIGURED',reason:'未设置执行条件；触碰仅作观察提醒'};
  if(!['15m','1H'].includes(c.period) || !['CLOSE_BREAKOUT','RETEST'].includes(c.kind)
    || !Number.isFinite(c.level) || c.level<=0 || !Number.isFinite(c.afterMs)) return {status:'UNKNOWN',reason:'执行条件无效'};
  const duration=c.period==='15m'?900000:3600000;
  const rows=(c.period==='15m'?snapshot.candles15m:snapshot.candles1h)||[];
  const closed=rows.filter(r=>r.isClosed===true && r.startTimeMs>=c.afterMs
    && r.startTimeMs+duration<=now && Number.isFinite(r.close) && r.close>0
    && (c.kind!=='RETEST' || [r.high,r.low].every(v=>Number.isFinite(v) && v>0))).sort((a,b)=>b.startTimeMs-a.startTimeMs);
  const latest=closed[0];
  if(!latest || now-(latest.startTimeMs+duration)>duration*2) return {status:'WAITING',reason:'等待新的有效收盘数据'};
  const long=plan.direction==='LONG';
  const held=long?latest.close>c.level:latest.close<c.level;
  const prior=closed.find(r=>r.startTimeMs===latest.startTimeMs-duration);
  const met=c.kind==='RETEST'? held && prior && (long?prior.close>c.level:prior.close<c.level) && (long?latest.low<=c.level:latest.high>=c.level):
    held && prior && (long?prior.close<=c.level:prior.close>=c.level);
  return {status:met?'MET':'WAITING',reason:met?'指定周期收线条件满足；仍需用户确认模拟仓位':'执行条件尚未满足', candleAt:latest.startTimeMs};
}
