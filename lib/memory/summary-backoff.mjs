/** Process-local, bounded cooldown; never stores chat content or changes cursors. */
export function createSummaryBackoff({ now = Date.now, cooldownMs = 60_000, limit = 1000 } = {}) {
  const deadlines = new Map();
  return {
    remaining(key) {
      const left = (deadlines.get(key) || 0) - now();
      if (left <= 0) deadlines.delete(key);
      return Math.max(0, left);
    },
    fail(key) {
      for (const [key, deadline] of deadlines) if (deadline <= now()) deadlines.delete(key);
      deadlines.delete(key);
      deadlines.set(key, now() + cooldownMs);
      while (deadlines.size > limit) deadlines.delete(deadlines.keys().next().value);
    },
    clear(key) { deadlines.delete(key); },
  };
}

export const summaryBackoff = createSummaryBackoff();
