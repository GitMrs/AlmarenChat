const MINUTE_MS = 60 * 1000;

export const PROACTIVE_BACKOFF_STEPS_MS = [
  75 * MINUTE_MS,
  3 * 60 * MINUTE_MS,
  8 * 60 * MINUTE_MS,
  24 * 60 * MINUTE_MS,
];

export function resolveProactiveBackoff(unansweredCount) {
  const normalizedCount = Number.isFinite(unansweredCount)
    ? Math.max(0, Math.floor(unansweredCount))
    : 0;
  const level = Math.min(normalizedCount, PROACTIVE_BACKOFF_STEPS_MS.length - 1);

  return {
    level,
    cooldownMs: PROACTIVE_BACKOFF_STEPS_MS[level],
  };
}

export function resolveProactiveWait({ now, lastUserAt, unansweredDeliveries }) {
  const deliveries = Array.isArray(unansweredDeliveries) ? unansweredDeliveries : [];
  const { level, cooldownMs } = resolveProactiveBackoff(deliveries.length);
  const lastDeliveryAt = deliveries[0]?.createdAt
    ? new Date(deliveries[0].createdAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const userAt = lastUserAt ? new Date(lastUserAt).getTime() : Number.NEGATIVE_INFINITY;
  const anchorAt = Math.max(lastDeliveryAt, userAt);

  if (!Number.isFinite(anchorAt)) {
    return { level, cooldownMs, retryAfterMs: 0 };
  }

  return {
    level,
    cooldownMs,
    retryAfterMs: Math.max(0, cooldownMs - (now - anchorAt)),
  };
}
