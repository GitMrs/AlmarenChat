import { evaluateFollowUpWatches, normalizeFollowUpWatches, FOLLOW_UP_WATCH_COOLDOWN_MS } from './follow-up-watch.mjs';

// Reuse the saved task and existing follow-up worker. The original runAt is kept
// for audit; an atomic nextAttemptAt update wakes it early without creating jobs.
export async function checkFollowUpWatches({ db, getMarket, now = new Date() }: {
  db: any; getMarket: (symbol: string) => Promise<any>; now?: Date;
}) {
  const startedAt = Date.now();
  const tasks = await db.spaceFollowUp.findMany({ where: {
    domain: 'CRYPTO', status: 'PENDING', attempts: 0, networkAllowed: true,
    watchTriggeredAt: null, runAt: { gt: now }, nextAttemptAt: { gt: now },
    OR: [{ chainEndsAt: null }, { chainEndsAt: { gt: now } }],
    space: { templateId: 'crypto-contract-trading', followUpEnabled: true, runtimeType: { not: 'PI_CODING' } },
  }, include: { space: { select: { templateSnapshot: true, members: { select: { agentId: true } } } } } });
  const watched: Array<{ task: any; rules: any[] }> = [];
  for (const task of tasks) {
    if (task.space.templateSnapshot?.sentinelState?.serverSentinelEnabled === false) continue;
    if (!task.space.members.some((m: any) => m.agentId === task.agentId) && task.agentId !== 'space-coordinator') continue;
    if (task.workTitle != null && !task.workId) continue;
    if (task.workId && !await db.spaceWork.findFirst({ where: { id: task.workId, spaceId: task.spaceId }, select: { id: true } })) continue;
    try {
      const rules = normalizeFollowUpWatches(task.watchConditions);
      if (rules.length) watched.push({ task, rules });
    } catch { /* Invalid or legacy conditions never become execution signals. */ }
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
    if (!event && JSON.stringify(state) === JSON.stringify(task.watchState || {})) continue;
    const recent = event && await db.spaceFollowUp.findFirst({ where: {
      spaceId: task.spaceId, agentId: task.agentId,
      watchTriggeredAt: { gte: new Date(observedAt.getTime() - FOLLOW_UP_WATCH_COOLDOWN_MS) },
    }, select: { id: true } });
    // Preserve the pre-crossing baseline during cooldown, so a still-relevant
    // crossing can be rechecked later instead of silently discarded.
    if (recent) continue;
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
      watchState: state,
      ...(event ? { watchEvent: event, watchTriggeredAt: observedAt, nextAttemptAt: observedAt } : {}),
    } });
    if (event && updated.count) triggered++;
  }
  return { watched: watched.length, triggered };
}
