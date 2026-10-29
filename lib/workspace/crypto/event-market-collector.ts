import { readCryptoEventsFromDisk, persistEventMarketStage } from './event-sync.ts';
import { fetchEventMarketWindow } from './event-market-source.ts';
import { canTrackEventMarket, EVENT_MARKET_WINDOWS, getEventMarketResult, type EventMarketWindow } from './event-market.ts';

const globalForMarket = globalThis as unknown as { __eventMarketCollector?: { collecting: boolean } };
const collectorState = globalForMarket.__eventMarketCollector ??= { collecting: false };

function dedupePhases<T extends { id: string; timestamp: string; eventGroupKey?: string }>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.eventGroupKey || `event:${event.id}`}:${event.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function phaseKey(event: { id: string; timestamp: string; eventGroupKey?: string }): string {
  return `${event.eventGroupKey || `event:${event.id}`}:${event.timestamp}`;
}

/** 由鹰眼原有30秒调度触发，一次只补一个到期窗口；无到期事件时不访问行情源。 */
export async function collectNextEventMarketWindow(eventId?: string) {
  if (collectorState.collecting) return { status: 'busy' as const };
  collectorState.collecting = true;
  try {
    const now = new Date();
    const allEvents = await readCryptoEventsFromDisk();
    const requested = eventId ? allEvents.find((event) => event.id === eventId) : undefined;
    const requestedPhase = requested ? phaseKey(requested) : undefined;
    const events = dedupePhases(allEvents
      .filter((event) => (!eventId || phaseKey(event) === requestedPhase) && canTrackEventMarket(event))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)));
    for (const event of events) {
      for (const window of Object.keys(EVENT_MARKET_WINDOWS) as EventMarketWindow[]) {
        if (now.getTime() < Date.parse(event.timestamp) + EVENT_MARKET_WINDOWS[window] * 60_000 ||
            getEventMarketResult(event, window, now)) continue;
        const observation = event.marketObservation;
        const stage = observation && Date.parse(observation.scheduledAt) === Date.parse(event.timestamp) ? observation.stages[window] : undefined;
        if (stage?.status === 'retry' && Date.parse(stage.retryAt) > now.getTime()) continue;
        try {
          const result = await fetchEventMarketWindow(event.timestamp, window);
          const saved = await persistEventMarketStage(event.id, event.timestamp, window, result);
          return { status: saved ? 'complete' as const : 'rescheduled' as const, eventId: event.id, window };
        } catch (error) {
          const attemptedAt = new Date();
          const message = error instanceof Error ? error.message : '行情采集失败';
          await persistEventMarketStage(event.id, event.timestamp, window, {
            status: 'retry', attemptedAt: attemptedAt.toISOString(),
            retryAt: new Date(attemptedAt.getTime() + 5 * 60_000).toISOString(), error: message,
          });
          return { status: 'retry' as const, eventId: event.id, window, error: message };
        }
      }
    }
    return { status: 'idle' as const };
  } finally {
    collectorState.collecting = false;
  }
}
