import { estimateRequestTokens } from '../memory/conversation-context-policy.mjs';
import { MEMORY_RECALL_GUIDANCE } from '../memory/memory-recall.mjs';
import { logModelRequest } from '../chat/model-request-log.mjs';
import { collectChatCompletionStream, runToolLoop } from '../agents/runtime/tool-loop.mjs';
import { buildToolGuidance } from '../chat/tool-policy.mjs';
import { getCapability } from '../capabilities/registry.mjs';

export const AUTO_WEB_GUIDANCE = buildToolGuidance();

const HISTORY_TIMESTAMP_PREFIX = '[历史消息时间：';
const HISTORY_TIMESTAMP_TOKEN_PATTERN = /[\[【]\s*历史消息时间\s*[:：]\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s*[,，]?\s*北京时间\s*[\]】]/gu;
const HISTORY_TIMESTAMP_PATTERN = new RegExp(`^\\s*(?:${HISTORY_TIMESTAMP_TOKEN_PATTERN.source}\\s*\\r?\\n?)+`, 'u');

export const AUTO_WEB_SCHEMAS = [
  { type: 'function', function: { name: 'web_search', description: '按需搜索公共互联网的最新事实和外部资料，返回来源与检索时间。', parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 300 } } } } },
  { type: 'function', function: { name: 'web_fetch', description: '读取指定公开 HTTPS 网页或 JSON。禁止本机、内网地址。', parameters: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', maxLength: 2000 } } } } },
];

export function createAutoWebTools({ search = undefined, fetchPage = undefined, dataTools = [], availableToolNames = undefined, loadableCapabilities = [], pendingWeather = null, signal: turnSignal = undefined, onStatus = undefined, limit = 3, timeoutMs = 20_000 } = {}) {
  const records = [];
  const cache = new Map();
  const additionalAttachments = new Map();
  const allowed = availableToolNames ? new Set(availableToolNames) : null;
  const pool = [...AUTO_WEB_SCHEMAS, ...dataTools.map((tool) => tool.schema)];
  const loadable = loadableCapabilities.map((id) => getCapability(id)).filter((capability) => capability?.owner === 'external'
    && capability.activation === 'on_demand' && capability.risk === 'read_external'
    && capability.tools.some((name) => pool.some((tool) => tool.function.name === name)));
  const tools = [
    ...AUTO_WEB_SCHEMAS.filter(schema => !allowed || allowed.has(schema.function.name)),
    ...dataTools.filter((tool) => !allowed || allowed.has(tool.schema.function.name)).map((tool) => tool.schema),
  ];
  if (loadable.length) tools.push({
    type: 'function',
    function: {
      name: 'capability_load',
      description: `当前问题需要外部资料但对应查询工具尚未提供时，加载一项已获平台允许的只读能力；只加载工具，不执行查询。可选能力：${loadable.map((item) => `${item.id}（${item.label}）`).join('、')}。根据完整对话判断，普通闲聊无需加载。`,
      parameters: { type: 'object', additionalProperties: false, required: ['capability'], properties: { capability: { type: 'string', enum: loadable.map((item) => item.id) } } },
    },
  });
  let used = 0;
  async function execute(name, args = {}, operationSignal = undefined) {
    const signal = turnSignal && operationSignal ? AbortSignal.any([turnSignal, operationSignal]) : turnSignal || operationSignal;
    if (!tools.some((tool) => tool.function.name === name)) throw new Error('未知联网工具');
    signal?.throwIfAborted();
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: '查询参数必须为对象' };
    if (name === 'capability_load') {
      const capability = loadable.find((item) => item.id === args.capability);
      if (!capability) return { ok: false, error: '当前入口不允许加载此能力' };
      for (const schema of pool.filter((tool) => capability.tools.includes(tool.function.name))) {
        if (!tools.some((tool) => tool.function.name === schema.function.name)) tools.push(schema);
      }
      return { ok: true, capability: capability.label, message: '工具已加入本轮；继续调用查询工具，尚未取得外部数据。' };
    }
    const dataTool = dataTools.find((tool) => tool.schema.function.name === name);
    const value = dataTool ? JSON.stringify(Object.fromEntries(Object.entries(args).sort(([left], [right]) => left.localeCompare(right)))) : String(name === 'web_search' ? args.query || '' : args.url || '').trim();
    if (!value || value.length > (dataTool ? 4000 : name === 'web_search' ? 300 : 2000)) return { ok: false, error: '查询参数为空或过长' };
    const key = `${name}:${value}`;
    if (cache.has(key)) return cache.get(key);
    if (used >= limit) return { ok: false, error: `本轮最多 ${limit} 次联网操作，请使用已有资料回答` };
    used += 1;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('联网查询超时')), timeoutMs);
    let rejectCancelled;
    const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
    controller.signal.addEventListener('abort', () => rejectCancelled(controller.signal.reason || new Error('查询已取消')), { once: true });
    onStatus?.(dataTool?.label || (name === 'web_search' ? '正在搜索公开资料…' : '正在读取网页…'));
    try {
      const result = await Promise.race([
        dataTool ? dataTool.execute(args, controller.signal) : name === 'web_search' ? search(value, controller.signal) : fetchPage(value, controller.signal),
        cancelled,
      ]);
      signal?.throwIfAborted();
      const retrievedAt = result.retrievedAt || new Date().toISOString();
      const status = result.status || (result.ok === false ? 'failed' : undefined);
      const candidates = ['failed', 'waiting', 'empty'].includes(status) ? [] : dataTool || name === 'web_search' ? result.sources || [] : [{ title: result.title || result.url, url: result.url }];
      const sources = candidates.filter((source) => {
        try { return ['http:', 'https:'].includes(new URL(source.url).protocol); } catch { return false; }
      }).map((source) => ({ title: String(source.title || source.url), url: source.url, retrievedAt, ...(source.dataTime ? { dataTime: source.dataTime } : {}), ...(result.cacheNotice ? { cacheNotice: result.cacheNotice } : {}) }));
      const record = { operation: name, query: value, status: status || (sources.length ? 'success' : 'empty'), provider: result.provider || 'web', retrievedAt, sources, ...(result.dataTime ? { dataTime: result.dataTime } : {}), ...(result.error ? { error: result.error } : {}), ...(result.partial ? { partial: true } : {}) };
      records.push(record);
      additionalAttachments.set(name, result.attachments || []);
      const output = { ok: !['waiting', 'failed', 'empty'].includes(record.status), ...result, sources, retrievedAt };
      if (record.status === 'success') cache.set(key, output);
      return output;
    } catch (error) {
      signal?.throwIfAborted();
      const record = { operation: name, status: 'failed', retrievedAt: new Date().toISOString(), error: controller.signal.aborted ? '联网查询超时' : '联网查询失败，未取得可靠资料', sources: [] };
      records.push(record);
      return { ok: false, error: record.error };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (!signal?.aborted) onStatus?.('');
    }
  }
  function footer() {
    if (!records.length) return '';
    const uniqueSources = new Map();
    for (const source of records.flatMap((record) => record.sources)) {
      if (!uniqueSources.has(source.url)) uniqueSources.set(source.url, source);
    }
    const sources = [...uniqueSources.values()];
    const links = sources.map((source, index) => `${index + 1}. [${source.title.replace(/[\[\]\\\r\n]/g, ' ')}](<${source.url.replace(/[<>\r\n]/g, '')}>)${source.dataTime ? `（数据时间：${source.dataTime}）` : ''}`).join('\n');
    const cacheNotice = [...new Set(sources.map((source) => source.cacheNotice).filter(Boolean))].join('；');
    const failures = records.filter((record) => record.status === 'failed').length;
    if (records.every((record) => record.status === 'waiting')) return '';
    return `\n\n---\n${sources.length ? `**查询来源**（查询时间：${records.at(-1).retrievedAt}）\n\n${links}` : '本轮查询未取得可引用来源。'}${cacheNotice ? `\n\n_缓存说明：${cacheNotice}。_` : ''}${failures ? '\n\n_部分联网查询失败，未取得可靠资料。_' : ''}${records.some((record) => record.partial) ? '\n\n_部分平台未返回数据，以上仅包含可用来源。_' : ''}`;
  }
  const guidance = buildToolGuidance({ includeDataTools: dataTools.some((tool) => tools.some((schema) => schema.function.name === tool.schema.function.name)) || loadable.length > 0, pendingWeather });
  const loadableNames = new Set(loadable.flatMap((capability) => capability.tools));
  const allTools = [...new Map([...tools, ...pool.filter((tool) => loadableNames.has(tool.function.name))]
    .map((tool) => [tool.function.name, tool])).values()];
  return { tools, allTools, loadableCapabilities: loadable.map((item) => item.id), guidance, execute, footer, attachments: () => [...(records.length ? [{ type: 'web_retrieval', records }] : []), ...[...additionalAttachments.values()].flat()] };
}

