import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTradePlansFromText,
  inspectPlansLifecycle,
  formatPlanInspectionForPrompt,
} from './trade-lifecycle.ts';

const SAMPLE_TRADE_TEXT = `
【30秒开单战术卡】
### 方案 A (箱体下沿做多)
- 方向：做多 (LONG)
- 挂单入场：82,600 - 82,750
- 结构止损：82,100
- 目标1：83,600
- 目标2：84,500
- 结构失效：82,100
- 盈亏比：1:2.3

### 方案 B (阻力突破做空)
- 方向：做空 (SHORT)
- 挂单入场：84,200 - 84,400
- 结构止损：84,850
- 目标1：83,200
- 目标2：82,500
- 结构失效：84,850
- 盈亏比：1:2.1
`;

test('parseTradePlansFromText extracts structured long and short plans', () => {
  const plans = parseTradePlansFromText(SAMPLE_TRADE_TEXT);
  assert.equal(plans.length, 2);

  const [longPlan, shortPlan] = plans;
  assert.equal(longPlan.direction, 'LONG');
  assert.equal(longPlan.entryMin, 82600);
  assert.equal(longPlan.entryMax, 82750);
  assert.equal(longPlan.stopLoss, 82100);
  assert.equal(longPlan.takeProfit1, 83600);
  assert.equal(longPlan.invalidationPrice, 82100);

  assert.equal(shortPlan.direction, 'SHORT');
  assert.equal(shortPlan.entryMin, 84200);
  assert.equal(shortPlan.entryMax, 84400);
  assert.equal(shortPlan.stopLoss, 84850);
  assert.equal(shortPlan.takeProfit1, 83200);
  assert.equal(shortPlan.invalidationPrice, 84850);
});

test('inspectPlansLifecycle identifies PENDING, TRIGGERED, BREAKEVEN, and EXPIRED states', () => {
  const plans = parseTradePlansFromText(SAMPLE_TRADE_TEXT);

  // 1. Pending: Price is between entry zones (e.g. 83,400)
  const pendingInspection = inspectPlansLifecycle(plans, 83400);
  assert.equal(pendingInspection.hasActivePlans, true);
  assert.equal(pendingInspection.plansStatus[0].status, 'PENDING');
  assert.equal(pendingInspection.plansStatus[1].status, 'PENDING');
  assert.equal(pendingInspection.alerts.length, 0);

  // 2. Triggered: Price enters long entry zone (82,700)
  const triggeredInspection = inspectPlansLifecycle(plans, 82700);
  assert.equal(triggeredInspection.plansStatus[0].status, 'TRIGGERED');
  assert.match(triggeredInspection.alerts[0], /已进入.*挂单区间/);

  // 3. Breakeven: Price hits TP1 (83,700)
  const tp1Inspection = inspectPlansLifecycle(plans, 83700);
  assert.equal(tp1Inspection.plansStatus[0].status, 'BREAKEVEN');
  assert.match(tp1Inspection.alerts[0], /已触达.*TP1 目标/);

  // 4. Invalidation: Price falls below long invalidation (82,000)
  const expiredInspection = inspectPlansLifecycle(plans, 82000);
  assert.equal(expiredInspection.plansStatus[0].status, 'EXPIRED');
  assert.match(expiredInspection.alerts[0], /已击穿结构失效位.*请务必撤销原挂单/);

  // 5. Short Invalidation: Price breaks above short invalidation (85,000)
  const shortExpiredInspection = inspectPlansLifecycle(plans, 85000);
  assert.equal(shortExpiredInspection.plansStatus[1].status, 'EXPIRED');
  assert.match(shortExpiredInspection.alerts.find(a => a.includes('空单')) || '', /冲破失效位.*严禁在原点位挂空/);
});

test('formatPlanInspectionForPrompt formats active inspection banner', () => {
  const plans = parseTradePlansFromText(SAMPLE_TRADE_TEXT);
  const inspection = inspectPlansLifecycle(plans, 82000);
  const prompt = formatPlanInspectionForPrompt(inspection, 82000);

  assert.match(prompt, /当前作战室活跃策略生命周期巡检/);
  assert.match(prompt, /EXPIRED/);
  assert.match(prompt, /紧急时效预警/);
});

test('parseTradePlansFromText parses bullet-list tactical cards with emojis and dollar signs', () => {
  const bulletCardText = `
### 📋 【30秒开单战术卡 · BTC 回踩多单微调案】

- **交易标的**：BTC-USDT-SWAP（永续）
- **操作方向**：**做多（Long）**
- **当前动作**：限价挂单（等待回踩确认，严禁现价追多）
- **进场区间 (Entry)**：**$82,850 - $82,950**（15m 顶底转换支撑区）
- **结构失效止损 (SL)**：**$82,450**（跌破 14:00 起涨点 $82,456 说明假突破，止损幅度约 450 刀 / 0.54%）
- **分批止盈目标**：
  - **TP1（第一阻力 / 减仓保本点）**：**$83,500**（触碰 4H 压制区平仓 50%，剩余仓位立刻推开仓价保本）
  - **TP2（趋势延伸 / 箱体上沿）**：**$84,100 - $84,250**（24H 前高流动性池全部清仓）
- **预期盈亏比**：
  - 到 TP1 空间：约 600 刀（RR 1 : 1.33）
  - 到 TP2 空间：约 1,200 刀（**终极盈亏比 1 : 2.67**，综合满足 ≥ 1:2 风控标准）
`;

  const plans = parseTradePlansFromText(bulletCardText);
  assert.equal(plans.length, 1);
  const p = plans[0];
  assert.equal(p.symbol, 'BTC');
  assert.equal(p.direction, 'LONG');
  assert.equal(p.entryMin, 82850);
  assert.equal(p.entryMax, 82950);
  assert.equal(p.stopLoss, 82450);
  assert.equal(p.takeProfit1, 83500);
  assert.equal(p.takeProfit2, 84100);
  assert.equal(p.invalidationPrice, 82450);
});

test('parseTradePlansFromText parses markdown table tactical cards', () => {
  const tableCardText = `
### 📋 【30秒开单战术卡 · 微调执行标准】

| 战术要素 | 最终执行参数与风控铁律 |
| :--- | :--- |
| **交易标的** | BTC-USDT-SWAP（永续合约） |
| **操作方向** | **做多（Long · 右侧回踩）** |
| **进场区间** | **$82,850 - $82,950**（限价分批挂单，**现价 $83,111 绝对禁止市价追多！**） |
| **硬性止损 (SL)** | **$82,450**（跌破 14:00 起涨点结构彻底破坏，无条件认赔离场，严禁扛单） |
| **第一目标 (TP1)** | **$83,500**（触及后**必须平仓 50% 锁定利润，并将剩余仓位止损立刻上移至开仓价保本**） |
| **第二目标 (TP2)** | **$84,100 - $84,250**（箱体顶部流动性池全部止盈清仓） |
| **预期盈亏比** | **1 : 2.67** |
| **风控红线** | 逐仓杠杆 ≤ 10x，单笔风险敞口 ≤ 总本金 2% |
`;

  const plans = parseTradePlansFromText(tableCardText);
  assert.equal(plans.length, 1);
  const p = plans[0];
  assert.equal(p.symbol, 'BTC');
  assert.equal(p.direction, 'LONG');
  assert.equal(p.entryMin, 82850);
  assert.equal(p.entryMax, 82950);
  assert.equal(p.stopLoss, 82450);
  assert.equal(p.takeProfit1, 83500);
  assert.equal(p.takeProfit2, 84100);
  assert.equal(p.invalidationPrice, 82450);
});
