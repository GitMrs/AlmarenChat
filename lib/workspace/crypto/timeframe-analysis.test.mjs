import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStructure, alignedPriceChange, evaluateExecution } from './timeframe-analysis.mjs';
const row=(i,high,low=high-2)=>({startTimeMs:i*3600000,open:low+0.5,high,low,close:low+1,isClosed:true});
test('pivots are unavailable until two right-hand candles have closed',()=>{
 const rows=[row(0,3),row(1,4),row(2,8),row(3,5),row(4,4)];
 assert.equal(analyzeStructure(rows.slice(0,4),'1H').highs.length,0);
 assert.equal(analyzeStructure(rows,'1H').highs[0].confirmedAt,5*3600000);
 assert.equal(analyzeStructure([...rows.slice(0,4),{...rows[4],isClosed:false}],'1H').highs.length,0);
 assert.equal(analyzeStructure([rows[0],rows[1],rows[2],row(4,5),row(5,4)],'1H').highs.length,0);
});
test('OI comparison uses historical boundary prices rather than the live hourly delta',()=>{
 const s={oiDelta1hPercent:1,instId:'BTC-USDT-SWAP',dataQuality:{oiDelta1h:true},priceDelta1hPercent:99,
 oiDelta1hWindow:{instId:'BTC-USDT-SWAP',from:new Date(3600000).toISOString(),to:new Date(7200000).toISOString()},
 candles1h:[{...row(1,110,98),open:100},{...row(2,115,103),open:105}]};
 assert.equal(alignedPriceChange(s).percent,5);
 assert.equal(alignedPriceChange({...s,candles1h:s.candles1h.slice(1)}),null);
});
test('execution requires configured, fresh, closed and post-plan conditions',()=>{
 const at=Math.floor(Date.now()/900000)*900000-900000;
 const plan={direction:'LONG',executionCondition:{period:'15m',kind:'CLOSE_BREAKOUT',level:100,afterMs:at-900000}};
 const rows=[{startTimeMs:at-900000,close:99,isClosed:true},{startTimeMs:at,close:101,isClosed:true}];
 assert.equal(evaluateExecution({},{}).status,'UNCONFIGURED');
 assert.equal(evaluateExecution(plan,{candles15m:rows}).status,'MET');
 assert.equal(evaluateExecution(plan,{candles15m:[rows[0],{...rows[1],isClosed:false}]}).status,'WAITING');
 assert.equal(evaluateExecution({...plan,executionCondition:{...plan.executionCondition,afterMs:at+1}},{candles15m:rows}).status,'WAITING');
});

test('higher highs and higher lows define UP; falling pivots define DOWN', () => {
  const levels=[7,8,12,8,7,4,7,9,14,10,9,6,9,11,16,12,11,8,11,12];
  assert.equal(analyzeStructure(levels.map((v,i)=>row(i,v)), '1H').bias, 'UP');
  assert.equal(analyzeStructure(levels.map((v,i)=>row(i,30-v)), '1H').bias, 'DOWN');
});
test('future candles and non-finite values cannot confirm execution', () => {
  const now = 3600000;
  const plan={direction:'SHORT',executionCondition:{period:'15m',kind:'CLOSE_BREAKOUT',level:100,afterMs:0}};
  assert.equal(evaluateExecution(plan,{candles15m:[{startTimeMs:now,close:90,isClosed:true}]},now).status,'WAITING');
  assert.equal(evaluateExecution(plan,{candles15m:[{startTimeMs:now-900000,close:NaN,isClosed:true}]},now).status,'WAITING');
});

test('breaking an established trend marks transition rather than claiming reversal', () => {
  const levels=[7,8,12,8,7,4,7,9,14,10,9,6,9,11,16,12,11,8,11,12];
  const result=analyzeStructure([...levels.map((v,i)=>row(i,v)),row(20,4)], '1H');
  assert.equal(result.breakBelow,true);
  assert.equal(result.bias,'TRANSITION');
});
