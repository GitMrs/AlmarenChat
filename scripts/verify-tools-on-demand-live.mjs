// Explicit live-model smoke check. Sends synthetic conversations only; query
// executors use fixtures so this does not query weather, accounts or markets.
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createAutoWebTools, runAutoWebChat } from '../lib/web/auto-web-core.mjs';
import { createChatDataTools } from '../lib/chat/chat-data-tools.mjs';
import { resolveCapabilities } from '../lib/capabilities/resolver.mjs';
import { createCapabilityHelpTool } from '../lib/capabilities/help.mjs';

const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1];
const baseURL = args[args.indexOf('--base-url') + 1];
if (!args.includes('--model') || !args.includes('--base-url') || !model || !baseURL) {
  throw new Error('Usage: node scripts/verify-tools-on-demand-live.mjs --model MODEL --base-url URL');
}
dotenv.config({ path: ['.env.local', '.env'], quiet: true });
process.env.ALMAREN_MODEL_DEBUG_LOGS = '0';
const client = new OpenAI({ baseURL, apiKey: process.env.apiKey || process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 0 });
const scenarios = [
  { id: 'idle', messages: [{ role: 'user', content: '你好，今天有点累，想随便聊聊。' }], query: false },
  { id: 'weather', messages: [{ role: 'user', content: '帮我查北京现在的天气' }], query: true },
  { id: 'continuation', messages: [
    { role: 'user', content: '等下想查杭州的天气。' },
    { role: 'assistant', content: '好的，要查询时告诉我。' },
    { role: 'user', content: '现在查一下刚才说的那个吧' },
  ], query: true },
  { id: 'failed_query', messages: [{ role: 'user', content: '查一下今天北京天气' }], query: true, fail: true },
  { id: 'permission_denied', messages: [{ role: 'user', content: '帮我查北京现在的天气；不能查询的话就说明原因。' }], query: false, denied: true },
  { id: 'load_failed', messages: [
    { role: 'user', content: '等下想查杭州的天气。' },
    { role: 'assistant', content: '好的，要查询时告诉我。' },
    { role: 'user', content: '现在查一下刚才说的那个吧，能力不可用就直接告诉我。' },
  ], query: false, failLoad: true },
];

for (const scenario of scenarios) {
  const calls = [];
  const schemas = [];
  const dataTools = createChatDataTools({
    weather: { query: async () => {
      calls.push('weather_query');
      if (scenario.fail) throw new Error('测试数据源不可用');
      return { observations: [{ temp: 18, text: '晴' }], location: { name: '测试城市' }, updateTime: new Date().toISOString() };
    } },
    trending: async () => ({ items: [] }), crypto: async () => null,
  });
  const permittedCapabilities = scenario.denied ? [] : undefined;
  const resolution = resolveCapabilities({ entry: 'agent', query: scenario.messages.at(-1).content, permittedCapabilities });
  const loadableCapabilities = scenario.denied ? [] : ['web', 'weather', 'trending', 'crypto'];
  const web = createAutoWebTools({
    dataTools, availableToolNames: resolution.tools,
    loadableCapabilities,
    search: async () => ({ ok: false, error: '测试不执行外部搜索' }),
    fetchPage: async () => ({ ok: false, error: '测试不读取外部网页' }),
  });
  let loadAttempts = 0;
  if (scenario.failLoad) {
    const execute = web.execute;
    web.execute = async (name, args) => {
      if (name !== 'capability_load') return execute(name, args);
      loadAttempts += 1;
      return { ok: false, error: '测试加载器暂时不可用，本轮无法加载查询工具。' };
    };
  }
  const help = createCapabilityHelpTool({ entry: 'agent', permittedCapabilities, loadableCapabilities,
    getAvailableToolNames: () => web.tools.map((tool) => tool.function.name) });
  const observedClient = { chat: { completions: { create: (body, options) => {
    schemas.push(body.tools.map((tool) => tool.function.name));
    return client.chat.completions.create({ ...body, max_tokens: 1800 }, options);
  } } } };
  try {
    const answer = await runAutoWebChat({
      client: observedClient, model, messages: scenario.messages, web,
      extraTools: [help.tool], callTool: (name) => name === 'capability_help' ? help.execute() : { ok: false, error: '未知测试工具' },
      signal: AbortSignal.timeout(90000),
    });
    const passed = Boolean(answer.trim()) && (scenario.query ? calls.includes('weather_query') : calls.length === 0)
      && (!scenario.failLoad || loadAttempts > 0);
    console.log(JSON.stringify({ id: scenario.id, passed, schemas, calls, loadAttempts, answer: answer.slice(0, 500) }));
    if (!passed) process.exitCode = 1;
  } catch (error) {
    // Do not print provider response bodies, headers or client configuration.
    console.log(JSON.stringify({ id: scenario.id, passed: false, errorType: error.name, status: error.status || null }));
    process.exitCode = 1;
    break;
  }
}
