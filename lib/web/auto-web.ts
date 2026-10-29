import { searchWebWithSources } from './web-search';
import { fetchWebPage } from './web-fetch.mjs';
import { createAutoWebTools } from './auto-web-core.mjs';
import { createChatDataTools } from '../chat/chat-data-tools.mjs';
import { platformWeather, pendingWeatherQuery, normalizeWeatherLocation } from '../misc/weather.mjs';
import { queryCryptoMarket } from '../workspace/crypto/market-tools';
import { getAvailableSources, getTrendingSnapshot } from '../trending';

export { AUTO_WEB_GUIDANCE, AUTO_WEB_SCHEMAS, runAutoWebChat } from './auto-web-core.mjs';
export { DATA_TOOL_GUIDANCE, TOOL_DECISION_POLICY, TOOL_SAFETY_POLICY, buildToolGuidance } from '../chat/tool-policy.mjs';

export function createChatWebTools(options: { apiKey?: string | null; defaultWeatherLocation?: unknown; signal?: AbortSignal; onStatus?: (label: string) => void; history?: any[]; cryptoContext?: (data: any) => string } = {}) {
  const defaultWeatherLocation = normalizeWeatherLocation(options.defaultWeatherLocation);
  const pendingWeather = pendingWeatherQuery(options.history || []);
  const web = createAutoWebTools({
    ...options,
    search: (query: string) => searchWebWithSources(query, options.apiKey),
    fetchPage: (url: string, signal: AbortSignal) => fetchWebPage(url, { signal }),
    dataTools: createChatDataTools({
      weather: platformWeather,
      defaultWeatherLocation,
      pendingWeather,
      trending: getTrendingSnapshot,
      crypto: async (name: string, args: { symbol: string }) => {
        const data = await queryCryptoMarket(name, args);
        return data ? { ...data, planInspection: options.cryptoContext?.(data) || '' } : null;
      },
      trendingSources: getAvailableSources().map((source) => source.id),
    }),
    pendingWeather,
  });
  if (defaultWeatherLocation) {
    web.guidance += '\n账号已确认的默认天气地点：' + JSON.stringify(defaultWeatherLocation) + '。用户未指定地点时直接调用 weather_query，location 留空，无需再问地点或查询城市编码；明确指定其他地点时以本轮指定地点为准。上轮其他地点的候选确认仍须遵循用户选择，不得替换成默认地点。';
  }
  return web;
}