export async function runAutoWebChat({ client, model, messages, web, extraTools = [], getExtraTools = undefined, callTool = undefined, signal = undefined, onText = undefined, onReasoning = undefined, contextBudget = undefined, onContextUsage = undefined }) {
  let content = '';
  let pendingLeadingText = '';
  let outputStarted = false;
  const emitClean = (delta) => {
    if (!delta) return;
    const cleaned = String(delta).replace(HISTORY_TIMESTAMP_TOKEN_PATTERN, '');
    if (!cleaned) return;
    content += cleaned;
    onText?.(cleaned);
  };
  const emit = (delta) => {
    if (outputStarted) return emitClean(delta);
    pendingLeadingText += delta;
    const match = pendingLeadingText.match(HISTORY_TIMESTAMP_PATTERN);
    if (match) {
      outputStarted = true;
      pendingLeadingText = pendingLeadingText.slice(match[0].length);
      emitClean(pendingLeadingText);
      pendingLeadingText = '';
      return;
    }
    if (!/^\s*[\[【]\s*历史消息时间\s*[:：]/u.test(pendingLeadingText)) {
      outputStarted = true;
      emitClean(pendingLeadingText);
      pendingLeadingText = '';
    }
  };
  await runToolLoop({
    messages: [{ role: 'system', content: [web.guidance || AUTO_WEB_GUIDANCE, extraTools.some(tool => tool.function?.name === 'memory_search') ? MEMORY_RECALL_GUIDANCE : ''].filter(Boolean).join('\n\n') }, ...messages],
    tools: [...web.tools, ...extraTools],
    maxIterations: 6,
    maxToolCalls: 12,
    maxEmptyResponseRetries: 1,
    isCancelled: () => Boolean(signal?.aborted),
    requestCompletion: async (conversation, tools) => {
      signal?.throwIfAborted();
      tools = [...web.tools, ...(getExtraTools ? getExtraTools() : extraTools)];
      const estimatedInputTokens = estimateRequestTokens(conversation, tools);
      if (contextBudget && estimatedInputTokens > contextBudget) throw new Error('本轮完整提示或工具结果超出上下文预算，请缩小查询范围；不会静默删除对话或拆散工具调用。');
      await onContextUsage?.({
        estimatedInputTokens,
        toolsSchemaIncluded: true,
        toolCount: Array.isArray(tools) ? tools.length : 0,
        toolSchemaChars: JSON.stringify(tools || []).length,
        toolNames: (tools || []).map((tool) => tool?.function?.name).filter(Boolean),
        capturedAt: new Date().toISOString(),
        phase: 'model-request',
      });
      const body = { model, messages: conversation, tools, stream: true };
      logModelRequest({ entry: 'server-chat', body });
      const stream = await client.chat.completions.create(body, { signal });
      return collectChatCompletionStream(stream, { onContentDelta: emit, onReasoningDelta: onReasoning });
    },
    executeTool: (name, args) => web.tools.some((tool) => tool.function.name === name)
      ? web.execute(name, args)
      : callTool ? callTool(name, args) : { ok: false, error: '未知工具' },
  });
  if (!outputStarted) {
    outputStarted = true;
    emitClean(pendingLeadingText);
    pendingLeadingText = '';
  }
  const footer = web.footer();
  if (footer) emit(footer);
  return content;
}
