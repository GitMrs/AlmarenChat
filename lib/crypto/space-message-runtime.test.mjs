import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function loadRuntime() {
  const calls = [];
  const source = await readFile(new URL('./space-message-runtime.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, console, require: (name) => {
    if (name === './okx-service') return {
      extractCryptoSymbolFromText: () => 'BTC',
      getCryptoMarketData: async () => { calls.push('unexpected-network'); return null; },
    };
    if (name === './sentinel-service') return { getSentinelState: async () => ({
      ambushPlans: [{ id: 'btc-watch', symbol: 'BTC', name: '已确认观察' }, { id: 'eth-watch', symbol: 'ETH' }],
      activePositions: [{ id: 'btc-position', symbol: 'BTC', name: '已确认持仓' }],
    }) };
    if (name === './trade-lifecycle') return {
      inspectPlansLifecycle: (plans, price) => { calls.push({ plans, price }); return 'inspection'; },
      formatPlanInspectionForPrompt: (inspection, price) => `${inspection}:${price}`,
      extractCryptoTargetPlanId: () => 'btc-watch',
      parseCryptoPlanDecision: () => ({ type: 'crypto_plan_decision', id: 'btc-watch' }),
    };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return { runtime: exports, calls };
}

test('general space chat no longer preloads a crypto snapshot', async () => {
  const { runtime, calls } = await loadRuntime();
  const prepared = await runtime.prepareGeneralCryptoQueryRuntime({ spaceId: 'space', textMessage: 'BTC多少钱', persistedMessages: [], deferMarketQuery: true });
  assert.equal(prepared.promptContext, '');
  assert.deepEqual(calls, []);
});

test('contract chat keeps confirmed trading state and runs inspection only with queried market data', async () => {
  const { runtime, calls } = await loadRuntime();
  const prepared = await runtime.prepareCryptoSpaceMessageRuntime({ spaceId: 'space', textMessage: '你好', persistedMessages: [], deferMarketQuery: true });
  assert.deepEqual(calls, []);
  assert.match(prepared.promptContext, /已确认观察/);
  assert.match(prepared.promptContext, /已确认持仓/);
  assert.equal(prepared.marketContext({ symbol: 'BTC', price: 100 }), 'inspection:100');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].price, 100);
  assert.equal(calls[0].plans.length, 1);
  assert.equal(calls[0].plans[0].id, 'btc-watch');
  assert.equal(prepared.assistantAttachments({ agentId: 'crypto-risk-warden', assistantContent: '风控决定', textMessage: '复查观察计划', rawHistory: [] })[0].type, 'crypto_plan_decision');
});
