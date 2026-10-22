import { readCryptoEventsFromDisk } from '../workspace/crypto/event-sync.ts';
import { buildAgentWorldContext } from './events.ts';
import { isWorldEventAgent, resolveWorldEventQuery, WORLD_EVENTS_UNAVAILABLE_CONTEXT, type WorldEventHistoryMessage } from './agent-policy.ts';

export async function loadAgentWorldContext(options: {
  agentId?: string | null; query: string; history?: readonly WorldEventHistoryMessage[];
}): Promise<string> {
  if (!isWorldEventAgent(options.agentId) || !resolveWorldEventQuery(options.query, options.history)) return '';
  try {
    return buildAgentWorldContext({ ...options, events: await readCryptoEventsFromDisk() });
  } catch (error) {
    console.warn('[world-events] 财经事件资料读取失败:', error instanceof Error ? error.message : error);
    return WORLD_EVENTS_UNAVAILABLE_CONTEXT;
  }
}
