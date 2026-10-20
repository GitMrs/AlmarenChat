import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { buildAgentWorldContext } from './events.ts';

test('space members receive shared world facts without replacing template rules or duplicating contract radar', async () => {
  const calls = [];
  const events = [{
    id: 'adp', title: 'ADP周度就业', category: 'macro', timestamp: '2026-10-20T12:15:00Z', impactCoins: ['ALL'], volatilityTier: 1,
    source: { provider: 'faireconomy', url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', title: 'ADP Weekly Employment Change', impact: 'Low', fetchedAt: '2026-10-20T00:00:00Z', calendarWeek: '2026-10-18' },
  }];
  const source = await readFile(new URL('../space-message-runtime.ts', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require(name) {
      if (name === './crypto/space-message-runtime') return {
        prepareCryptoSpaceMessageRuntime: async () => ({ promptContext: '原有合约事件雷达', agentPolicy: () => '原有风险规则' }),
        prepareGeneralCryptoQueryRuntime: async () => ({ promptContext: '', agentPolicy: () => '', assistantAttachments: () => [] }),
      };
      if (name === './world/context') return { loadAgentWorldContext: async options => {
        calls.push(options);
        return buildAgentWorldContext({ ...options, events, now: new Date('2026-10-20T04:00:00Z') });
      } };
      throw new Error(name);
    },
  });
  const input = { spaceId: 'space', textMessage: '今晚有什么数据？', persistedMessages: [], deferMarketQuery: true };
  for (const agentId of ['fx-kurumi', 'fx-mochiko', 'fx-mebuki', 'fx-yasuko']) {
    const runtime = await exports.prepareSpaceMessageRuntime({ ...input, agentId, templateId: 'wechat-article' });
    assert.match(runtime.promptContext, /公众号空间/);
    assert.match(runtime.promptContext, /共享现实事件/);
    assert.match(runtime.promptContext, /ADP周度就业/);
    assert.equal(calls.at(-1).agentId, agentId);
    assert.equal(runtime.assistantAttachments({}).length, 0);
  }
  const ordinary = await exports.prepareSpaceMessageRuntime({ ...input, agentId: 'ordinary' });
  assert.equal(ordinary.promptContext, '');
  const beforeContract = calls.length;
  const contract = await exports.prepareSpaceMessageRuntime({ ...input, agentId: 'fx-kurumi', templateId: 'crypto-contract-trading' });
  assert.equal(calls.length, beforeContract);
  assert.equal(contract.promptContext, '原有合约事件雷达');
  assert.equal(contract.agentPolicy({}), '原有风险规则');
});
