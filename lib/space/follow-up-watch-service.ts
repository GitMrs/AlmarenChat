import { evaluateFollowUpWatches, normalizeFollowUpWatches, FOLLOW_UP_WATCH_COOLDOWN_MS } from './follow-up-watch.mjs';
import { buildWatchHealth, EAGLE_RUNTIME_ID } from './eagle-monitor.mjs';

// Reuse the saved task and existing follow-up worker. The original runAt is kept
// for audit; an atomic nextAttemptAt update wakes it early without creating jobs.
export async function checkFollowUpWatches({ db, getMarket, now: suppliedNow }: {
  db: any; getMarket: (symbol: string) => Promise<any>; now?: Date;
}) {
  const started = Date.now();
  const now = suppliedNow || new Date(started);
  await db.eagleRuntime.upsert({ where: { id: EAGLE_RUNTIME_ID }, create: { id: EAGLE_RUNTIME_ID, lastStartedAt: now }, update: { lastStartedAt: now } });
  try {
    const result = await scanFollowUpWatches({ db, getMarket, now, startedAt: started });
    const finished = new Date(now.getTime() + Math.max(0, Date.now() - started));
    await db.eagleRuntime.update({ where: { id: EAGLE_RUNTIME_ID }, data: {
      lastFinishedAt: finished, lastSuccessAt: finished, errorCode: null, consecutiveFailures: 0,
    } });
    return result;
  } catch (error) {
    const failedAt = new Date(now.getTime() + Math.max(0, Date.now() - started));
    try {
      await db.eagleRuntime.update({ where: { id: EAGLE_RUNTIME_ID }, data: {
        lastFinishedAt: failedAt, lastErrorAt: failedAt, errorCode: 'WATCH_SCAN_FAILED', consecutiveFailures: { increment: 1 },
      } });
    } catch { /* A database outage is also visible as a stale heartbeat. */ }
    throw error;
  }
}

async function scanFollowUpWatches({ db, getMarket, now, startedAt }: { db: any; getMarket: (symbol: string) => Promise<any>; now: Date; startedAt: number }) {
  const tasks = await db.spaceFollowUp.findMany({ where: {
    domain: 'CRYPTO', status: 'PENDING', attempts: 0, networkAllowed: true,
    watchTriggeredAt: null, runAt: { gt: now }, nextAttemptAt: { gt: now },
    OR: [{ chainEndsAt: null }, { chainEndsAt: { gt: now } }],
    space: { templateId: 'crypto-contract-trading', followUpEnabled: true, runtimeType: { not: 'PI_CODING' } },
  }, include: { space: { select: { templateSnapshot: true, members: { select: { agentId: true } } } } } });
  const watched: Array<{ task: any; rules: any[] }> = [];
  const recordProblem = (task: any, failureCode: string) => db.spaceFollowUp.updateMany({
    where: { id: task.id, updatedAt: task.updatedAt, status: 'PENDING' }, data: {
      watchHealth: buildWatchHealth({ rules: [], previousHealth: task.watchHealth, snapshots: {}, now: now.getTime(), failureCode }),
    },
  });
  for (const task of tasks) {
    if (task.space.templateSnapshot?.sentinelState?.serverSentinelEnabled === false) continue;
    if (!task.watchConditions) continue;
    if (!task.space.members.some((m: any) => m.agentId === task.agentId) && task.agentId !== 'space-coordinator') { await recordProblem(task, 'MEMBER_UNAVAILABLE'); continue; }
    if ((task.workTitle != null && !task.workId)
      || (task.workId && !await db.spaceWork.findFirst({ where: { id: task.workId, spaceId: task.spaceId }, select: { id: true } }))) {
      await recordProblem(task, 'TARGET_UNAVAILABLE'); continue;
    }
    try {
      const rules = normalizeFollowUpWatches(task.watchConditions);
      if (rules.length) watched.push({ task, rules });
    } catch {
      await db.spaceFollowUp.updateMany({ where: { id: task.id, updatedAt: task.updatedAt, status: 'PENDING' }, data: {
        watchHealth: buildWatchHealth({ rules: [], previousHealth: task.watchHealth, snapshots: {}, now: now.getTime(), invalid: true }),
      } });
    }
  }
  const snapshots: Record<string, any> = {};
  await Promise.all([...new Set(watched.flatMap(item => item.rules.map(rule => rule.symbol)))].map(async symbol => {
    try { snapshots[symbol] = await getMarket(symbol); } catch { /* Timed fallback remains. */ }
  }));
  // Quotes are collected after the tick starts. Compare them against the time
  // after collection, otherwise every freshly fetched quote looks "future".
  const observedAt = new Date(now.getTime() + Math.max(0, Date.now() - startedAt));
  let triggered = 0;
  for (const { task, rules } of watched) {
    const { state, event } = evaluateFollowUpWatches(rules, task.watchState, snapshots, observedAt.getTime());
    const recent = event && await db.spaceFollowUp.findFirst({ where: {
      spaceId: task.spaceId, agentId: task.agentId,
      watchTriggeredAt: { gte: new Date(observedAt.getTime() - FOLLOW_UP_WATCH_COOLDOWN_MS) },
    }, select: { id: true } });
    // Preserve the pre-crossing baseline during cooldown, so a still-relevant
    // crossing can be rechecked later instead of silently discarded.
    const currentSpace = await db.space.findUnique({ where: { id: task.spaceId }, select: {
      followUpEnabled: true, templateSnapshot: true, members: { select: { agentId: true } },
    } });
    if (!currentSpace?.followUpEnabled || currentSpace.templateSnapshot?.sentinelState?.serverSentinelEnabled === false) continue;
    if (task.agentId !== 'space-coordinator' && !currentSpace.members.some((m: any) => m.agentId === task.agentId)) continue;
    const updated = await db.spaceFollowUp.updateMany({ where: {
      id: task.id, updatedAt: task.updatedAt, status: 'PENDING', attempts: 0,
      watchTriggeredAt: null, nextAttemptAt: { gt: observedAt },
      space: { followUpEnabled: true, runtimeType: { not: 'PI_CODING' } },
    }, data: {
      watchState: recent ? task.watchState : state,
      watchHealth: buildWatchHealth({ rules, previousState: task.watchState, previousHealth: task.watchHealth,
        snapshots, event, cooldown: !!recent, now: observedAt.getTime() }),
      ...(event && !recent ? { watchEvent: event, watchTriggeredAt: observedAt, nextAttemptAt: observedAt } : {}),
    } });
    if (event && !recent && updated.count) triggered++;
  }
  return { watched: watched.length, triggered };
}
